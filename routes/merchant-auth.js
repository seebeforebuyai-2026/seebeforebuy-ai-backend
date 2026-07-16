/**
 * Merchant Dashboard Auth Route
 * POST /api/merchant/login
 * POST /api/merchant/change-password
 *
 * Used by the merchant dashboard (dashboard.seebeforebuy.in)
 * Auth is handled here on the backend where DynamoDB credentials work.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { docClient, TABLES } = require('../config/dynamodb');
const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const JWT_SECRET = process.env.JWT_SECRET || 'seebeforebuy';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.shop = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /api/merchant/login ──────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    console.log(`🔐 Login attempt for: ${email}`);

    // Scan DynamoDB by shop_email
    const result = await docClient.send(new ScanCommand({
      TableName: TABLES.SHOPS,
      FilterExpression: 'shop_email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase().trim() },
    }));

    if (!result.Items || result.Items.length === 0) {
      console.log('   ❌ Email not found');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const shop = result.Items[0];

    // Verify password hash
    const inputHash = hashPassword(password);
    if (inputHash !== shop.password_hash) {
      console.log('   ❌ Wrong password');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Issue JWT (24h)
    const token = jwt.sign(
      { shop_domain: shop.shop_domain, shop_email: shop.shop_email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`   ✅ Login successful: ${shop.shop_domain}`);

    res.json({
      success: true,
      token,
      must_change_password: !shop.password_changed,
      shop: {
        domain: shop.shop_domain,
        name: shop.shop_name || shop.shop_domain,
        email: shop.shop_email,
        plan: shop.plan_type || 'free',
      },
    });

  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ error: 'Login failed', message: err.message });
  }
});

// ── POST /api/merchant/change-password ───────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const newHash = hashPassword(new_password);
    await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain: req.shop.shop_domain },
      UpdateExpression: 'SET password_hash = :hash, password_changed = :changed, updated_at = :now',
      ExpressionAttributeValues: {
        ':hash': newHash,
        ':changed': true,
        ':now': new Date().toISOString(),
      },
    }));

    console.log(`✅ Password changed: ${req.shop.shop_domain}`);
    res.json({ success: true, message: 'Password changed successfully' });

  } catch (err) {
    console.error('❌ Change password error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
