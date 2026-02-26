// ============================================
// Check Available Gemini Models
// ============================================
// This script lists all available Gemini models for your API key
// Run: node scripts/check-gemini-models.js

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function checkModels() {
  console.log('==================================================');
  console.log('🔍 CHECKING AVAILABLE GEMINI MODELS');
  console.log('==================================================\n');

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log('🔑 API Key:', apiKey ? `✅ Found (${apiKey.substring(0, 10)}...)` : '❌ Missing');
    
    if (!apiKey) {
      console.log('\n❌ No API key found in .env file!');
      console.log('Add: GEMINI_API_KEY=your_key_here');
      return;
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    
    console.log('\n📋 Testing common models:\n');

    const modelsToTest = [
      'gemini-pro',
      'gemini-pro-vision',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-latest',
      'gemini-nano',
      'gemini-nano-vision',
      'gemini-2.0-flash-exp',
      'gemini-exp-1206',
    ];

    let anyWorking = false;

    for (const modelName of modelsToTest) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // Try a simple test
        const result = await model.generateContent('Say hello');
        const response = result.response;
        const text = response.text();
        
        console.log(`✅ ${modelName.padEnd(30)} - WORKS`);
        anyWorking = true;
      } catch (error) {
        if (error.message.includes('404') || error.message.includes('not found')) {
          console.log(`❌ ${modelName.padEnd(30)} - NOT AVAILABLE`);
        } else if (error.message.includes('API_KEY_INVALID') || error.message.includes('invalid')) {
          console.log(`❌ ${modelName.padEnd(30)} - INVALID API KEY`);
          console.log('\n⚠️  YOUR API KEY IS INVALID!\n');
          console.log('Please check:');
          console.log('1. Go to https://ai.google.dev/');
          console.log('2. Get a new API key');
          console.log('3. Update GEMINI_API_KEY in .env file\n');
          return;
        } else if (error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')) {
          console.log(`⚠️  ${modelName.padEnd(30)} - QUOTA EXCEEDED`);
        } else if (error.message.includes('billing') || error.message.includes('PERMISSION_DENIED')) {
          console.log(`⚠️  ${modelName.padEnd(30)} - BILLING/PERMISSION ERROR`);
        } else {
          console.log(`⚠️  ${modelName.padEnd(30)} - ERROR: ${error.message.substring(0, 50)}`);
        }
      }
    }

    if (!anyWorking) {
      console.log('\n==================================================');
      console.log('❌ NO MODELS AVAILABLE');
      console.log('==================================================\n');
      console.log('Possible reasons:');
      console.log('1. ❌ API key is invalid or expired');
      console.log('2. ❌ API key needs to be enabled for Gemini API');
      console.log('3. ❌ Free tier might have restrictions');
      console.log('4. ❌ Region restrictions\n');
      console.log('🔧 How to fix:');
      console.log('1. Go to: https://ai.google.dev/');
      console.log('2. Sign in with your Google account');
      console.log('3. Click "Get API Key"');
      console.log('4. Create a new API key');
      console.log('5. Enable "Generative Language API"');
      console.log('6. Copy the new key to .env file\n');
      console.log('💡 Make sure you:');
      console.log('   - Accept terms of service');
      console.log('   - Enable the API in Google Cloud Console');
      console.log('   - Wait a few minutes for activation\n');
    } else {
      console.log('\n==================================================');
      console.log('💡 RECOMMENDATION:');
      console.log('==================================================');
      console.log('Use the model marked with ✅ in your code.');
      console.log('For image analysis, prefer models with "vision" or "1.5"');
      console.log('\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n💡 Check:');
    console.error('   - GEMINI_API_KEY in .env file');
    console.error('   - API key is valid at https://ai.google.dev');
    console.error('\n');
  }
}

checkModels();
