# Azure Banking Portal Demo

A simple Node.js web application to demonstrate integrating Azure App Service with Azure PostgreSQL Flexible Server, Azure Storage Accounts (with GRS - Geo-Redundant Storage), and Azure Functions for OCR-based insurance quote calculation.

## Features
- **User Login and Registration**: Each user has their own banking session, account, and uploaded documents.
- **PostgreSQL Database Integration**: Simulates a banking system with accounts and simple fund transfers.
- **Azure Blob Storage Integration**: Upload and view user-scoped documents, demonstrating file storage capabilities using Azure Storage.
- **Azure Functions OCR Integration**: A Blob-trigger Function extracts an age and calculates an insurance premium after upload.
- **Service Bus Email Notifications**: Queues OCR result email notifications for a Service Bus-trigger Function to send through Gmail.
- **GRS Demonstration**: The uploaded documents are stored in an Azure Storage Account. If configured with GRS, Azure automatically replicates the documents to a secondary region.

## Prerequisites

To run this locally or in Azure, you need:
- Node.js installed
- An Azure PostgreSQL Flexible Server instance
- An Azure Storage Account (configured with GRS for the demo)
- Optional: An Azure Function App and Azure AI Vision/Document Intelligence resource for OCR
- Optional: Azure Service Bus queue and Gmail App Password for OCR result emails

## Local Setup

1. Navigate to this directory:
   ```bash
   cd banking
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on the example:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your actual Azure resource credentials:
   - `DB_HOST`: Your PostgreSQL server URL (e.g., `server.postgres.database.azure.com`)
   - `DB_USER`: Your PostgreSQL admin username
   - `DB_PASSWORD`: Your PostgreSQL password
   - `DB_NAME`: Your database name
   - `AZURE_STORAGE_CONNECTION_STRING`: Your Storage Account connection string
   - `AZURE_STORAGE_CONTAINER_NAME`: The blob container to store documents (defaults to `documents`)
   - `SESSION_SECRET`: A long random value used to secure login sessions
   - `OCR_WEBHOOK_SECRET`: Optional shared secret required for OCR callbacks to `/api/ocr-result`
   - `SERVICE_BUS_CONNECTION_STRING`: Optional Service Bus connection string for email notifications
   - `SERVICE_BUS_EMAIL_QUEUE_NAME`: Optional queue name, defaults to `ocr-email-notifications`

5. Run the application:
   ```bash
   npm start
   ```

6. Open your browser and go to `http://localhost:8080`

## Deployment to Azure App Service

1. You can deploy this folder directly to Azure App Service using VS Code Azure extensions, Azure CLI, or GitHub Actions.
2. Make sure to configure the corresponding **Application Settings** (Environment Variables) in your Azure App Service for:
   - `DB_HOST`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_NAME`
   - `AZURE_STORAGE_CONNECTION_STRING`
   - `AZURE_STORAGE_CONTAINER_NAME`
   - `SESSION_SECRET`
   - `OCR_WEBHOOK_SECRET` (optional)
   - `SERVICE_BUS_CONNECTION_STRING` (optional)
   - `SERVICE_BUS_EMAIL_QUEUE_NAME` (optional)

The App Service will automatically run `npm install` and start the app using `npm start` (which runs `node app.js`).

## OCR Flow

This app uses a Blob-trigger Azure Function. The uploaded document starts in `Pending Validation`, and the Blob-trigger Function should call `/api/ocr-result` with `{ "blob_url": "<uploaded-blob-url>", "age": 42, "premium": 100, "status": "Processed" }`.

See `FUNCTION_APP_SETUP.md` for the Azure Portal setup steps.

## Email Notification Flow

New users register with a Gmail address. When OCR processing finishes, the banking app sends a JSON message to the configured Service Bus queue. A separate Service Bus-trigger Azure Function should consume that message and send the email through Gmail using a Gmail App Password.

The banking app only publishes the message; Gmail credentials belong in the email-sending Function App, not in this web app.
