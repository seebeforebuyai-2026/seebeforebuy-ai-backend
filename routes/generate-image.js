// Generate image route - handles Gemini API calls
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, bucketName } = require('../config/s3');
const ShopModel = require('../models/dynamodb-shop');
const UsageLogModel = require('../models/dynamodb-usage-log');
const { v4: uuidv4 } = require('uuid');

// Configure multer for image upload (memory storage)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/', upload.single('userImage'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { shop_domain, product_name, product_image_url, session_id } = req.body;
    const userImage = req.file;

    // Validation
    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }

    if (!userImage) {
      return res.status(400).json({ error: 'User image is required' });
    }

    console.log(`🎨 Generating image for ${shop_domain}...`);
    console.log(`   Product: ${product_name}`);
    console.log(`   Session ID: ${session_id || 'not provided'}`);
    console.log(`   User image size: ${userImage.size} bytes`);

    // Get shop data first
    const shop = await ShopModel.findOrCreate(shop_domain);

    // Check usage limit
    if (shop.images_used >= shop.images_limit) {
      console.log(`⚠️  Usage limit reached: ${shop.images_used}/${shop.images_limit}`);
      return res.status(429).json({
        error: 'limit_reached',
        message: 'You have reached your image generation limit for this month',
        usage: {
          used: shop.images_used,
          limit: shop.images_limit,
          plan: shop.plan_type
        }
      });
    }

    // Call Gemini API with both user image and product image
    // Pass product category for category-specific prompts
    const productCategory = shop.product_category || 'apparel'; // Default to apparel
    console.log(`🏷️  Product category: ${productCategory}`);
    
    const aiResult = await generateImageWithGemini(
      userImage,
      product_name,
      product_image_url,
      productCategory
    );

    // Extract image URL and AI description
    const generatedImageUrl = aiResult.imageUrl;
    const aiDescription = aiResult.aiDescription;

    // Increment usage
    await ShopModel.incrementUsage(shop_domain);

    // Log the event
    const generationTime = Date.now() - startTime;
    await UsageLogModel.create({
      shop_domain,
      shop_id: shop.shop_id,
      event_type: 'image_generated',
      session_id: session_id || null,  // Add session ID for unique user tracking
      product_name,
      product_image_url,
      generated_image_url: generatedImageUrl,
      generation_time_ms: generationTime,
    });

    console.log(`✅ Image generated successfully (${generationTime}ms)`);
    console.log(`   Usage: ${shop.images_used + 1}/${shop.images_limit}`);
    console.log(`   Session ID stored: ${session_id || 'none'}`);

    // Return success response with AI description
    res.json({
      success: true,
      generated_image_url: generatedImageUrl,
      ai_description: aiDescription,
      usage: {
        used: shop.images_used + 1,
        limit: shop.images_limit,
        plan: shop.plan_type
      },
      generation_time_ms: generationTime
    });

  } catch (error) {
    console.error('❌ Error generating image:', error);
    res.status(500).json({ 
      error: 'Failed to generate image',
      message: error.message 
    });
  }
});

