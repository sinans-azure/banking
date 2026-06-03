# Azure Function OCR and Email Setup

This banking app uses a Blob-trigger OCR flow only:

1. A user uploads a document in the banking app.
2. The app stores the file in Azure Blob Storage and marks it `Pending Validation`.
3. A Blob-trigger Azure Function runs OCR with Azure AI Vision.
4. The OCR Function calls the banking app webhook at `/api/ocr-result`.
5. The banking app updates PostgreSQL and sends an email notification message to Azure Service Bus.
6. A Service Bus-trigger Function sends the email through Gmail.

## Prerequisites

1. Azure PostgreSQL Flexible Server.
2. Azure Storage Account and `documents` blob container.
3. Azure AI Services Computer Vision resource.
4. Azure Function App.
5. Azure Service Bus namespace and queue.
6. Gmail account with a Gmail App Password.
7. Deployed Banking App with `/api/ocr-result` reachable from Azure Functions.

## Step 1: Configure Banking App Settings

In the Banking App Service, go to **Settings** -> **Environment variables** and set:

```text
DB_HOST=<postgres-server>.postgres.database.azure.com
DB_USER=<postgres-user>
DB_PASSWORD=<postgres-password>
DB_NAME=banking_db
DB_PORT=5432
AZURE_STORAGE_CONNECTION_STRING=<storage-connection-string>
AZURE_STORAGE_CONTAINER_NAME=documents
SESSION_SECRET=<long-random-value>
OCR_WEBHOOK_SECRET=<shared-secret>
SERVICE_BUS_CONNECTION_STRING=<service-bus-send-connection-string>
SERVICE_BUS_EMAIL_QUEUE_NAME=ocr-email-notifications
```

Save settings and restart the Banking App Service.

## Step 2: Create Computer Vision

1. Go to Azure Portal.
2. Create an **Azure AI Services Computer Vision** resource.
3. Open **Keys and Endpoint**.
4. Copy `Key 1` and the endpoint URL.

## Step 3: Create Service Bus Queue

1. Create a **Service Bus namespace**.
2. Create a queue named `ocr-email-notifications`.
3. Copy a connection string with permission to send messages.
4. Use that connection string as `SERVICE_BUS_CONNECTION_STRING` in the Banking App Service.

## Step 4: Configure OCR Function App Settings

In the OCR Function App, set:

```text
VISION_ENDPOINT=<computer-vision-endpoint>
VISION_KEY=<computer-vision-key>
WEBHOOK_URL=https://<banking-app-name>.azurewebsites.net/api/ocr-result
OCR_WEBHOOK_SECRET=<same-shared-secret-used-by-banking-app>
```

Install `axios` in the Function App console:

```powershell
npm install axios
```

## Step 5: Create Blob-Triggered OCR Function

1. Open the Function App.
2. Go to **Functions** -> **Create**.
3. Select **Azure Blob Storage trigger**.
4. Use a path that watches the documents container. For many Function templates this is:

```text
documents/{name}
```

The app uploads blobs under names like `user-1/1717000000000-file.pdf`, which are still inside the `documents` container.

Use this Function code:

```javascript
const axios = require('axios');

module.exports = async function (context, myBlob) {
    const visionEndpoint = process.env.VISION_ENDPOINT;
    const visionKey = process.env.VISION_KEY;
    const webhookUrl = process.env.WEBHOOK_URL;
    const webhookSecret = process.env.OCR_WEBHOOK_SECRET;
    const blobUrl = context.bindingData.uri;

    context.log(`Processing blob ${context.bindingData.name}`);

    try {
        const endpoint = visionEndpoint.endsWith('/') ? visionEndpoint : `${visionEndpoint}/`;
        const analyzeUrl = `${endpoint}vision/v3.2/read/analyze`;

        const analyzeResponse = await axios.post(analyzeUrl, myBlob, {
            headers: {
                'Ocp-Apim-Subscription-Key': visionKey,
                'Content-Type': 'application/octet-stream'
            }
        });

        const operationLocation = analyzeResponse.headers['operation-location'];
        let analyzeResult = null;

        for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 2000));

            const pollResponse = await axios.get(operationLocation, {
                headers: {
                    'Ocp-Apim-Subscription-Key': visionKey
                }
            });

            if (pollResponse.data.status === 'succeeded') {
                analyzeResult = pollResponse.data.analyzeResult;
                break;
            }

            if (pollResponse.data.status === 'failed') {
                throw new Error('Azure AI Vision OCR failed');
            }
        }

        if (!analyzeResult) {
            throw new Error('Azure AI Vision OCR timed out');
        }

        const allText = analyzeResult.readResults
            .flatMap(page => page.lines.map(line => line.text))
            .join(' ');

        const ageMatch = allText.match(/\bAge\s*[:\-]?\s*(\d{1,3})\b/i);
        const age = ageMatch ? Number(ageMatch[1]) : null;

        if (!age || age < 1 || age > 120) {
            throw new Error('Could not find a valid age in the document');
        }

        const premium = age > 50 ? 150 : age > 30 ? 100 : 70;

        await axios.post(webhookUrl, {
            blob_url: blobUrl,
            status: 'Processed',
            age,
            insurance_premium: premium
        }, {
            headers: webhookSecret ? {
                'x-ocr-webhook-secret': webhookSecret
            } : {}
        });

        context.log(`OCR completed. Age: ${age}, Premium: ${premium}`);
    } catch (error) {
        context.log.error('OCR failed:', error.message);

        await axios.post(webhookUrl, {
            blob_url: blobUrl,
            status: 'OCR Failed',
            age: null,
            insurance_premium: null
        }, {
            headers: webhookSecret ? {
                'x-ocr-webhook-secret': webhookSecret
            } : {}
        });
    }
};
```

## Step 6: Create Gmail Sender Function

Create a second Function in the Function App:

1. Choose **Azure Service Bus Queue trigger**.
2. Queue name: `ocr-email-notifications`.
3. Connection setting name: `SERVICE_BUS_CONNECTION_STRING`.
4. Add these Function App environment variables:

```text
SERVICE_BUS_CONNECTION_STRING=<service-bus-listen-connection-string>
GMAIL_USER=<your-gmail-address>
GMAIL_APP_PASSWORD=<gmail-app-password>
```

Install `nodemailer` in the Function App console:

```powershell
npm install nodemailer
```

Use this sender code:

```javascript
const nodemailer = require('nodemailer');

module.exports = async function (context, message) {
    const payload = typeof message === 'string' ? JSON.parse(message) : message;
    const data = payload.data || {};

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });

    const ageLine = data.extractedAge ? `Extracted age: ${data.extractedAge}` : 'Extracted age: unavailable';
    const premiumLine = data.insurancePremium ? `Premium: $${data.insurancePremium}/mo` : 'Premium: unavailable';

    await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: payload.to,
        subject: payload.subject,
        text: [
            `Hello ${data.username || 'there'},`,
            '',
            `Your document "${data.documentName}" finished OCR processing.`,
            `Status: ${data.status}`,
            ageLine,
            premiumLine
        ].join('\n')
    });

    context.log(`Email sent to ${payload.to}`);
};
```

## Step 7: Test

1. Register a banking user with a Gmail address.
2. Login and upload a document containing text like `Age: 42`.
3. The dashboard should show `Pending Validation`.
4. Wait for the Blob-trigger Function to run, then refresh the dashboard.
5. The document should show `Processed`, the extracted age, and the premium.
6. Check the registered Gmail inbox for the result email.
