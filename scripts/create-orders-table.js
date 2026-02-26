// Create DynamoDB orders table for revenue tracking
require('dotenv').config();
const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ORDERS_TABLE = 'see-before-buy-orders';

async function createOrdersTable() {
  try {
    console.log(`📦 Creating table: ${ORDERS_TABLE}...`);

    const command = new CreateTableCommand({
      TableName: ORDERS_TABLE,
      KeySchema: [
        { AttributeName: 'order_id', KeyType: 'HASH' }, // Partition key
      ],
      AttributeDefinitions: [
        { AttributeName: 'order_id', AttributeType: 'S' },
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
    console.log(`✅ Table created: ${ORDERS_TABLE}`);

  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`⚠️  Table already exists: ${ORDERS_TABLE}`);
    } else {
      console.error('❌ Error creating table:', error);
      throw error;
    }
  }
}

// Run if called directly
if (require.main === module) {
  createOrdersTable()
    .then(() => {
      console.log('✅ Orders table setup complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { createOrdersTable };
