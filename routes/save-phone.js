/**
 * POST /api/merchant/save-phone
 * Save phone number and WhatsApp number for a shop.
 */
const express = require('express');
const router = express.Router();
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, TABLES } = require('../config/dynamodb');
const ShopModel = require('../models/dynamodb-shop');

router.post('/', async (req, res) => {
  try {
    const { shop_domain, phone_number, whatsapp_number } = req.body;

    console.log('📱 Saving phone numbers for:', shop_domain);

    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }
    if (!phone_number || !whatsapp_number) {
      return res.status(400).json({ error: 'phone_number and whatsapp_number are required' });
    }

    const shop = await ShopModel.findOne(shop_domain);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    await docClient.send(new UpdateCommand({
      TableName: TABLES.SHOPS,
      Key: { shop_domain },
      UpdateExpression: 'SET phone_number = :phone, whatsapp_number = :whatsapp, updated_at = :now',
      ExpressionAttributeValues: {
        ':phone': phone_number.trim(),
        ':whatsapp': whatsapp_number.trim(),
        ':now': new Date().toISOString(),
      },
    }));

    console.log('✅ Phone numbers saved for:', shop_domain);

    res.json({ success: true, message: 'Phone numbers saved successfully' });

  } catch (error) {
    console.error('❌ Error saving phone numbers:', error);
    res.status(500).json({ error: 'Failed to save phone numbers', message: error.message });
  }
});

module.exports = router;
