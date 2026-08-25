/**
 * POST /api/mark-uninstalled
 * Called by app/uninstalled webhook.
 * Sets install_status = "uninstalled" AND resets plan to free in DynamoDB.
 *
 * DELETE /api/mark-uninstalled
 * Called by the app loader when reinstall is detected.
 * Sets install_status = "installed".
 */
const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');

// POST: uninstall → set status=uninstalled + reset plan to free
router.post('/', async (req, res) => {
  try {
    const { shop_domain } = req.body;
    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }

    // Ensure record exists
    await ShopModel.findOrCreate(shop_domain);

    // Set status to uninstalled + reset plan to free
    const updated = await ShopModel.setInstallStatus(shop_domain, 'uninstalled');

    console.log(`✅ /mark-uninstalled: ${shop_domain} → install_status=uninstalled, plan=free`);
    return res.json({
      success: true,
      install_status: updated.install_status,
      plan_type: updated.plan_type,
      images_limit: updated.images_limit,
    });
  } catch (err) {
    console.error('❌ mark-uninstalled POST error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE: reinstall detected → set status=installed (clear uninstalled state)
router.delete('/', async (req, res) => {
  try {
    const { shop_domain } = req.body;
    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }

    await ShopModel.setInstallStatus(shop_domain, 'installed');

    console.log(`✅ /mark-uninstalled cleared: ${shop_domain} → install_status=installed`);
    return res.json({ success: true, install_status: 'installed' });
  } catch (err) {
    console.error('❌ mark-uninstalled DELETE error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
