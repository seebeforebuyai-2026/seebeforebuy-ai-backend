/**
 * GDPR Compliance Webhooks
 * Required by Shopify for app store approval
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

/**
 * Verify Shopify HMAC signature
 * CRITICAL: Must use raw body, not parsed JSON
 */
function verifyShopifyWebhook(req) {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const secret = process.env.SHOPIFY_API_SECRET || '';
  
  if (!hmac) {
    console.log('⚠️  Missing HMAC header');
    return false;
  }
  
  if (!secret) {
    console.log('⚠️  Missing SHOPIFY_API_SECRET environment variable');
    return false;
  }
  
  // Use raw body for HMAC verification (critical!)
  const body = req.rawBody || JSON.stringify(req.body);
  
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
  
  const isValid = hmac === hash;
  
  if (!isValid) {
    console.log('❌ HMAC verification failed');
    console.log('   Expected:', hash);
    console.log('   Received:', hmac);
  } else {
    console.log('✅ HMAC verification passed');
  }
  
  return isValid;
}

/**
 * Customer Data Request (GDPR)
 * Shopify sends this when a customer requests their data
 */
router.post('/customers/data_request', async (req, res) => {
  try {
    // Verify HMAC signature
    if (!verifyShopifyWebhook(req)) {
      console.log('❌ Invalid HMAC signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { shop_id, shop_domain, customer } = req.body;

    console.log('📋 GDPR Data Request received');
    console.log('   Shop:', shop_domain);
    console.log('   Customer ID:', customer?.id);
    console.log('   Customer Email:', customer?.email);

    // TODO: In production, implement data export
    // 1. Query your database for customer data
    // 2. Compile all data into a report
    // 3. Send to customer via email

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error handling data request:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Customer Redact (GDPR)
 * Shopify sends this when a customer requests data deletion
 */
router.post('/customers/redact', async (req, res) => {
  try {
    // Verify HMAC signature
    if (!verifyShopifyWebhook(req)) {
      console.log('❌ Invalid HMAC signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { shop_id, shop_domain, customer } = req.body;

    console.log('🗑️  GDPR Customer Redact received');
    console.log('   Shop:', shop_domain);
    console.log('   Customer ID:', customer?.id);
    console.log('   Customer Email:', customer?.email);

    // TODO: In production, implement data deletion
    // 1. Delete customer data from database
    // 2. Remove stored images
    // 3. Anonymize logs

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error handling customer redact:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Shop Redact (GDPR)
 * Shopify sends this 48 hours after app uninstall
 */
router.post('/shop/redact', async (req, res) => {
  try {
    // Verify HMAC signature
    if (!verifyShopifyWebhook(req)) {
      console.log('❌ Invalid HMAC signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { shop_id, shop_domain } = req.body;

    console.log('🗑️  GDPR Shop Redact received');
    console.log('   Shop:', shop_domain);
    console.log('   Shop ID:', shop_id);

    // TODO: In production, implement shop data deletion
    // 1. Delete shop from database
    // 2. Remove all stored images
    // 3. Delete usage logs
    // 4. Remove orders data

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Error handling shop redact:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
