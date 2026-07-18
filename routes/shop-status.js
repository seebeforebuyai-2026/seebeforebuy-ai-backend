// Shop status route - get shop information and usage stats
const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');
const UsageLogModel = require('../models/dynamodb-usage-log');
const OrderModel = require('../models/dynamodb-order');

// Get shop status and usage
router.get('/:shop_domain', async (req, res) => {
  try {
    const { shop_domain } = req.params;

    // Check if shop exists (DON'T auto-create)
    const shop = await ShopModel.findOne(shop_domain);

    // If shop doesn't exist, return accountExists: false
    if (!shop) {
      console.log('🆕 New shop detected:', shop_domain);
      return res.json({
        accountExists: false,
        shop: null,
        shopStatus: null,
        usage: null,
        stats: null,
        metrics: null,
        top_products: []
      });
    }

    // Shop exists, get usage statistics
    const stats = await UsageLogModel.getStats(shop_domain);

    // Count unique users
    const uniqueUsers = await UsageLogModel.countUniqueUsers(shop_domain);
    console.log('👥 Unique users count:', uniqueUsers);

    // Get product analytics (top 5 products)
    const topProducts = await UsageLogModel.getProductAnalytics(shop_domain, 5);

    // Get revenue stats
    const revenueStats = await OrderModel.getRevenueStats(shop_domain);

    // Calculate metrics
    const tryOnGenerated = stats.image_generated || 0;
    const addToCartCount = stats.add_to_cart || 0;
    const addToCartRate = tryOnGenerated > 0 
      ? ((addToCartCount / tryOnGenerated) * 100).toFixed(1) 
      : 0;
    const creditRemaining = shop.images_limit - shop.images_used;
    const creditUsed = shop.images_used;

    // Calculate average try-on per product
    const totalProducts = topProducts.length;
    const avgTryOnPerProduct = totalProducts > 0 
      ? (tryOnGenerated / totalProducts).toFixed(1)
      : 0;

    // Calculate revenue per try-on
    const revenuePerTryOn = tryOnGenerated > 0
      ? (revenueStats.total_revenue / tryOnGenerated).toFixed(2)
      : 0;

    console.log('📊 Metrics being sent:', {
      try_on_generated: tryOnGenerated,
      unique_users: uniqueUsers,
      add_to_cart_count: addToCartCount,
      add_to_cart_rate: parseFloat(addToCartRate),
      credit_remaining: creditRemaining,
      credit_used: creditUsed,
      avg_try_on_per_product: parseFloat(avgTryOnPerProduct),
      top_products_count: topProducts.length,
      total_revenue: revenueStats.total_revenue,
      total_orders: revenueStats.total_orders,
      revenue_per_try_on: parseFloat(revenuePerTryOn)
    });

    res.json({
      accountExists: true,
      shop: {
        domain: shop.shop_domain,
        plan: shop.plan_type,
        is_active: shop.is_active,
        app_status: shop.app_status || 'disabled' // Add app_status field
      },
      shopStatus: shop, // Return full shop object for order_sync info
      usage: {
        used: shop.images_used,
        limit: shop.images_limit,
        remaining: shop.images_limit - shop.images_used
      },
      stats: {
        total_images_generated: stats.image_generated || 0,
        total_add_to_cart: stats.add_to_cart || 0,
        total_limit_reached: stats.limit_reached || 0
      },
      metrics: {
        try_on_generated: tryOnGenerated,
        unique_users: uniqueUsers,  // Add unique users count
        add_to_cart_count: addToCartCount,
        add_to_cart_rate: parseFloat(addToCartRate),
        credit_remaining: creditRemaining,
        credit_used: creditUsed,
        avg_try_on_per_product: parseFloat(avgTryOnPerProduct),
        total_revenue: revenueStats.total_revenue,
        total_orders: revenueStats.total_orders,
        revenue_per_try_on: parseFloat(revenuePerTryOn)
      },
      top_products: topProducts
    });

  } catch (error) {
    console.error('❌ Error getting shop status:', error);
    res.status(500).json({ 
      error: 'Failed to get shop status',
      message: error.message 
    });
  }
});

