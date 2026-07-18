// Sync orders from Shopify - Manual and Auto sync
const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');
const OrderModel = require('../models/dynamodb-order');
const ShopifyAPIService = require('../services/shopify-api');

/**
 * Sync orders from Shopify
 * POST /api/sync-orders
 * Body: { shop_domain, session }
 */
router.post('/', async (req, res) => {
  try {
    const { shop_domain, session } = req.body;

    if (!shop_domain || !session) {
      return res.status(400).json({ 
        error: 'shop_domain and session are required' 
      });
    }

    console.log('🔄 Starting order sync...');
    console.log('   Shop:', shop_domain);

    // Get shop data
    const shop = await ShopModel.findOne(shop_domain);
    
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Check if already syncing
    if (shop.order_sync?.is_syncing) {
      console.log('⏳ Sync already in progress');
      return res.json({
        success: false,
        message: 'Sync already in progress',
        is_syncing: true,
      });
    }

    // Set syncing flag
    await ShopModel.setSyncingFlag(shop_domain, true);

    try {
      // Determine sync strategy
      const lastSyncTime = shop.order_sync?.last_synced_order_created_at;
      const isFirstSync = !lastSyncTime;
      const syncStartDate = isFirstSync ? shop.created_at : lastSyncTime;

      console.log('   First sync:', isFirstSync, '| From:', syncStartDate);

      const fetchOptions = {
        limit: 250,
        created_at_min: syncStartDate,
      };

      // Save access_token to shop record so predicted-impact can call Shopify directly
      if (session.accessToken && !shop.access_token) {
        const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
        const { docClient, TABLES } = require('../config/dynamodb');
        await docClient.send(new UpdateCommand({
          TableName: TABLES.SHOPS,
          Key: { shop_domain },
          UpdateExpression: 'SET access_token = :token, updated_at = :now',
          ExpressionAttributeValues: { ':token': session.accessToken, ':now': new Date().toISOString() },
        }));
        console.log('   ✅ Access token saved to shop record');
      }

      // Fetch ALL orders from Shopify (not just SBB-filtered)
      // We store all orders so predicted-impact can use real store volume as baseline
      const allOrders = await ShopifyAPIService.fetchOrders(session, fetchOptions);

      // Separate SBB orders from all orders for tracking
      const sbbOrders = ShopifyAPIService.filterSBBOrders(allOrders);

      if (allOrders.length === 0) {
        console.log('   ℹ️  No new orders found');
        
        // Update sync time even if no new orders
        const syncData = {
          ...(shop.order_sync || {}),
          last_sync_time: new Date().toISOString(),
          is_syncing: false,
        };
        await ShopModel.updateOrderSync(shop_domain, syncData);

        return res.json({
          success: true,
          message: 'No new orders found',
          new_orders: 0,
          total_orders: shop.order_sync?.total_orders_synced || 0,
          last_sync_time: syncData.last_sync_time,
        });
      }

      // Sort orders by created_at (newest first)
      allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Store ALL orders (has_sbb_items = true/false based on whether SBB was used)
      let newOrdersCount = 0;
      let duplicatesSkipped = 0;
      let totalRevenue = 0;
      const sbbOrderIds = new Set(sbbOrders.map(o => o.id.toString()));

      for (const order of allOrders) {
        try {
          const isSBB = sbbOrderIds.has(order.id.toString());
          const sessionIds = isSBB ? ShopifyAPIService.extractSessionIds(order) : [];

          const created = await OrderModel.create({
            order_id: order.id,
            shop_domain: shop_domain,
            order_number: order.order_number || order.name,
            total_price: parseFloat(order.total_price || 0),
            currency: order.currency,
            customer_email: order.email,
            line_items: order.line_items.map(item => ({
              product_id: item.product_id,
              variant_id: item.variant_id,
              title: item.title,
              quantity: item.quantity,
              price: item.price,
            })),
            has_sbb_items: isSBB,
            sbb_session_ids: sessionIds,
            created_at: order.created_at,
          });

          if (created) {
            newOrdersCount++;
            totalRevenue += created.total_price;
          } else {
            duplicatesSkipped++;
          }

        } catch (error) {
          console.error(`❌ Error storing order ${order.id}:`, error);
        }
      }

      console.log(`✅ Sync complete:`);
      console.log(`   Total orders stored: ${newOrdersCount} (${sbbOrders.length} with SBB items)`);
      console.log(`   Duplicates skipped: ${duplicatesSkipped}`);
      console.log(`   Total revenue: ₹${totalRevenue.toFixed(2)}`);

      // Update sync tracking — use newest order from ALL orders
      const latestOrder = allOrders[0];
      const currentTotal = (shop.order_sync?.total_orders_synced || 0) + newOrdersCount;

      const syncData = {
        last_sync_time: new Date().toISOString(),
        last_synced_order_id: latestOrder.id.toString(),
        last_synced_order_number: latestOrder.order_number || latestOrder.name,
        last_synced_order_created_at: latestOrder.created_at,
        total_orders_synced: currentTotal,
        last_sync_count: newOrdersCount,
        is_syncing: false,
      };

      await ShopModel.updateOrderSync(shop_domain, syncData);

      // Return success
      res.json({
        success: true,
        message: `Synced ${newOrdersCount} new orders`,
        new_orders: newOrdersCount,
        duplicates_skipped: duplicatesSkipped,
        total_orders: currentTotal,
        total_revenue: totalRevenue,
        last_sync_time: syncData.last_sync_time,
      });

    } catch (error) {
      // Reset syncing flag on error
      await ShopModel.setSyncingFlag(shop_domain, false);
      throw error;
    }

  } catch (error) {
    console.error('❌ Error syncing orders:', error);
    res.status(500).json({ 
      error: 'Failed to sync orders',
      message: error.message 
    });
  }
});

module.exports = router;
