// Script to create DynamoDB tables
require('dotenv').config();
const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const SHOPS_TABLE = process.env.DYNAMODB_SHOPS_TABLE || 'see-before-buy-shops';
const USAGE_LOGS_TABLE = process.env.DYNAMODB_USAGE_LOGS_TABLE || 'see-before-buy-usage-logs';

async function createShopsTable() {
  try {
    const command = new CreateTableCommand({
      TableName: SHOPS_TABLE,
      KeySchema: [
        { AttributeName: 'shop_domain', KeyType: 'HASH' }, // Partition key
      ],
      AttributeDefinitions: [
        { AttributeName: 'shop_domain', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST', // On-demand pricing
    });

    await client.send(command);
    console.log(`✅ Table created: ${SHOPS_TABLE}`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`ℹ️  Table already exists: ${SHOPS_TABLE}`);
    } else {
      console.error(`❌ Error creating ${SHOPS_TABLE}:`, error.message);
    }
  }
}

async function createUsageLogsTable() {
  try {
    const command = new CreateTableCommand({
      TableName: USAGE_LOGS_TABLE,
      KeySchema: [
        { AttributeName: 'log_id', KeyType: 'HASH' }, // Partition key
      ],
      AttributeDefinitions: [
        { AttributeName: 'log_id', AttributeType: 'S' },
        { AttributeName: 'shop_domain', AttributeType: 'S' },
        { AttributeName: 'created_at', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'shop_domain-created_at-index',
          KeySchema: [
            { AttributeName: 'shop_domain', KeyType: 'HASH' },
            { AttributeName: 'created_at', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'ALL',
          },
        },
      ],
      BillingMode: 'PAY_PER_REQUEST', // On-demand pricing
    });

    await client.send(command);
    console.log(`✅ Table created: ${USAGE_LOGS_TABLE}`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`ℹ️  Table already exists: ${USAGE_LOGS_TABLE}`);
    } else {
      console.error(`❌ Error creating ${USAGE_LOGS_TABLE}:`, error.message);
    }
  }
}

async function listTables() {
  try {
    const command = new ListTablesCommand({});
    const response = await client.send(command);
    console.log('\n📋 Existing tables:');
    response.TableNames.forEach(name => console.log(`   - ${name}`));
  } catch (error) {
    console.error('❌ Error listing tables:', error.message);
  }
}

async function main() {
  console.log('🚀 Creating DynamoDB tables...\n');
  
  await createShopsTable();
  await createUsageLogsTable();
  
  console.log('\n⏳ Waiting for tables to be active...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  await listTables();
  
  console.log('\n✅ Setup complete!');
}

main().catch(console.error);