// ── POST /api/shop-status/:shop_domain/fetch-orders-snapshot ─────────────────
// Triggers a recalculation of the orders snapshot from already-synced DynamoDB orders
// (Direct Shopify calls require valid session tokens which only the Shopify app has)
router.post('/:shop_domain/fetch-orders-snapshot', async (req, res) => {
  try {
    const { shop_domain } = req.params;
    const shop = await ShopModel.findOne(shop_domain);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    // Use orders already in DynamoDB (synced by Shopify app)
    const allOrders = await OrderModel.findByShop(shop_domain, 1000);

    if (allOrders.length === 0) {
      return res.json({
        success: false,
        message: 'No orders found. Please click "Sync Orders" in the Shopify app dashboard first, then try again.',
        total_orders: 0,
      });
    }

    // Calculate daily averages from all synced orders
    const installDate   = new Date(shop.created_at);
    const daysCovered   = Math.max(1, Math.ceil((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24)));
    const totalOrders   = allOrders.length;
    const totalRevenue  = allOrders.reduce((s, o) => s + (o.total_price || 0), 0);
    const dailyOrders   = totalOrders / daysCovered;
    const dailyRevenue  = totalRevenue / daysCovered;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Also check last 24h specifically
    const since24h   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const orders24h  = allOrders.filter(o => (o.created_at || '') >= since24h);
    const has24hData = orders24h.length > 0;

    console.log(`📊 Snapshot from DB: ${totalOrders} orders, ${dailyOrders.toFixed(1)}/day, last 24h: ${orders24h.length}`);

    // Store snapshot
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLES } = require('../config/dynamodb');
    await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain },
      UpdateExpression: 'SET orders_snapshot = :snap, updated_at = :now',
      ExpressionAttributeValues: {
        ':snap': {
          total_orders:    totalOrders,
          total_revenue:   parseFloat(totalRevenue.toFixed(2)),
          daily_orders:    parseFloat(dailyOrders.toFixed(2)),
          daily_revenue:   parseFloat(dailyRevenue.toFixed(2)),
          avg_order_value: parseFloat(avgOrderValue.toFixed(2)),
          days_covered:    daysCovered,
          last_fetched_at: new Date().toISOString(),
          has_24h_data:    has24hData,
          orders_24h:      orders24h.length,
        },
        ':now': new Date().toISOString(),
      },
    }));

    res.json({
      success: true,
      message: `Calculated from ${totalOrders} synced orders over ${daysCovered} days`,
      snapshot: {
        total_orders:    totalOrders,
        total_revenue:   parseFloat(totalRevenue.toFixed(2)),
        daily_orders:    parseFloat(dailyOrders.toFixed(2)),
        daily_revenue:   parseFloat(dailyRevenue.toFixed(2)),
        avg_order_value: parseFloat(avgOrderValue.toFixed(2)),
        days_covered:    daysCovered,
        orders_last_24h: orders24h.length,
      },
    });

  } catch (error) {
    console.error('❌ Fetch orders snapshot error:', error);
    res.status(500).json({ error: 'Failed to calculate snapshot', message: error.message });
  }
});

