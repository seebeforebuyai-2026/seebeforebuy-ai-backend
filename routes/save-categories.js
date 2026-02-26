/**
 * ============================================
 * SAVE CATEGORIES ROUTE
 * ============================================
 * 
 * This endpoint saves the product categories selected by the merchant.
 * Categories are used to optimize AI prompts for better results.
 */

const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');

/**
 * POST /api/merchant/save-categories
 * 
 * Save product category for a shop (single category only)
 */
router.post('/', async (req, res) => {
  try {
    const { shop_domain, category } = req.body;

    console.log('💾 Saving product category...');
    console.log('   Shop domain:', shop_domain);
    console.log('   Category:', category);

    // Validation
    if (!shop_domain) {
      return res.status(400).json({ 
        error: 'shop_domain is required' 
      });
    }

    if (!category || typeof category !== 'string') {
      return res.status(400).json({ 
        error: 'category is required and must be a string' 
      });
    }

    // Validate category value (only 4 allowed)
    const validCategories = ['apparel', 'jewellery', 'footwear', 'accessories'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category. Must be one of: apparel, jewellery, footwear, accessories' 
      });
    }

    // Get existing shop
    const shop = await ShopModel.findOne(shop_domain);
    
    if (!shop) {
      return res.status(404).json({ 
        error: 'Shop not found' 
      });
    }

    // Update shop with single category using UpdateCommand
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLES } = require('../config/dynamodb');
    
    await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain },
      UpdateExpression: 'SET product_category = :category, updated_at = :now',
      ExpressionAttributeValues: {
        ':category': category,
        ':now': new Date().toISOString(),
      },
    }));

    console.log('✅ Category saved successfully!');

    res.json({
      success: true,
      message: 'Category saved successfully',
      category: category,
    });

  } catch (error) {
    console.error('❌ Error saving category:', error);
    res.status(500).json({ 
      error: 'Failed to save category',
      message: error.message 
    });
  }
});

module.exports = router;
