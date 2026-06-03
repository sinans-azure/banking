const { ServiceBusClient } = require('@azure/service-bus');

const connectionString = process.env.SERVICE_BUS_CONNECTION_STRING;
const queueName = process.env.SERVICE_BUS_EMAIL_QUEUE_NAME || 'ocr-email-notifications';

let serviceBusClient;
let sender;

const initMailQueue = () => {
  if (!connectionString) {
    console.warn('SERVICE_BUS_CONNECTION_STRING is not set. Email notifications are disabled.');
    return;
  }

  serviceBusClient = new ServiceBusClient(connectionString);
  sender = serviceBusClient.createSender(queueName);
  console.log(`Service Bus email queue "${queueName}" configured`);
};

const enqueueOcrEmail = async ({ email, username, documentName, status, extractedAge, insurancePremium }) => {
  if (!sender) return false;
  if (!email) return false;

  const message = {
    body: {
      to: email,
      subject: `Insurance quote ${status}`,
      template: 'ocr-insurance-quote',
      data: {
        username,
        documentName,
        status,
        extractedAge,
        insurancePremium
      }
    },
    contentType: 'application/json',
    subject: 'ocr-insurance-quote'
  };

  try {
    await sender.sendMessages(message);
    return true;
  } catch (error) {
    console.error('Failed to queue OCR email notification:', error.message);
    return false;
  }
};

const closeMailQueue = async () => {
  if (sender) await sender.close();
  if (serviceBusClient) await serviceBusClient.close();
};

module.exports = {
  initMailQueue,
  enqueueOcrEmail,
  closeMailQueue
};
