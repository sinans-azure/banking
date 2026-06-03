# Azure Function OCR Demonstration Setup

This guide walks you through the Azure Portal work needed to connect the banking app to an Azure Function that performs OCR, extracts an age from the uploaded document, calculates an insurance premium, and updates the user's dashboard.

The banking app now supports two Function patterns:

- **HTTP Trigger**: The app calls the Function right after upload and can show the result immediately.
- **Blob Trigger**: The Function starts when Blob Storage receives a new document and updates the app by calling a webhook.

For demos, the HTTP trigger is the fastest to show. The Blob trigger is useful when you want to emphasize event-driven Azure architecture.

## Prerequisites

1. **Azure Storage Account** (where documents are uploaded)
2. **Azure AI Services (Computer Vision)** resource for OCR.
3. **Azure Function App** (Node.js or Python, depending on your preference).
4. **Deployed Banking App** (with the `/api/ocr-result` endpoint accessible from the internet).

---

## Step 1: Create Azure AI Services (Computer Vision)

1. Go to the Azure Portal.
2. Search for **Computer Vision** and click **Create**.
3. Fill in the details (Resource Group, Region, Name, Pricing tier - Free F0 is fine).
4. Once created, go to **Keys and Endpoint**.
5. Copy `Key 1` and the `Endpoint` URL. You will need these for the Function App.

---

## Step 2: Create Azure Function App

1. Go to the Azure Portal and search for **Function App**.
2. Click **Create** -> **Consumption** (Serverless).
3. Select your Subscription and Resource Group.
4. Set the **Function App name**.
5. Choose **Node.js** as the Runtime stack.
6. Region should be the same as your Storage Account.
7. Under Storage, select the Storage Account used by your banking application.
8. Click **Review + Create** and deploy.

---

## Step 3: Configure Banking App Settings

In your **Banking App Service**, go to **Settings** -> **Environment variables** and configure:

- `SESSION_SECRET`: A long random value.
- `OCR_FUNCTION_URL`: The HTTP-trigger Function URL, if using the HTTP trigger pattern.
- `OCR_FUNCTION_KEY`: Optional. Add this if your HTTP-trigger Function requires a function key.
- `OCR_WEBHOOK_SECRET`: Optional but recommended for Blob-trigger callbacks.

Also keep the existing PostgreSQL and Storage settings configured:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER_NAME`

---

## Step 4: Configure Function App Environment Variables

Once the Function App is deployed, go to **Environment variables** (under Settings) and add the following:

- `VISION_ENDPOINT`: The Endpoint URL from Step 1.
- `VISION_KEY`: Key 1 from Step 1.
- `WEBHOOK_URL`: The full URL to your banking app's API endpoint (e.g., `https://<your-banking-app-url>.azurewebsites.net/api/ocr-result`).
- `OCR_WEBHOOK_SECRET`: Use the same value configured in the Banking App if you enabled webhook protection.

---

## Step 5A: HTTP Trigger Function Contract

Use this option if you want the upload request to calculate the quote immediately.

The banking app sends this JSON to `OCR_FUNCTION_URL`:

```json
{
  "documentId": 12,
  "userId": 3,
  "documentName": "kyc.pdf",
  "documentUrl": "https://storage-account.blob.core.windows.net/documents/user-3/...",
  "callbackUrl": "https://your-banking-app.azurewebsites.net/api/ocr-result"
}
```

The Function should return JSON like this:

```json
{
  "age": 42,
  "premium": 100,
  "status": "Processed"
}
```

The app also accepts these alternate property names: `extractedAge` and `insurancePremium`.

For early testing, your Function can return mock data without calling OCR:

```javascript
module.exports = async function (context, req) {
    const age = 42;
    const premium = age > 50 ? 150 : age > 30 ? 100 : 70;

    context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
            age,
            premium,
            status: 'Processed'
        }
    };
};
```

---

## Step 5B: Blob Trigger Function Contract

