// Usage log operations for DynamoDB
const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../config/dynamodb');
const { v4: uuidv4 } = require('uuid');

class UsageLogModel {
  // Create usage log
  static async create(logData) {
    try {
      const log = {
        log_id: uuidv4(),
        shop_domain: logData.shop_domain,
        shop_id: logData.shop_id,
        event_type: logData.event_type,
        session_id: logData.session_id || null,  // Add session ID for unique user tracking
        product_id: logData.product_id || null,
        product_name: logData.product_name || null,
        product_image_url: logData.product_image_url || null,
        user_image_url: logData.user_image_url || null,
        generated_image_url: logData.generated_image_url || null,
        generation_time_ms: logData.generation_time_ms || null,
        created_at: new Date().toISOString(),
      };

      await docClient.send(new PutCommand({
        TableName: TABLES.USAGE_LOGS,
        Item: log,
      }));

      return log;

    } catch (error) {
      console.error('❌ Error creating usage log:', error);
      throw error;
    }
  }

  // Get logs for a shop
  static async findByShop(shop_domain, limit = 100) {
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.USAGE_LOGS,
        IndexName: 'shop_domain-created_at-index', // Requires GSI
        KeyConditionExpression: 'shop_domain = :domain',
        ExpressionAttributeValues: {
          ':domain': shop_domain,
        },
        ScanIndexForward: false, // Sort descending (newest first)
        Limit: limit,
      }));

      return result.Items || [];

    } catch (error) {
      console.error('❌ Error finding logs:', error);
      // If GSI doesn't exist, return empty array
      return [];
    }
  }

  // Get stats for a shop
  static async getStats(shop_domain) {
    try {
      const logs = await this.findByShop(shop_domain, 1000);

      const stats = {
        image_generated: 0,
        add_to_cart: 0,
        limit_reached: 0,
      };

      logs.forEach(log => {
        if (stats.hasOwnProperty(log.event_type)) {
          stats[log.event_type]++;
        }
      });

      return stats;

    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return {
        image_generated: 0,
        add_to_cart: 0,
        limit_reached: 0,
      };
    }
  }

  // Count unique users (by session_id)
  static async countUniqueUsers(shop_domain) {
    try {
      const logs = await this.findByShop(shop_domain, 1000);
      
      console.log(`🔍 Counting unique users for ${shop_domain}`);
      console.log(`   Total logs found: ${logs.length}`);
      
      // Get unique session IDs (filter out null/undefined)
      const sessionIds = logs.map(log => log.session_id);
      console.log(`   Session IDs in logs:`, sessionIds.slice(0, 10)); // Show first 10
      
      const uniqueSessions = new Set(
        logs
          .map(log => log.session_id)
          .filter(id => id && id !== null)
      );
      
      console.log(`   Unique session IDs found: ${uniqueSessions.size}`);
      console.log(`   Unique IDs:`, Array.from(uniqueSessions).slice(0, 5)); // Show first 5
      
      return uniqueSessions.size;

    } catch (error) {
      console.error('❌ Error counting unique users:', error);
      return 0;
    }
  }

  // Get product analytics (top products by try-on count)
  static async getProductAnalytics(shop_domain, limit = 5) {
    try {
      const logs = await this.findByShop(shop_domain, 1000);
      
      console.log(`📊 Calculating product analytics for ${shop_domain}`);
      console.log(`   Total logs: ${logs.length}`);
      
      // Group logs by product_name
      const productMap = {};
      
      logs.forEach(log => {
        const productName = log.product_name || 'Unknown Product';
        
        if (!productMap[productName]) {
          productMap[productName] = {
            product_name: productName,
            try_on_count: 0,
            add_to_cart_count: 0,
          };
        }
        
        if (log.event_type === 'image_generated') {
          productMap[productName].try_on_count++;
        } else if (log.event_type === 'add_to_cart') {
          productMap[productName].add_to_cart_count++;
        }
      });
      
      // Convert to array and calculate conversion rate
      const products = Object.values(productMap).map(product => ({
        product_name: product.product_name,
        try_on_count: product.try_on_count,
        add_to_cart_count: product.add_to_cart_count,
        conversion_rate: product.try_on_count > 0 
          ? ((product.add_to_cart_count / product.try_on_count) * 100).toFixed(1)
          : 0
      }));
      
      // Sort by try_on_count (highest first)
      products.sort((a, b) => b.try_on_count - a.try_on_count);
      
      // Return top N products
      const topProducts = products.slice(0, limit);
      
      console.log(`   Total unique products: ${products.length}`);
      console.log(`   Top ${limit} products:`, topProducts.map(p => p.product_name));
      
      return topProducts;

    } catch (error) {
      console.error('❌ Error getting product analytics:', error);
      return [];
    }
  }
}

module.exports = UsageLogModel;