// Category-specific prompts for different product types
const CATEGORY_PROMPTS = {
  apparel: (productName) => `You are a professional virtual try-on AI. I am providing you with TWO images:

IMAGE 1: A photo of a PERSON (the customer)
IMAGE 2: A photo of a CLOTHING PRODUCT (${productName})

YOUR TASK:
Generate a realistic photo showing the SAME PERSON from Image 1 wearing the CLOTHING from Image 2.

CRITICAL REQUIREMENTS:
1. PRESERVE the person's face, facial features, and identity from Image 1
2. PRESERVE the person's body shape, skin tone, and hair from Image 1
3. PRESERVE the person's pose and stance from Image 1
4. REPLACE only the clothing with the product from Image 2
5. Keep the same background and lighting from Image 1
6. Make the clothing fit naturally on the person's body
7. Ensure realistic shadows, wrinkles, and fabric draping
8. The final image should look like a professional product photo of THIS SPECIFIC PERSON wearing THIS SPECIFIC PRODUCT

DO NOT:
- Change the person's face or identity
- Create a different person
- Just show the product alone
- Change the background significantly

Generate the image now showing the person from Image 1 wearing the clothing from Image 2.`,

  jewellery: (productName) => `You are a professional virtual try-on AI for JEWELRY. I am providing you with TWO images:

IMAGE 1: A photo of a PERSON (the customer)
IMAGE 2: A photo of a JEWELRY PRODUCT (${productName})

YOUR TASK:
Generate a realistic photo showing the SAME PERSON from Image 1 wearing the JEWELRY from Image 2.

CRITICAL REQUIREMENTS:
1. PRESERVE the person's face, facial features, and identity from Image 1
2. PRESERVE the person's body shape, skin tone, and hair from Image 1
3. PRESERVE the person's pose and stance from Image 1
4. PLACE the jewelry naturally on the person:
   - Necklace: On the neck/chest area
   - Earrings: On the ears
   - Ring: On the finger
   - Bracelet: On the wrist
   - Pendant: Hanging from neck
5. Keep the same background and lighting from Image 1
6. Make the jewelry clearly VISIBLE and prominent
7. Ensure realistic reflections and shine on the jewelry
8. The jewelry should look natural and properly sized for the person


DO NOT:
- Change the person's face or identity
- Make the jewelry too small or invisible
- Create a different person
- Just show the jewelry alone
- Change the background significantly

Generate the image now showing the person from Image 1 wearing the jewelry from Image 2.`,

  footwear: (productName) => `You are a professional virtual try-on AI for FOOTWEAR. I am providing you with TWO images:

IMAGE 1: A photo of a PERSON (the customer)
IMAGE 2: A photo of SHOES/FOOTWEAR (${productName})

YOUR TASK:
Generate a realistic photo showing the SAME PERSON from Image 1 wearing the FOOTWEAR from Image 2.

CRITICAL REQUIREMENTS:
1. PRESERVE the person's face, facial features, and identity from Image 1
2. PRESERVE the person's body shape, skin tone, and hair from Image 1
3. PRESERVE the person's pose and stance from Image 1
4. REPLACE only the footwear/shoes with the product from Image 2
5. Show FULL BODY or at least from waist down so the shoes are clearly visible
6. Make the shoes fit naturally on the person's feet
7. Ensure realistic shadows and proper foot positioning
8. Keep the same background and lighting from Image 1
9. The shoes should look properly sized and natural on the person

DO NOT:
- Change the person's face or identity
- Hide the shoes or make them too small
- Create a different person
- Just show the shoes alone
- Crop out the feet
- Change the background significantly

Generate the image now showing the person from Image 1 wearing the footwear from Image 2.`,

  accessories: (productName) => `You are a professional virtual try-on AI for ACCESSORIES. I am providing you with TWO images:

IMAGE 1: A photo of a PERSON (the customer)
IMAGE 2: A photo of an ACCESSORY PRODUCT (${productName})

YOUR TASK:
Generate a realistic photo showing the SAME PERSON from Image 1 using/wearing the ACCESSORY from Image 2.

CRITICAL REQUIREMENTS:
1. PRESERVE the person's face, facial features, and identity from Image 1
2. PRESERVE the person's body shape, skin tone, and hair from Image 1
3. PRESERVE the person's pose and stance from Image 1
4. PLACE the accessory naturally on the person:
   - Bag/Purse: In hand or on shoulder
   - Watch: On wrist
   - Sunglasses: On face or held in hand
   - Hat/Cap: On head
   - Scarf: Around neck
   - Belt: Around waist
5. Keep the same background and lighting from Image 1
6. Make the accessory clearly VISIBLE and prominent
7. Ensure realistic positioning and natural interaction with the accessory
8. The accessory should look properly sized for the person

DO NOT:
- Change the person's face or identity
- Make the accessory too small or invisible
- Create a different person
- Just show the accessory alone
- Change the background significantly

Generate the image now showing the person from Image 1 using/wearing the accessory from Image 2.`
};