1. In the Function App menu, go to **Functions** -> **Create**.
2. Select **Azure Blob Storage trigger**.
3. Set the path to `documents/{name}` or `documents/user-{userId}/{name}` depending on what the portal accepts for your trigger binding. The app uploads files under `user-<id>/filename` inside the `documents` container.
4. Select your Storage Account connection.
5. In the created function, replace `index.js` with code that does the following:

```javascript
const axios = require('axios');

module.exports = async function (context, myBlob) {
    context.log(`Processing blob Name: ${context.bindingData.name}, Size: ${myBlob.length} Bytes`);

    const visionEndpoint = process.env.VISION_ENDPOINT;
    const visionKey = process.env.VISION_KEY;
    const webhookUrl = process.env.WEBHOOK_URL;
    const blobUrl = context.bindingData.uri;

    try {
        // 1. Call Azure AI Vision OCR API
        const ocrUrl = `${visionEndpoint}vision/v3.2/read/analyze`;
        const response = await axios.post(ocrUrl, { url: blobUrl }, {
            headers: {
                'Ocp-Apim-Subscription-Key': visionKey,
                'Content-Type': 'application/json'
            }
        });

        // Get operation location to poll for results
        const operationLocation = response.headers['operation-location'];
        
        // Poll for completion
        let ocrResult = null;
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const res = await axios.get(operationLocation, {
                headers: { 'Ocp-Apim-Subscription-Key': visionKey }
            });
            if (res.data.status === 'succeeded') {
                ocrResult = res.data.analyzeResult;
                break;
            }
        }

        // 2. Extract Text and Find Age
        let extractedAge = null;
        if (ocrResult) {
            const allText = ocrResult.readResults.map(r => r.lines.map(l => l.text).join(' ')).join(' ');
            context.log("Extracted Text: " + allText);
            
            // Simple regex to find age (e.g., "Age: 35")
            const ageMatch = allText.match(/Age\s*:\s*(\d+)/i);
            if (ageMatch) {
                extractedAge = parseInt(ageMatch[1]);
            }
        }

        // 3. Calculate Premium based on Age
        let premium = 50; // Base premium
        if (extractedAge) {
            if (extractedAge > 50) premium += 100;
            else if (extractedAge > 30) premium += 50;
            else premium += 20;
        }

        // 4. Call Webhook to Update Banking DB
        await axios.post(webhookUrl, {
            blob_url: blobUrl,
            status: 'Processed',
            age: extractedAge,
            insurance_premium: premium
        }, {
            headers: process.env.OCR_WEBHOOK_SECRET ? {
                'x-ocr-webhook-secret': process.env.OCR_WEBHOOK_SECRET
            } : {}
        });

        context.log(`Successfully processed. Age: ${extractedAge}, Premium: ${premium}`);
    } catch (error) {
        context.log.error("Error processing document:", error.message);
        
        // Notify failure
        await axios.post(webhookUrl, {
            blob_url: blobUrl,
            status: 'Failed',
            age: null,
            insurance_premium: 0
        }, {
            headers: process.env.OCR_WEBHOOK_SECRET ? {
                'x-ocr-webhook-secret': process.env.OCR_WEBHOOK_SECRET
            } : {}
        });
    }
};
```

*Note: Since the function uses `axios`, you will need to open the Console for your Function App in the portal, navigate to the function directory (e.g., `D:\home\site\wwwroot\<function-name>`), and run `npm install axios`.*

---

## Step 6: Test the End-to-End Flow

1. Open your deployed **Banking App**.
2. **Register** a new account and **Login**.
3. Upload a sample document containing text like "Name: John Doe \n Age: 42".
4. Confirm the file appears in Blob Storage under the configured container.
5. For HTTP trigger: the status should change during the upload request and show the extracted age and premium immediately.
6. For Blob trigger: wait 5-10 seconds and refresh the banking portal page.
7. The status should change to **Processed**, and the dashboard should show the extracted age and insurance premium for that user's document.
