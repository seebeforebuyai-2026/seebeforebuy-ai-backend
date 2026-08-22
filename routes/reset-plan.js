/**
 * POST /api/reset-plan
 *
 * Admin utility to manually reset a shop's plan to free.
 * Used when the uninstall webhook didn't fire correctly,
 * or when testing the reinstall billing flow.
 *
 * Protected by ADMIN_SECRET env variable.
 */

const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');

router.post('/', async (req, res) => {
  try {
    const { shop_domain, admin_secret } = req.body;

    // Simple secret check to prevent abuse
    const expectedSecret = process.env.ADMIN_SECRET || 'sbb-admin-reset-2024';
    if (admin_secret !== expectedSecret) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }

    const shop = await ShopModel.findOne(shop_domain);
    if (!shop) {
      return res.status(404).json({ error: `Shop not found: ${shop_domain}` });
    }

    const before = { plan_type: shop.plan_type, images_limit: shop.images_limit };

    const updated = await ShopModel.updatePlan(shop_domain, {
      plan_type: 'free',
      images_limit: 50,
      shopify_charge_id: null,
    });

    console.log(`✅ Plan manually reset to free: ${shop_domain}`);
    console.log(`   Before: ${before.plan_type} (${before.images_limit} credits)`);
    console.log(`   After: free (50 credits)`);

    return res.json({
      success: true,
      message: `Plan reset to free for ${shop_domain}`,
      before,
      after: { plan_type: 'free', images_limit: 50 },
    });

  } catch (err) {
    console.error('❌ Error resetting plan:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