// Function to generate image with Gemini 2.5 Flash Image (Virtual Try-On)
async function generateImageWithGemini(userImage, productName, productImageUrl, productCategory = 'apparel') {
  try {
    console.log('🎨 Starting AI virtual try-on generation...');
    console.log('   Product:', productName);
    console.log('   Category:', productCategory);
    console.log('   User image size:', userImage.size, 'bytes');
    console.log('   Product image URL:', productImageUrl);
    
    const userImageBase64 = userImage.buffer.toString('base64');
    const userImageMimeType = userImage.mimetype;
    
    // Step 1: Download product image if URL is provided
    let productImageBase64 = null;
    let productImageMimeType = 'image/jpeg';
    
    if (productImageUrl) {
      console.log('📥 Step 1: Downloading product image...');
      console.log('   URL:', productImageUrl);
      try {
        const productResponse = await fetch(productImageUrl);
        
        if (!productResponse.ok) {
          throw new Error(`HTTP ${productResponse.status}: ${productResponse.statusText}`);
        }
        
        const productBuffer = Buffer.from(await productResponse.arrayBuffer());
        productImageBase64 = productBuffer.toString('base64');
        
        // Detect mime type from URL or response
        const contentType = productResponse.headers.get('content-type');
        if (contentType) {
          productImageMimeType = contentType;
        }
        
        console.log('✅ Product image downloaded');
        console.log('   Size:', productBuffer.length, 'bytes');
        console.log('   Type:', productImageMimeType);
      } catch (error) {
        console.error('❌ Could not download product image:', error.message);
        console.log('   Continuing WITHOUT product image...');
        console.log('   ⚠️  This will result in poor quality output!');
      }
    } else {
      console.warn('⚠️  No product image URL provided!');
      console.log('   Product name only:', productName);
    }
    
    // Step 2: Generate virtual try-on image with Gemini 2.5 Flash Image
    console.log('🎨 Step 2: Generating virtual try-on with Gemini 2.5 Flash Image...');
    const imageModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });
    
    // Get category-specific prompt
    const promptFunction = CATEGORY_PROMPTS[productCategory] || CATEGORY_PROMPTS.apparel;
    const virtualTryOnPrompt = promptFunction(productName);
    
    console.log(`📝 Using ${productCategory} prompt`);
    console.log(`   Prompt length: ${virtualTryOnPrompt.length} characters`);

    // Build content array for Gemini
    const contentParts = [
      { text: virtualTryOnPrompt },
      {
        inlineData: {
          mimeType: userImageMimeType,
          data: userImageBase64,
        },
      },
    ];
    
    // Add product image if available
    if (productImageBase64) {
      contentParts.push({
        inlineData: {
          mimeType: productImageMimeType,
          data: productImageBase64,
        },
      });
      console.log('✅ Product image added to request');
    } else {
      console.warn('⚠️  WARNING: No product image in request!');
      console.log('   This will likely produce poor results.');
      console.log('   Make sure product_image_url is being sent from frontend.');
    }
    
    console.log('📊 Total images in request:', contentParts.filter(p => p.inlineData).length);
    console.log('⏳ Generating image (this may take 10-30 seconds)...');
    const imageResult = await imageModel.generateContent(contentParts);
    const imageResponse = imageResult.response;
    
    console.log('📥 Response received from Gemini');
    
    // Step 3: Extract generated image
    console.log('🔍 Step 3: Extracting generated image...');
    let generatedImageBuffer = null;
    
    if (imageResponse.candidates && imageResponse.candidates[0]) {
      const candidate = imageResponse.candidates[0];
      
      console.log('   Candidate found, checking for image data...');
      
      if (candidate.content && candidate.content.parts) {
        console.log('   Parts found:', candidate.content.parts.length);
        
        for (let i = 0; i < candidate.content.parts.length; i++) {
          const part = candidate.content.parts[i];
          
          if (part.inlineData && part.inlineData.data) {
            // Found generated image!
            console.log(`✅ Generated image found in part ${i}`);
            console.log('   Mime type:', part.inlineData.mimeType);
            generatedImageBuffer = Buffer.from(part.inlineData.data, 'base64');
            console.log('   Image size:', generatedImageBuffer.length, 'bytes');
            break;
          } else if (part.text) {
            console.log(`   Part ${i} contains text:`, part.text.substring(0, 100));
          }
        }
      }
    }
    
    if (!generatedImageBuffer) {
      console.error('❌ No image generated in response');
      console.log('   Response structure:', JSON.stringify(imageResponse, null, 2).substring(0, 500));
      throw new Error('No image generated in response');
    }
    
    // Create file object for S3 upload
    const generatedImageFile = {
      buffer: generatedImageBuffer,
      originalname: `gemini-tryon-${productName}.png`,
      mimetype: 'image/png',
    };
    
    // Step 4: Generate styling advice with Gemini
    console.log('💬 Step 4: Generating styling advice...');
    const adviceModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const advicePrompt = `Based on this person and the product "${productName}", give personalized styling advice in 2-3 sentences. Be encouraging and specific.`;
    
    const adviceResult = await adviceModel.generateContent([
      advicePrompt,
      {
        inlineData: {
          data: userImageBase64,
          mimeType: userImageMimeType,
        },
      },
    ]);
    
    const aiDescription = adviceResult.response.text();
    console.log('✅ Styling advice generated');
    
    // Step 5: Upload to S3
    console.log('📤 Step 5: Uploading to S3...');
    const s3Url = await uploadImageToS3(generatedImageFile, aiDescription, productName);
    
    console.log('✅ Complete! Virtual try-on image uploaded to S3');
    
    return {
      imageUrl: s3Url,
      aiDescription,
    };
    
  } catch (error) {
    console.error('❌ AI generation error:', error.message);
    console.error('   Full error:', error);
    
    // Fallback: Upload original image
    console.log('⚠️  Falling back to original image');
    const fallbackDescription = `Thank you for trying "${productName}"! This product would look great on you!`;
    
    try {
      const imageUrl = await uploadImageToS3(userImage, fallbackDescription, productName);
      return {
        imageUrl,
        aiDescription: fallbackDescription,
      };
    } catch (uploadError) {
      throw new Error('Failed to process image: ' + uploadError.message);
    }
  }
}

