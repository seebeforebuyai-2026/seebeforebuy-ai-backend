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
 * Save product category selections for a shop.
 * Supports multiple main categories and their subcategories.
 */
router.post('/', async (req, res) => {
  try {
    const { shop_domain, category, categories, subcategories } = req.body;

    console.log('💾 Saving product categories...');
    console.log('   Shop domain:', shop_domain);
    console.log('   Category:', category);
    console.log('   Categories:', categories);
    console.log('   Subcategories:', subcategories);

    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }

    const validCategories = [
      'indo_western',
      'party_wear',
      'winter_wear',
      'casual',
      'watch',
      'jewellery',
      // legacy values (keep for backward compat)
      'party_dresses',
    ];

    const parsedCategories = Array.isArray(categories)
      ? categories
      : (typeof category === 'string' ? [{ main_category: category, subcategories: [] }] : []);

    if (!parsedCategories.length) {
      return res.status(400).json({ error: 'At least one category is required' });
    }

    const normalizedCategories = parsedCategories
      .filter(Boolean)
      .map((entry) => {
        const mainCategory = typeof entry === 'string' ? entry : entry.main_category || entry.mainCategory;
        const subcategoryList = Array.isArray(entry.subcategories)
          ? entry.subcategories
          : (Array.isArray(subcategories) ? subcategories : []);

        if (!mainCategory || !validCategories.includes(mainCategory)) {
          throw new Error(`Invalid main category: ${mainCategory}`);
        }

        const normalizedSubcategories = (subcategoryList || [])
          .filter((item) => typeof item === 'string' && item.trim())
          .map((item) => item.trim());

        return {
          main_category: mainCategory,
          subcategories: normalizedSubcategories,
        };
      });

    const shop = await ShopModel.findOne(shop_domain);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient, TABLES } = require('../config/dynamodb');

    await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain },
      UpdateExpression: 'SET product_category = :category, product_categories = :categories, updated_at = :now',
      ExpressionAttributeValues: {
        ':category': normalizedCategories[0].main_category,
        ':categories': normalizedCategories,
        ':now': new Date().toISOString(),
      },
    }));

    console.log('✅ Categories saved successfully!');

    res.json({
      success: true,
      message: 'Categories saved successfully',
      categories: normalizedCategories,
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
