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
      images_limit: images_limit || 15,
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
