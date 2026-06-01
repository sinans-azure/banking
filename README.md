# Azure Banking Portal Demo

A simple Node.js web application to demonstrate integrating Azure App Service with Azure PostgreSQL Flexible Server and Azure Storage Accounts (with GRS - Geo-Redundant Storage).

## Features
- **PostgreSQL Database Integration**: Simulates a banking system with accounts and simple fund transfers.
- **Azure Blob Storage Integration**: Upload and view documents, demonstrating file storage capabilities using Azure Storage.
- **GRS Demonstration**: The uploaded documents are stored in an Azure Storage Account. If configured with GRS, Azure automatically replicates the documents to a secondary region.

## Prerequisites

To run this locally or in Azure, you need:
- Node.js installed
- An Azure PostgreSQL Flexible Server instance
- An Azure Storage Account (configured with GRS for the demo)

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

The App Service will automatically run `npm install` and start the app using `npm start` (which runs `node app.js`).
