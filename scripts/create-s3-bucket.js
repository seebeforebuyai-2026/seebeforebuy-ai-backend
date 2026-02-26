// ============================================
// Create S3 Bucket Script
// ============================================
// This script creates an S3 bucket for storing generated images
// Run this once: npm run create-bucket

require('dotenv').config();
const { S3Client, CreateBucketCommand, PutBucketCorsCommand, PutPublicAccessBlockCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

const bucketName = process.env.S3_BUCKET_NAME || 'see-before-buy-images';
const region = process.env.S3_REGION || process.env.AWS_REGION;

const s3Client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function createS3Bucket() {
  console.log('==================================================');
  console.log('🪣 CREATING S3 BUCKET FOR IMAGE STORAGE');
  console.log('==================================================\n');

  try {
    // Step 1: Create the bucket
    console.log(`📦 Creating bucket: ${bucketName}`);
    console.log(`🌍 Region: ${region}\n`);

    try {
      await s3Client.send(new CreateBucketCommand({
        Bucket: bucketName,
        // Note: For us-east-1, don't specify LocationConstraint
        ...(region !== 'us-east-1' && {
          CreateBucketConfiguration: {
            LocationConstraint: region,
          },
        }),
      }));
      console.log('✅ Bucket created successfully!\n');
    } catch (error) {
      if (error.name === 'BucketAlreadyOwnedByYou') {
        console.log('ℹ️  Bucket already exists (owned by you)\n');
      } else if (error.name === 'BucketAlreadyExists') {
        console.log('⚠️  Bucket name already taken globally\n');
        console.log('💡 Try a different bucket name in .env file\n');
        return;
      } else {
        throw error;
      }
    }

    // Step 2: Configure CORS (so frontend can access images)
    console.log('🔧 Configuring CORS...');
    await s3Client.send(new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedOrigins: ['*'], // In production, specify your domain
            ExposeHeaders: [],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }));
    console.log('✅ CORS configured\n');

    // Step 3: Configure public access (allow public read)
    console.log('🔧 Configuring public access...');
    await s3Client.send(new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }));
    console.log('✅ Public access configured\n');

    // Step 4: Add bucket policy (allow public read)
    console.log('🔧 Adding bucket policy...');
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucketName}/*`,
        },
      ],
    };

    await s3Client.send(new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(bucketPolicy),
    }));
    console.log('✅ Bucket policy added\n');

    // Success!
    console.log('==================================================');
    console.log('✅ S3 BUCKET SETUP COMPLETE!');
    console.log('==================================================\n');
    console.log('📦 Bucket Name:', bucketName);
    console.log('🌍 Region:', region);
    console.log('🔗 URL Format:', `https://${bucketName}.s3.${region}.amazonaws.com/`);
    console.log('\n💡 Your generated images will be stored here!\n');

  } catch (error) {
    console.error('\n❌ Error creating S3 bucket:', error.message);
    console.error('\n💡 Common issues:');
    console.error('   - Check AWS credentials in .env file');
    console.error('   - Make sure IAM user has S3 permissions');
    console.error('   - Try a different bucket name (must be globally unique)');
    console.error('\n');
  }
}

// Run the script
createS3Bucket();
