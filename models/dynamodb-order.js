// Order operations for DynamoDB
const { PutCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../config/dynamodb');

const ORDERS_TABLE = 'see-before-buy-orders';

class OrderModel {
  // Check if order exists (prevent duplicates)
  static async exists(order_id) {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: ORDERS_TABLE,
        Key: { order_id: order_id.toString() },
      }));

      return !!result.Item;
    } catch (error) {
      console.error('❌ Error checking order existence:', error);
      return false;
    }
  }

  // Create order record (with duplicate prevention)
  static async create(orderData) {
    try {
      const order = {
        order_id: orderData.order_id.toString(),
        shop_domain: orderData.shop_domain,
        order_number: orderData.order_number,
        total_price: parseFloat(orderData.total_price),
        currency: orderData.currency || 'USD',
        customer_email: orderData.customer_email || null,
        line_items: orderData.line_items || [],
        has_sbb_items: orderData.has_sbb_items || false,
        sbb_session_ids: orderData.sbb_session_ids || [],
        created_at: orderData.created_at || new Date().toISOString(),
        synced_at: new Date().toISOString(),
      };

      // Use conditional write to prevent duplicates
      await docClient.send(new PutCommand({
        TableName: ORDERS_TABLE,
        Item: order,
        ConditionExpression: 'attribute_not_exists(order_id)',
      }));

      console.log(`✅ Order created: ${order.order_id} - $${order.total_price}`);
      return order;

    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.log(`⏭️  Order already exists: ${orderData.order_id}`);
        return null; // Already exists, not an error
      }
      console.error('❌ Error creating order:', error);
      throw error;
    }
  }

  // Get orders for a shop
  static async findByShop(shop_domain, limit = 100) {
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: ORDERS_TABLE,
        IndexName: 'shop_domain-created_at-index',
        KeyConditionExpression: 'shop_domain = :domain',
        ExpressionAttributeValues: {
          ':domain': shop_domain,
        },
        ScanIndexForward: false, // Sort descending (newest first)
        Limit: limit,
      }));

      return result.Items || [];

    } catch (error) {
      console.error('❌ Error finding orders:', error);
      return [];
    }
  }

  // Calculate revenue stats for a shop
  static async getRevenueStats(shop_domain) {
    try {
      const orders = await this.findByShop(shop_domain, 1000);

      // Filter only orders with See Before Buy items
      const sbbOrders = orders.filter(order => order.has_sbb_items);

      const totalRevenue = sbbOrders.reduce((sum, order) => sum + order.total_price, 0);
      const totalOrders = sbbOrders.length;

      return {
        total_revenue: totalRevenue,
        total_orders: totalOrders,
        orders: sbbOrders,
      };

    } catch (error) {
      console.error('❌ Error calculating revenue stats:', error);
      return {
        total_revenue: 0,
        total_orders: 0,
        orders: [],
      };
    }
  }
}

module.exports = OrderModel;
