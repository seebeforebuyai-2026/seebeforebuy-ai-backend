const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');

// Proxy image download to avoid CORS issues
router.get('/', async (req, res) => {
  const imageUrl = req.query.url;

  if (!imageUrl) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Only allow downloads from our S3 bucket
  if (!imageUrl.includes('see-before-buy-images-sachin.s3')) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  try {
    const client = imageUrl.startsWith('https') ? https : http;

    client.get(imageUrl, (imageRes) => {
      res.setHeader('Content-Type', imageRes.headers['content-type'] || 'image/png');
      res.setHeader('Content-Disposition', 'attachment; filename="see-before-buy-preview.png"');
      res.setHeader('Access-Control-Allow-Origin', '*');
      imageRes.pipe(res);
    }).on('error', (err) => {
      console.error('Download proxy error:', err);
      res.status(500).json({ error: 'Failed to download image' });
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
