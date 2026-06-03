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

const uploadDocument = async (originalname, buffer, userId) => {
  if (!containerClient) throw new Error('Storage not configured');
  const safeName = originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobName = userId ? `user-${userId}/${Date.now()}-${safeName}` : `${Date.now()}-${safeName}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    metadata: userId ? { userId: String(userId), originalName: safeName } : { originalName: safeName }
  });
  return blockBlobClient.url;
};

module.exports = {
  initBlobStorage,
  uploadDocument
};
