/**
 * Reset usage for a specific shop
 * Usage: node scripts/reset-usage.js <shop_domain>
 */

require('dotenv').config();
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../config/dynamodb');

async function resetUsage(shopDomain) {
  try {
    console.log('🔄 Resetting usage for:', shopDomain);
    
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain: shopDomain },
      UpdateExpression: 'SET images_used = :zero, updated_at = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }));
    
    console.log('✅ Usage reset successfully!');
    console.log('   Shop:', result.Attributes.shop_domain);
    console.log('   Plan:', result.Attributes.plan_type);
    console.log('   Used:', result.Attributes.images_used);
    console.log('   Limit:', result.Attributes.images_limit);
    
  } catch (error) {
    console.error('❌ Error resetting usage:', error.message);
  }
}

// Get shop domain from command line
const shopDomain = process.argv[2] || 'see-before-buy-ai.myshopify.com';

resetUsage(shopDomain);
