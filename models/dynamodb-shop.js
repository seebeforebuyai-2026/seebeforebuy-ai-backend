// Shop operations for DynamoDB
const { PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../config/dynamodb');

class ShopModel {
  // Create new shop (for onboarding)
  static async create(shopData) {
    try {
      await docClient.send(new PutCommand({
        TableName: TABLES.SHOPS,
        Item: shopData,
      }));

      console.log(`✅ Shop created: ${shopData.shop_domain}`);
      return shopData;

    } catch (error) {
      console.error('❌ Error creating shop:', error);
      throw error;
    }
  }

  // Create or get shop
  static async findOrCreate(shop_domain) {
    try {
      // Try to get existing shop
      const shop = await this.findOne(shop_domain);
      
      if (shop) {
        return shop;
      }

      // Create new shop with free tier
      const newShop = {
        shop_domain,
        shop_id: shop_domain.split('.')[0],
        plan_type: 'free',
        images_used: 0,
        images_limit: 15,
        is_active: true,
        app_status: 'disabled', // New field for activation status
        product_category: null, // Single category (apparel, jewellery, footwear, accessories)
        shop_settings: null, // Will be set when merchant customizes (defaults applied in frontend/theme)
        external_user_id: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        last_reset_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await docClient.send(new PutCommand({
        TableName: TABLES.SHOPS,
        Item: newShop,
      }));

      console.log(`✅ New shop created: ${shop_domain}`);
      return newShop;

    } catch (error) {
      console.error('❌ Error in findOrCreate:', error);
      throw error;
    }
  }

  // Find shop by domain
  static async findOne(shop_domain) {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: TABLES.SHOPS,
        Key: { shop_domain },
      }));

      return result.Item || null;

    } catch (error) {
      console.error('❌ Error finding shop:', error);
      throw error;
    }
  }

  // Check if shop can generate images
  static canGenerateImage(shop) {
    return shop.is_active && shop.images_used < shop.images_limit;
  }

  // Increment usage
  static async incrementUsage(shop_domain) {
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLES.SHOPS,
        Key: { shop_domain },
        UpdateExpression: 'SET images_used = images_used + :inc, updated_at = :now',
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }));

      return result.Attributes;

    } catch (error) {
      console.error('❌ Error incrementing usage:', error);
      throw error;
    }
  }

  // Update shop plan
  static async updatePlan(shop_domain, planData) {
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLES.SHOPS,
        Key: { shop_domain },
        UpdateExpression: `
          SET plan_type = :plan,
              images_limit = :limit,
              images_used = :zero,
              external_user_id = :user_id,
              stripe_customer_id = :customer_id,
              stripe_subscription_id = :subscription_id,
              last_reset_at = :now,
              updated_at = :now
        `,
        ExpressionAttributeValues: {
          ':plan': planData.plan_type,
          ':limit': planData.images_limit,
          ':zero': 0,
          ':user_id': planData.external_user_id || null,
          ':customer_id': planData.stripe_customer_id || null,
          ':subscription_id': planData.stripe_subscription_id || null,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }));

      return result.Attributes;

    } catch (error) {
      console.error('❌ Error updating plan:', error);
      throw error;
    }
  }

  // Reset monthly usage
  static async resetMonthlyUsage(shop_domain) {
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLES.SHOPS,
        Key: { shop_domain },
        UpdateExpression: 'SET images_used = :zero, last_reset_at = :now, updated_at = :now',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }));

      return result.Attributes;

    } catch (error) {
      console.error('❌ Error resetting usage:', error);
      throw error;
    }
  }

  // Update app status (disabled/active)
  static async updateAppStatus(shop_domain, status) {
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLES.SHOPS,
        Key: { shop_domain },
        UpdateExpression: 'SET app_status = :status, updated_at = :now',
        ExpressionAttributeValues: {
          ':status': status,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }));

      console.log(`✅ App status updated to: ${status}`);
      return result.Attributes;

    } catch (error) {
      console.error('❌ Error updating app status:', error);
      throw error;
    }
  }

  // Update order sync tracking
  static async updateOrderSync(shop_domain, syncData) {
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLES.SHOPS,
        Key: { shop_domain },
        UpdateExpression: 'SET #order_sync = :sync_data, updated_at = :now',
        ExpressionAttributeNames: {
          '#order_sync': 'order_sync',
        },
        ExpressionAttributeValues: {
          ':sync_data': syncData,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }));

      return result.Attributes;

    } catch (error) {
      console.error('❌ Error updating order sync:', error);
      throw error;
    }
  }

  // Set syncing flag
  static async setSyncingFlag(shop_domain, is_syncing) {
    try {
      // First, get the shop to check current order_sync state
      const shop = await this.findOne(shop_domain);
      
      if (!shop) {
        throw new Error('Shop not found');
      }

      // Prepare order_sync object (merge with existing or create new)
      const orderSync = {
        is_syncing: is_syncing,
        last_sync_time: shop.order_sync?.last_sync_time || null,
        last_synced_order_id: shop.order_sync?.last_synced_order_id || null,
        last_synced_order_number: shop.order_sync?.last_synced_order_number || null,
        last_synced_order_created_at: shop.order_sync?.last_synced_order_created_at || null,
        total_orders_synced: shop.order_sync?.total_orders_synced || 0,
        last_sync_count: shop.order_sync?.last_sync_count || 0,
      };

      // Always replace the entire order_sync object (simpler and safer)
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLES.SHOPS,
        Key: { shop_domain },
        UpdateExpression: 'SET order_sync = :sync_data, updated_at = :now',
        ExpressionAttributeValues: {
          ':sync_data': orderSync,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }));

      return result.Attributes;

    } catch (error) {
      console.error('❌ Error setting syncing flag:', error);
      throw error;
    }
  }
}

module.exports = ShopModel;
