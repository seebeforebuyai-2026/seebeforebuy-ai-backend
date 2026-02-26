// DynamoDB configuration and client setup
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// Create DynamoDB client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Create DynamoDB Document client (easier to work with)
const docClient = DynamoDBDocumentClient.from(client);

// Table names
const TABLES = {
  SHOPS: process.env.DYNAMODB_SHOPS_TABLE || 'see-before-buy-shops',
  USAGE_LOGS: process.env.DYNAMODB_USAGE_LOGS_TABLE || 'see-before-buy-usage-logs',
};

// Initialize DynamoDB (check connection)
function initializeDynamoDB() {
  console.log('✅ DynamoDB client initialized');
  console.log(`   Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  console.log(`   Shops Table: ${TABLES.SHOPS}`);
  console.log(`   Usage Logs Table: ${TABLES.USAGE_LOGS}`);
}

module.exports = {
  docClient,
  TABLES,
  initializeDynamoDB,
};
