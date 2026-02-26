/**
 * ============================================
 * MERCHANT ONBOARDING ROUTE
 * ============================================
 * 
 * This endpoint is called when a merchant installs the app.
 * It creates their account automatically with:
 * - Shop information in DynamoDB
 * - Temporary password for external website login
 * - Free tier plan (15 images/month)
 * - Welcome email with credentials
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const ShopModel = require('../models/dynamodb-shop');
const { sendWelcomeEmail } = require('../config/email');

/**
 * Generate a random temporary password
 * Format: ABC123XYZ (easy to type, secure enough for temporary use)
 */
function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (I, O, 0, 1)
  let password = '';
  
  // Generate 9 character password
  for (let i = 0; i < 9; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return password;
}

/**
 * Hash password using crypto (simple hash for now)
 * In production, use bcrypt for better security
 */
function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');
}

/**
 * POST /api/merchant/onboard
 * 
 * Create merchant account when app is installed
 */
router.post('/', async (req, res) => {
  try {
    const { shop_domain, shop_email, shop_name } = req.body;

    console.log('🎉 New merchant onboarding started!');
    console.log('   Shop domain:', shop_domain);
    console.log('   Shop email (from request):', shop_email);
    console.log('   Shop name:', shop_name);

    // Validation
    if (!shop_domain) {
      return res.status(400).json({ 
        error: 'shop_domain is required' 
      });
    }

    // Check if shop already exists
    const existingShop = await ShopModel.findOne(shop_domain);
    
    if (existingShop) {
      console.log('⚠️  Shop already exists, returning existing credentials');
      
      // Return existing credentials (if they haven't changed password yet)
      return res.json({
        success: true,
        message: 'Shop already exists',
        merchant: {
          shop_domain: existingShop.shop_domain,
          shop_email: existingShop.shop_email,
          plan_type: existingShop.plan_type,
          images_limit: existingShop.images_limit,
        },
        credentials: {
          email: existingShop.shop_email,
          temporary_password: existingShop.temporary_password || 'Already changed',
        },
        email_sent: false, // Don't send email again
      });
    }

    // Generate temporary password
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = hashPassword(temporaryPassword);

    console.log('🔐 Generated temporary password:', temporaryPassword);

    // Create shop with authentication fields
    const newShop = {
      shop_domain,
      shop_id: shop_domain.split('.')[0],
      shop_name: shop_name || shop_domain,
      shop_email: shop_email || `${shop_domain.split('.')[0]}@shopify.com`,
      
      // Plan & Usage
      plan_type: 'free',
      images_used: 0,
      images_limit: 15,
      is_active: true,
      
      // App Status
      app_status: 'disabled', // Will be 'active' after theme extension added
      
      // Authentication
      password_hash: passwordHash,
      temporary_password: temporaryPassword, // Store for reference
      password_changed: false, // Force password change on first login
      
      // Integration
      integration_status: 'inactive', // Will be active after theme setup
      theme_extension_enabled: false,
      
      // Settings (default values)
      shop_settings: {
        button: {
          text: 'Try the Look',
          color: '#000000',
          bg_color: '#FFFFFF',
          border_radius: 8,
          size: 'medium',
        },
        popup: {
          title: 'See Yourself in This Look',
          upload_text: 'Upload Your Photo',
          generate_text: 'Generate Preview',
          bg_color: '#FFFFFF',
          border_radius: 12,
        },
        advanced: {
          show_ai_advice: true,
          image_quality: 'standard',
          auto_close: false,
        },
      },
      
      // Payment (null for free tier)
      external_user_id: null,
      razorpay_customer_id: null,
      razorpay_subscription_id: null,
      subscription_status: 'free',
      
      // Timestamps
      last_reset_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Save to DynamoDB
    console.log('💾 Saving shop to DynamoDB...');
    await ShopModel.create(newShop);

    console.log('✅ Shop created successfully!');

    // Send welcome email
    console.log('📧 Sending welcome email...');
    const emailSent = await sendWelcomeEmail(
      newShop.shop_email,
      newShop.shop_name,
      temporaryPassword
    );

    if (emailSent) {
      console.log('✅ Welcome email sent successfully!');
    } else {
      console.warn('⚠️  Welcome email failed to send (non-critical)');
    }

    // Return success response
    res.json({
      success: true,
      message: 'Merchant account created successfully',
      merchant: {
        shop_domain: newShop.shop_domain,
        shop_email: newShop.shop_email,
        shop_name: newShop.shop_name,
        plan_type: newShop.plan_type,
        images_limit: newShop.images_limit,
      },
      credentials: {
        email: newShop.shop_email,
        temporary_password: temporaryPassword,
      },
      email_sent: emailSent,
    });

  } catch (error) {
    console.error('❌ Error in merchant onboarding:', error);
    res.status(500).json({ 
      error: 'Failed to create merchant account',
      message: error.message 
    });
  }
});

module.exports = router;
