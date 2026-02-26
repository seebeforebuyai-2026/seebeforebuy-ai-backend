// Track usage route - tracks add to cart and other events
const express = require('express');
const router = express.Router();
const UsageLogModel = require('../models/dynamodb-usage-log');
const ShopModel = require('../models/dynamodb-shop');

router.post('/', async (req, res) => {
  try {
    const { 
      shop_domain, 
      event_type, 
      product_id, 
      product_name 
    } = req.body;

    // Validation
    if (!shop_domain || !event_type) {
      return res.status(400).json({ 
        error: 'shop_domain and event_type are required' 
      });
    }

    // Find shop
    const shop = await ShopModel.findOne(shop_domain);
    
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Create usage log
    await UsageLogModel.create({
      shop_domain,
      shop_id: shop.shop_id,
      event_type,
      product_id,
      product_name,
    });

    console.log(`📊 Event tracked: ${event_type} for ${shop_domain}`);

    res.json({ 
      success: true,
      message: 'Event tracked successfully'
    });

  } catch (error) {
    console.error('❌ Error tracking usage:', error);
    res.status(500).json({ 
      error: 'Failed to track usage',
      message: error.message 
    });
  }
});

module.exports = router;
