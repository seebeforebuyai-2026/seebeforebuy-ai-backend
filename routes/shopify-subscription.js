/**
 * POST /api/shopify-subscription-activated
 *
 * Called by our Shopify app (app.billing.jsx loader) after Shopify
 * redirects the merchant back following a successful subscription.
 *
 * Shopify App Pricing (managed) does NOT send us the plan details directly.
 * We receive the charge_id and use it to determine which plan was activated.
 *
 * For now we use a simple approach: the app sends us the plan name
 * derived from the charge, and we activate accordingly.
 */

const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');

// Plan name → credits mapping (must match Partner Dashboard plan names exactly)
const PLAN_CREDITS = {
  'Standard': { images_limit: 500, plan_type: 'starter' },
  'Growth':   { images_limit: 1000, plan_type: 'growth' },
  'Scale':    { images_limit: 10000, plan_type: 'pro' },
  // Lowercase fallbacks
  'standard': { images_limit: 500, plan_type: 'starter' },
  'growth':   { images_limit: 1000, plan_type: 'growth' },
  'scale':    { images_limit: 10000, plan_type: 'pro' },
  // Free / uninstall reset
  'free': { images_limit: 50, plan_type: 'free' },
};

router.post('/', async (req, res) => {
  try {
    const { shop_domain, charge_id, plan_name, reason } = req.body;

    console.log('💳 Shopify subscription activated:');
    console.log('   Shop:', shop_domain);
    console.log('   Charge ID:', charge_id);
    console.log('   Plan Name:', plan_name);
    if (reason) console.log('   Reason:', reason);

    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }

    // Find or create the shop (handles case where shop just reinstalled)
    const shop = await ShopModel.findOrCreate(shop_domain);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found and could not be created' });
    }

    // ── On uninstall / downgrade to free: reset to free plan ──────────────
    const isFreePlan = (plan_name || '').toLowerCase() === 'free'
      || reason === 'app_uninstalled'
      || reason === 'no_active_shopify_subscription'
      || reason === 'subscription_cancelled'
      || reason === 'subscription_expired'
      || reason === 'subscription_frozen';

    if (isFreePlan) {
      // For uninstall/cancellation: full reset including images_used = 0
      const updatedShop = await ShopModel.updatePlan(shop_domain, {
        plan_type: 'free',
        images_limit: 50,
        shopify_charge_id: null,
      });
      console.log(`✅ Plan reset to free: ${shop_domain} (reason: ${reason || 'downgrade'})`);
      return res.json({
        success: true,
        message: 'Plan reset to free',
        shop: {
          domain: updatedShop.shop_domain,
          plan: updatedShop.plan_type,
          images_limit: updatedShop.images_limit,
        },
      });
    }

    // ── loader_sync: only update plan_type, do NOT reset images_used ──────
    // This prevents wiping usage counters on every page load
    if (reason === 'loader_sync') {
      let syncPlanType = 'starter';
      let syncLimit = 500;
      const lowerName = (plan_name || '').toLowerCase();
      if (lowerName.includes('scale')) { syncPlanType = 'pro'; syncLimit = 10000; }
      else if (lowerName.includes('growth')) { syncPlanType = 'growth'; syncLimit = 1000; }
      else if (lowerName.includes('standard')) { syncPlanType = 'starter'; syncLimit = 500; }
      else if (req.body.images_limit) {
        const lim = parseInt(req.body.images_limit);
        if (lim >= 10000) { syncPlanType = 'pro'; syncLimit = 10000; }
        else if (lim >= 1000) { syncPlanType = 'growth'; syncLimit = 1000; }
      }
      const updatedShop = await ShopModel.syncPlanType(shop_domain, syncPlanType, syncLimit);
      console.log(`🔄 Plan synced (no usage reset): ${shop_domain} → ${syncPlanType}`);
      return res.json({ success: true, message: 'Plan synced', shop: { domain: shop_domain, plan: syncPlanType } });
    }

    // Determine plan from plan_name or images_limit if provided directly
    let planConfig = null;

    if (req.body.images_limit) {
      // Direct images_limit from app — most reliable
      const limit = parseInt(req.body.images_limit);
      if (limit >= 10000) planConfig = { images_limit: 10000, plan_type: 'pro' };
      else if (limit >= 1000) planConfig = { images_limit: 1000, plan_type: 'growth' };
      else planConfig = { images_limit: 500, plan_type: 'starter' };
    } else if (plan_name) {
      planConfig = PLAN_CREDITS[plan_name] || null;
    }

    if (!planConfig) {
      console.log('⚠️  Unknown plan, defaulting to Standard');
      planConfig = PLAN_CREDITS['Standard'];
    }

    // Activate plan — reset usage, set new limit
    const updatedShop = await ShopModel.updatePlan(shop_domain, {
      plan_type: planConfig.plan_type,
      images_limit: planConfig.images_limit,
      shopify_charge_id: charge_id || null,
    });

    console.log(`✅ Plan activated: ${shop_domain} → ${planConfig.plan_type} (${planConfig.images_limit} credits)`);

    res.json({
      success: true,
      message: 'Subscription activated successfully',
      shop: {
        domain: updatedShop.shop_domain,
        plan: updatedShop.plan_type,
        images_limit: updatedShop.images_limit,
      },
    });

  } catch (error) {
    console.error('❌ Error activating subscription:', error.message);
    res.status(500).json({
      error: 'Failed to activate subscription',
      message: error.message,
    });
  }
});

module.exports = router;
