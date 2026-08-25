/**
 * POST /api/mark-uninstalled  — called by app/uninstalled webhook
 * DELETE /api/mark-uninstalled — called by loader on reinstall to clear flag
 */
const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');

// POST: mark shop as uninstalled + reset plan to free
router.post('/', async (req, res) => {
  try {
    const { shop_domain } = req.body;
    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }
    await ShopModel.findOrCreate(shop_domain);
    const updated = await ShopModel.markUninstalled(shop_domain);
    console.log(`✅ mark-uninstalled: ${shop_domain} → free, flag=true`);
    return res.json({
      success: true,
      plan_type: updated.plan_type,
      images_limit: updated.images_limit,
      app_uninstalled: updated.app_uninstalled,
    });
  } catch (err) {
    console.error('❌ mark-uninstalled POST error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE: clear the app_uninstalled flag after reinstall detected
router.delete('/', async (req, res) => {
  try {
    const { shop_domain } = req.body;
    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }
    await ShopModel.clearUninstalledFlag(shop_domain);
    console.log(`✅ mark-uninstalled cleared: ${shop_domain}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ mark-uninstalled DELETE error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
