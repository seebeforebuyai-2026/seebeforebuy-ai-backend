// ============================================
// AWS S3 Configuration
// ============================================
// This file configures AWS S3 for storing generated images
// S3 (Simple Storage Service) is like a cloud hard drive

const { S3Client } = require('@aws-sdk/client-s3');

// Create S3 client with AWS credentials
const s3Client = new S3Client({
  region: process.env.S3_REGION || process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Export the S3 client and bucket name
module.exports = {
  s3Client,
  bucketName: process.env.S3_BUCKET_NAME || 'see-before-buy-images',
};

console.log('✅ S3 Client configured');
console.log('📦 Bucket:', process.env.S3_BUCKET_NAME || 'see-before-buy-images');
console.log('🌍 Region:', process.env.S3_REGION || process.env.AWS_REGION);
