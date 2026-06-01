const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'documents';

let blobServiceClient;
let containerClient;

if (connectionString) {
  blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  containerClient = blobServiceClient.getContainerClient(containerName);
} else {
  console.warn('AZURE_STORAGE_CONNECTION_STRING is not set.');
}

const initBlobStorage = async () => {
  if (!containerClient) return;
  try {
    const exists = await containerClient.exists();
    if (!exists) {
      await containerClient.create();
      console.log(`Container "${containerName}" created successfully`);
    } else {
      console.log(`Container "${containerName}" already exists`);
    }
  } catch (error) {
    console.error('Error initializing blob storage:', error);
  }
};

const uploadDocument = async (originalname, buffer) => {
  if (!containerClient) throw new Error('Storage not configured');
  const blobName = `${Date.now()}-${originalname}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer);
  return blockBlobClient.url;
};

const listDocuments = async () => {
  if (!containerClient) return [];
  const documents = [];
  for await (const blob of containerClient.listBlobsFlat()) {
    documents.push({
      name: blob.name,
      createdOn: blob.properties.createdOn,
      url: containerClient.getBlockBlobClient(blob.name).url
    });
  }
  return documents;
};

module.exports = {
  initBlobStorage,
  uploadDocument,
  listDocuments
};
