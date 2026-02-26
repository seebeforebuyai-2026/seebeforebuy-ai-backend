/**
 * ============================================
 * MAIN SERVER FILE - Entry Point
 * ============================================
 * 
 * This file starts the Express server and sets up:
 * 1. Middleware (functions that run before routes)
 * 2. Routes (API endpoints)
 * 3. Error handling
 * 4. Server listening on a port
 * 
 * Think of this as the "main()" function in other languages
 */

// ============================================
// 1. IMPORT DEPENDENCIES
// ============================================

// Load environment variables from .env file
// This must be first so other files can use process.env
require('dotenv').config();
console.log('✅ Environment variables loaded');

// Import Express framework
const express = require('express');
console.log('✅ Express imported');

// Import CORS (Cross-Origin Resource Sharing)
// Allows requests from different domains (like Shopify stores)
const cors = require('cors');
console.log('✅ CORS imported');

// ============================================
// 2. CREATE EXPRESS APP
// ============================================

// Create an Express application instance
// This is your server object
const app = express();
console.log('✅ Express app created');

// ============================================
// 3. CONFIGURE MIDDLEWARE
// ============================================

// Middleware runs BEFORE your route handlers
// Think of it as a "pre-processing" step

// CORS Middleware - Allow requests from specific origins
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Check exact match or wildcard match
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed === origin) return true;
      if (allowed.includes('*')) {
        const pattern = allowed.replace(/\*/g, '.*');
        return new RegExp(pattern).test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
console.log('✅ CORS configured');
console.log('   Allowed origins:', allowedOrigins.join(', '));

// JSON Parser Middleware - Parse JSON request bodies
// Converts JSON string to JavaScript object
// BUT: Skip parsing for webhook routes (they need raw body)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/webhooks/')) {
    // Store raw body for webhook signature verification
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      req.rawBody = data;
      req.body = JSON.parse(data);
      next();
    });
  } else {
    next();
  }
});
app.use(express.json());
console.log('✅ JSON parser enabled');

// URL Encoded Parser - Parse form data
app.use(express.urlencoded({ extended: true }));
console.log('✅ URL encoded parser enabled');

// ============================================
// 4. INITIALIZE DATABASE
// ============================================

// Import and initialize DynamoDB connection
const { initializeDynamoDB } = require('./config/dynamodb');
initializeDynamoDB();
console.log('✅ DynamoDB initialized');

// ============================================
// 5. IMPORT ROUTES
// ============================================

// Routes define your API endpoints
// Each route file handles a specific feature

const generateImageRoute = require('./routes/generate-image');
console.log('✅ Generate image route loaded');

const trackUsageRoute = require('./routes/track-usage');
console.log('✅ Track usage route loaded');

const shopStatusRoute = require('./routes/shop-status');
console.log('✅ Shop status route loaded');

const merchantOnboardingRoute = require('./routes/merchant-onboarding');
console.log('✅ Merchant onboarding route loaded');

const saveCategoriesRoute = require('./routes/save-categories');
console.log('✅ Save categories route loaded');

const updateAppStatusRoute = require('./routes/update-app-status');
console.log('✅ Update app status route loaded');

const syncOrdersRoute = require('./routes/sync-orders');
console.log('✅ Sync orders route loaded');

const settingsRoute = require('./routes/settings');
console.log('✅ Settings route loaded');

// ============================================
// 6. REGISTER ROUTES
// ============================================

// Mount routes on specific paths
// Format: app.use('/path', routeHandler)

app.use('/api/generate-image', generateImageRoute);
console.log('✅ Route registered: POST /api/generate-image');

app.use('/api/track-usage', trackUsageRoute);
console.log('✅ Route registered: POST /api/track-usage');

app.use('/api/shop-status', shopStatusRoute);
console.log('✅ Route registered: GET /api/shop-status/:shop_domain');
console.log('✅ Route registered: POST /api/shop-status/upgrade-plan');

app.use('/api/merchant/onboard', merchantOnboardingRoute);
console.log('✅ Route registered: POST /api/merchant/onboard');

app.use('/api/merchant/save-categories', saveCategoriesRoute);
console.log('✅ Route registered: POST /api/merchant/save-categories');

app.use('/api/merchant/update-app-status', updateAppStatusRoute);
console.log('✅ Route registered: POST /api/merchant/update-app-status');

app.use('/api/sync-orders', syncOrdersRoute);
console.log('✅ Route registered: POST /api/sync-orders');

app.use('/api/settings', settingsRoute);
console.log('✅ Route registered: GET /api/settings/:shop_domain');
console.log('✅ Route registered: POST /api/settings/:shop_domain');

// ============================================
// 7. HEALTH CHECK ENDPOINT
// ============================================

// Simple endpoint to check if server is running
// Useful for monitoring and debugging
app.get('/health', (req, res) => {
  console.log('📍 Health check requested');
  
  res.json({ 
    status: 'ok', 
    message: 'See Before Buy Backend is running',
    database: 'DynamoDB',
    timestamp: new Date().toISOString(),
    uptime: process.uptime() // How long server has been running
  });
});
console.log('✅ Route registered: GET /health');

// ============================================
// 8. ERROR HANDLING MIDDLEWARE
// ============================================

// This catches any errors that happen in routes
// Must be defined AFTER all routes
app.use((err, req, res, next) => {
  // Log the error for debugging
  console.error('❌ ERROR CAUGHT:');
  console.error('   Message:', err.message);
  console.error('   Stack:', err.stack);
  
  // Send error response to client
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    // Only show stack trace in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
console.log('✅ Error handling middleware configured');

// ============================================
// 9. START SERVER
// ============================================

// Get port from environment or use 5000
const PORT = process.env.PORT || 5000;

// Start listening for requests
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 SERVER STARTED SUCCESSFULLY!');
  console.log('='.repeat(50));
  console.log(`📍 Server running on: http://localhost:${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`💾 Database: AWS DynamoDB`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(50) + '\n');
  console.log('📝 Available endpoints:');
  console.log('   POST   /api/generate-image');
  console.log('   POST   /api/track-usage');
  console.log('   GET    /api/shop-status/:shop_domain');
  console.log('   POST   /api/shop-status/upgrade-plan');
  console.log('   POST   /api/merchant/onboard');
  console.log('   POST   /api/merchant/save-categories');
  console.log('   POST   /api/merchant/update-app-status');
  console.log('   POST   /api/sync-orders');
  console.log('   GET    /health');
  console.log('\n' + '='.repeat(50));
  console.log('✅ Ready to accept requests!');
  console.log('='.repeat(50) + '\n');
});

/**
 * ============================================
 * HOW THIS FILE WORKS:
 * ============================================
 * 
 * 1. Load environment variables (.env file)
 * 2. Import required packages (express, cors, etc.)
 * 3. Create Express app
 * 4. Add middleware (JSON parser, CORS, etc.)
 * 5. Connect to database (DynamoDB)
 * 6. Register routes (API endpoints)
 * 7. Add error handling
 * 8. Start server on specified port
 * 
 * ============================================
 * LEARNING TIPS:
 * ============================================
 * 
 * - Middleware runs in ORDER (top to bottom)
 * - Routes are matched in ORDER (first match wins)
 * - Error handler must be LAST
 * - app.use() = applies to ALL routes
 * - app.get/post() = applies to specific route
 * 
 * ============================================
 * DEBUGGING:
 * ============================================
 * 
 * If server doesn't start:
 * 1. Check if .env file exists
 * 2. Check if port is already in use
 * 3. Check console for error messages
 * 4. Make sure all dependencies are installed (npm install)
 */
