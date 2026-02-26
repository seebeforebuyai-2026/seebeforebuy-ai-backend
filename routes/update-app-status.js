/**
 * ============================================
 * UPDATE APP STATUS ROUTE
 * ============================================
 * 
 * This endpoint updates the app activation status.
 * Called when merchant activates the app (adds theme extension).
 */

const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');

/**
 * POST /api/merchant/update-app-status
 * 
 * Update app status (disabled → active)
 */
router.post('/', async (req, res) => {
  try {
    const { shop_domain, status } = req.body;

    console.log('🔄 Updating app status...');
    console.log('   Shop domain:', shop_domain);
    console.log('   New status:', status);

    // Validation
    if (!shop_domain) {
      return res.status(400).json({ 
        error: 'shop_domain is required' 
      });
    }

    if (!status || !['disabled', 'active'].includes(status)) {
      return res.status(400).json({ 
        error: 'status must be either "disabled" or "active"' 
      });
    }

    // Check if shop exists
    const shop = await ShopModel.findOne(shop_domain);
    
    if (!shop) {
      return res.status(404).json({
        error: 'Shop not found',
        message: 'Please create an account first'
      });
    }

    // Update app status
    const updatedShop = await ShopModel.updateAppStatus(shop_domain, status);

    console.log(`✅ App status updated to: ${status}`);

    // Return success response
    res.json({
      success: true,
      message: `App status updated to ${status}`,
      shop: {
        shop_domain: updatedShop.shop_domain,
        app_status: updatedShop.app_status,
        updated_at: updatedShop.updated_at,
      },
    });

  } catch (error) {
    console.error('❌ Error updating app status:', error);
    res.status(500).json({ 
      error: 'Failed to update app status',
      message: error.message 
    });
  }
});

module.exports = router;