// Function to upload image to S3
async function uploadImageToS3(imageFile, aiDescription, productName) {
  try {
    console.log('📤 Uploading image to S3...');
    
    // Generate unique filename
    const fileExtension = imageFile.originalname.split('.').pop();
    const fileName = `generated/${uuidv4()}.${fileExtension}`;
    
    // Clean AI description for S3 metadata (remove newlines, special chars)
    const cleanDescription = aiDescription
      .replace(/[\r\n]+/g, ' ')  // Replace newlines with space
      .replace(/[^\x20-\x7E]/g, '') // Remove non-ASCII characters
      .substring(0, 2000); // S3 metadata limit
    
    const cleanProductName = (productName || 'Unknown')
      .replace(/[\r\n]+/g, ' ')
      .replace(/[^\x20-\x7E]/g, '')
      .substring(0, 200);
    
    // Prepare S3 upload parameters
    const uploadParams = {
      Bucket: bucketName,
      Key: fileName,
      Body: imageFile.buffer,
      ContentType: imageFile.mimetype,
      Metadata: {
        'ai-description': cleanDescription,
        'product-name': cleanProductName,
        'original-name': imageFile.originalname,
        'upload-date': new Date().toISOString(),
      },
    };
    
    // Upload to S3
    await s3Client.send(new PutObjectCommand(uploadParams));
    
    // Generate public URL
    const region = process.env.S3_REGION || process.env.AWS_REGION;
    const imageUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${fileName}`;
    
    console.log('✅ Image uploaded successfully');
    console.log('🔗 URL:', imageUrl);
    
    return imageUrl;
    
  } catch (error) {
    console.error('❌ S3 upload error:', error);
    throw new Error('Failed to upload image to S3: ' + error.message);
  }
}

module.exports = router;