// ── GET /api/shop-status/:shop_domain/predicted-impact ────────────────────────
// Fetches real last-24h orders from Shopify directly + calculates cumulative predicted metrics
router.get('/:shop_domain/predicted-impact', async (req, res) => {
  try {
    const { shop_domain } = req.params;
    const shop = await ShopModel.findOne(shop_domain);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    // ── Step 1: Get orders from DynamoDB (synced via the Shopify app) ────────
    // Direct Shopify calls from backend fail due to token scope issues.
    // Orders are synced by the Shopify app which has valid session tokens.
    let totalOrders24h = 0;
    let totalRevenue24h = 0;
    let dataSource = 'db';

    // Try last 24h from orders table (all orders, not just SBB)
    const allOrders = await OrderModel.findByShop(shop_domain, 1000);
    const since24h  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const orders24h = allOrders.filter(o => (o.created_at || '') >= since24h);

    if (orders24h.length > 0) {
      totalOrders24h  = orders24h.length;
      totalRevenue24h = orders24h.reduce((s, o) => s + (o.total_price || 0), 0);
      dataSource = 'db_24h';
      console.log(`📦 DB 24h: ${totalOrders24h} orders, ₹${totalRevenue24h.toFixed(0)}`);
    } else if (allOrders.length > 0) {
      // Use all synced orders to calculate daily average
      const installDate  = new Date(shop.created_at);
      const daysSince    = Math.max(1, Math.ceil((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24)));
      totalOrders24h     = allOrders.length / daysSince;
      const totalRev     = allOrders.reduce((s, o) => s + (o.total_price || 0), 0);
      totalRevenue24h    = totalRev / daysSince;
      dataSource = 'db_avg';
      console.log(`📊 DB avg: ${totalOrders24h.toFixed(1)} orders/day from ${allOrders.length} total`);
    }

    // ── Fallback: use stored orders_snapshot (set by Refresh Data button) ────
    if (totalOrders24h === 0) {
      const snap = shop.orders_snapshot;
      if (snap && snap.daily_orders > 0) {
        totalOrders24h  = snap.daily_orders;
        totalRevenue24h = snap.daily_revenue;
        dataSource = 'snapshot';
        console.log(`📊 Snapshot: ${totalOrders24h} orders/day`);
      }
    }

    // ── Final fallback: estimate from whatever data we have ───────────────────
    if (totalOrders24h === 0) {
      const syncedTotal = shop.order_sync?.total_orders_synced || 0;
      const imagesUsed  = shop.images_used || 0;
      const installDate = new Date(shop.created_at);
      const daysSince   = Math.max(1, Math.ceil((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24)));
      if (syncedTotal > 0) {
        totalOrders24h  = Math.max(1, syncedTotal / daysSince);
        totalRevenue24h = totalOrders24h * 1000;
      } else if (imagesUsed > 0) {
        totalOrders24h  = Math.max(10, (imagesUsed / daysSince) / 0.08);
        totalRevenue24h = totalOrders24h * 800;
      } else {
        totalOrders24h  = 20;
        totalRevenue24h = 20000;
      }
      dataSource = 'estimate';
      console.log(`📊 Estimate: ${totalOrders24h.toFixed(1)} orders/day`);
    }

    // ── Step 3: STRICT formula — integer orders only ─────────────────────────
    // If 8% of store orders rounds to 0, the app gets 0 credit (not enough orders)
    // Orders: 10 → 0.8 → rounds to 1; less than that → 0 → all zeros
    const daily_app_orders   = Math.round(totalOrders24h * 0.08);
    const avg_order_value    = totalOrders24h > 0 ? totalRevenue24h / totalOrders24h : 0;
    // Revenue = actual revenue of those specific orders (avg × app orders)
    const daily_app_revenue  = parseFloat((daily_app_orders * avg_order_value).toFixed(2));
    // Unique Users = App Orders / 2% (EXACTLY as specified)
    const daily_unique_users = daily_app_orders > 0 ? Math.round(daily_app_orders / 0.02) : 0;
    // Try-ons = Unique Users × 1.7 (EXACTLY as specified)
    const daily_try_ons      = Math.round(daily_unique_users * 1.7);
    // Revenue per Try-on = Total Revenue / Try-ons Generated (EXACTLY as specified)
    const daily_rev_per_try  = daily_try_ons > 0 ? parseFloat((daily_app_revenue / daily_try_ons).toFixed(2)) : 0;

    // ── Step 4: Calculate CUMULATIVE (days since install × daily) ─────────────
    // "Day N" shows what the merchant has accumulated since installing the app
    const installDate  = new Date(shop.created_at);
    const daysSince    = Math.max(1, Math.ceil((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24)));
    // Cap at 30 days (reset monthly) — cumulative resets every 30 days
    const cumDays      = ((daysSince - 1) % 30) + 1;

    const cum_app_orders  = daily_app_orders * cumDays;
    const cum_app_revenue = parseFloat((daily_app_revenue * cumDays).toFixed(2));
    const cum_unique_users = daily_unique_users * cumDays;
    const cum_try_ons     = daily_try_ons * cumDays;
    const cum_rev_per_try = cum_try_ons > 0 ? parseFloat((cum_app_revenue / cum_try_ons).toFixed(2)) : 0;

    console.log(`📊 Predicted impact — Day ${cumDays}/30 since install`);
    console.log(`   Daily: ${daily_app_orders} orders, ₹${daily_app_revenue}`);
    console.log(`   Cumulative: ${cum_app_orders} orders, ₹${cum_app_revenue}`);

    res.json({
      success: true,
      store_last_24h: {
        total_orders: totalOrders24h,
        total_revenue: parseFloat(totalRevenue24h.toFixed(2)),
        data_source: dataSource,
      },
      days_since_install: daysSince,
      cycle_day: cumDays,
      // Daily = what app drives on ONE typical day
      daily: {
        orders_via_app:     daily_app_orders,
        revenue_via_app:    daily_app_revenue,
        unique_users:       daily_unique_users,
        try_ons_generated:  daily_try_ons,
        revenue_per_try_on: daily_rev_per_try,
      },
      // Predicted = cumulative since install (grows daily, resets at 30)
      predicted: {
        orders_via_app:     cum_app_orders,
        revenue_via_app:    cum_app_revenue,
        unique_users:       cum_unique_users,
        try_ons_generated:  cum_try_ons,
        revenue_per_try_on: cum_rev_per_try,
      },
    });

  } catch (error) {
    console.error('❌ Predicted impact error:', error);
    res.status(500).json({ error: 'Failed to calculate predicted impact', message: error.message });
  }
});

// Update shop plan (called from external website after payment)
router.post('/upgrade-plan', async (req, res) => {
  try {
    const { 
      shop_domain, 
      plan_type, 
      images_limit,
      external_user_id,
      stripe_customer_id,
      stripe_subscription_id
    } = req.body;

    // Validation
    if (!shop_domain || !plan_type) {
      return res.status(400).json({ 
        error: 'shop_domain and plan_type are required' 
      });
    }

    // Find shop
    const shop = await ShopModel.findOne(shop_domain);
    
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Update shop plan
    const updatedShop = await ShopModel.updatePlan(shop_domain, {
      plan_type,
      images_limit: images_limit || 50,
      external_user_id,
      stripe_customer_id,
      stripe_subscription_id,
    });

    console.log(`✅ Shop upgraded: ${shop_domain} -> ${plan_type}`);

    res.json({ 
      success: true,
      message: 'Plan upgraded successfully',
      shop: {
        domain: updatedShop.shop_domain,
        plan: updatedShop.plan_type,
        images_limit: updatedShop.images_limit
      }
    });

  } catch (error) {
    console.error('❌ Error upgrading plan:', error);
    res.status(500).json({ 
      error: 'Failed to upgrade plan',
      message: error.message 
    });
  }
});

module.exports = router;
