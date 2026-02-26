/**
 * ============================================
 * SETTINGS ROUTE
 * ============================================
 * 
 * This endpoint manages shop settings for button and popup customization.
 */

const express = require('express');
const router = express.Router();
const ShopModel = require('../models/dynamodb-shop');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../config/dynamodb');

/**
 * GET /api/settings/:shop_domain
 * 
 * Get current settings for a shop
 */
router.get('/:shop_domain', async (req, res) => {
  try {
    const { shop_domain } = req.params;

    console.log('🔍 Fetching settings for:', shop_domain);

    // Get shop
    const shop = await ShopModel.findOne(shop_domain);
    
    if (!shop) {
      return res.status(404).json({ 
        error: 'Shop not found' 
      });
    }

    // Return settings (with defaults if not set)
    const settings = shop.shop_settings || getDefaultSettings();

    console.log('✅ Settings fetched successfully');

    res.json({
      success: true,
      settings: settings,
    });

  } catch (error) {
    console.error('❌ Error fetching settings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch settings',
      message: error.message 
    });
  }
});

/**
 * POST /api/settings/:shop_domain
 * 
 * Save settings for a shop
 */
router.post('/:shop_domain', async (req, res) => {
  try {
    const { shop_domain } = req.params;
    const { settings } = req.body;

    console.log('💾 Saving settings for:', shop_domain);
    console.log('   Settings:', JSON.stringify(settings, null, 2));

    // Validation
    if (!settings) {
      return res.status(400).json({ 
        error: 'settings object is required' 
      });
    }

    // Validate settings structure
    const validationError = validateSettings(settings);
    if (validationError) {
      return res.status(400).json({ 
        error: validationError 
      });
    }

    // Get existing shop
    const shop = await ShopModel.findOne(shop_domain);
    
    if (!shop) {
      return res.status(404).json({ 
        error: 'Shop not found' 
      });
    }

    // Update shop with settings
    await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain },
      UpdateExpression: 'SET shop_settings = :settings, updated_at = :now',
      ExpressionAttributeValues: {
        ':settings': settings,
        ':now': new Date().toISOString(),
      },
    }));

    console.log('✅ Settings saved successfully!');

    res.json({
      success: true,
      message: 'Settings saved successfully',
      settings: settings,
    });

  } catch (error) {
    console.error('❌ Error saving settings:', error);
    res.status(500).json({ 
      error: 'Failed to save settings',
      message: error.message 
    });
  }
});

/**
 * Get default settings
 */
function getDefaultSettings() {
  return {
    button: {
      text: "See Before You Buy",
      bg_color: "#329580",
      text_color: "#FFFFFF",
      border_radius: 8,
      size: "medium"
    },
    popup: {
      title: "See Yourself in This Look",
      upload_button_text: "Upload Your Photo",
      generate_button_text: "Generate Preview",
      bg_color: "#FFFFFF",
      text_color: "#000000",
      border_radius: 12
    },
    add_to_cart_button: {
      text: "Add to Cart",
      bg_color: "#2a7f6d",
      text_color: "#FFFFFF",
      border_radius: 8,
      size: "medium"
    }
  };
}

/**
 * Validate settings structure
 */
function validateSettings(settings) {
  // Check button settings
  if (!settings.button) {
    return 'button settings are required';
  }

  if (typeof settings.button.text !== 'string' || settings.button.text.length === 0) {
    return 'button.text must be a non-empty string';
  }

  if (typeof settings.button.bg_color !== 'string' || !isValidColor(settings.button.bg_color)) {
    return 'button.bg_color must be a valid hex color';
  }

  if (typeof settings.button.text_color !== 'string' || !isValidColor(settings.button.text_color)) {
    return 'button.text_color must be a valid hex color';
  }

  if (typeof settings.button.border_radius !== 'number' || settings.button.border_radius < 0 || settings.button.border_radius > 50) {
    return 'button.border_radius must be a number between 0 and 50';
  }

  if (!['small', 'medium', 'large'].includes(settings.button.size)) {
    return 'button.size must be small, medium, or large';
  }

  // Check popup settings
  if (!settings.popup) {
    return 'popup settings are required';
  }

  if (typeof settings.popup.title !== 'string' || settings.popup.title.length === 0) {
    return 'popup.title must be a non-empty string';
  }

  if (typeof settings.popup.upload_button_text !== 'string' || settings.popup.upload_button_text.length === 0) {
    return 'popup.upload_button_text must be a non-empty string';
  }

  if (typeof settings.popup.generate_button_text !== 'string' || settings.popup.generate_button_text.length === 0) {
    return 'popup.generate_button_text must be a non-empty string';
  }

  if (typeof settings.popup.bg_color !== 'string' || !isValidColor(settings.popup.bg_color)) {
    return 'popup.bg_color must be a valid hex color';
  }

  if (typeof settings.popup.text_color !== 'string' || !isValidColor(settings.popup.text_color)) {
    return 'popup.text_color must be a valid hex color';
  }

  if (typeof settings.popup.border_radius !== 'number' || settings.popup.border_radius < 0 || settings.popup.border_radius > 50) {
    return 'popup.border_radius must be a number between 0 and 50';
  }

  // Check add_to_cart_button settings
  if (settings.add_to_cart_button) {
    if (typeof settings.add_to_cart_button.text !== 'string' || settings.add_to_cart_button.text.length === 0) {
      return 'add_to_cart_button.text must be a non-empty string';
    }

    if (typeof settings.add_to_cart_button.bg_color !== 'string' || !isValidColor(settings.add_to_cart_button.bg_color)) {
      return 'add_to_cart_button.bg_color must be a valid hex color';
    }

    if (typeof settings.add_to_cart_button.text_color !== 'string' || !isValidColor(settings.add_to_cart_button.text_color)) {
      return 'add_to_cart_button.text_color must be a valid hex color';
    }

    if (typeof settings.add_to_cart_button.border_radius !== 'number' || settings.add_to_cart_button.border_radius < 0 || settings.add_to_cart_button.border_radius > 50) {
      return 'add_to_cart_button.border_radius must be a number between 0 and 50';
    }

    if (!['small', 'medium', 'large'].includes(settings.add_to_cart_button.size)) {
      return 'add_to_cart_button.size must be small, medium, or large';
    }
  }

  return null; // No errors
}

/**
 * Validate hex color format
 */
function isValidColor(color) {
  return /^#[0-9A-F]{6}$/i.test(color);
}

module.exports = router;
