<<<<<<< HEAD
# See Before Buy - Backend API

Node.js backend for the See Before Buy Shopify app. Handles image generation with Gemini AI, usage tracking, and multi-client management.

## Features

- 🎨 Image generation with Gemini AI
- 📊 Usage tracking and analytics
- 🏪 Multi-client (multi-store) support
- 💾 MongoDB database
- 🔒 Free tier with 15 images/month limit
- 💳 Paid plan support

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env` and update with your values:
- `MONGODB_URI`: Your MongoDB connection string
- `GEMINI_API_KEY`: Your Google Gemini API key
- `JWT_SECRET`: Random secret for authentication

### 3. Start MongoDB
Make sure MongoDB is running locally or use MongoDB Atlas.

### 4. Run the Server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server will run on `http://localhost:5000`

## API Endpoints

### 1. Generate Image
**POST** `/api/generate-image`

Generate an image using Gemini AI.

**Body (multipart/form-data):**
- `shop_domain` (string): Shopify store domain
- `product_name` (string): Product name
- `product_image_url` (string): Product image URL
- `userImage` (file): User uploaded image

**Response:**
```json
{
  "success": true,
  "generated_image_url": "https://...",
  "usage": {
    "used": 5,
    "limit": 15,
    "plan": "free"
  },
  "generation_time_ms": 2000
}
```

**Error (Limit Reached):**
```json
{
  "error": "limit_reached",
  "message": "You have reached your image generation limit",
  "usage": {
    "used": 15,
    "limit": 15,
    "plan": "free"
  }
}
```

### 2. Track Usage
**POST** `/api/track-usage`

Track events like add to cart.

**Body:**
```json
{
  "shop_domain": "store.myshopify.com",
  "event_type": "add_to_cart",
  "product_id": "123",
  "product_name": "Blue T-Shirt"
}
```

### 3. Get Shop Status
**GET** `/api/shop-status/:shop_domain`

Get shop information and usage statistics.

**Response:**
```json
{
  "shop": {
    "domain": "store.myshopify.com",
    "plan": "free",
    "is_active": true
  },
  "usage": {
    "used": 5,
    "limit": 15,
    "remaining": 10
  },
  "stats": {
    "total_images_generated": 5,
    "total_add_to_cart": 3,
    "total_limit_reached": 0
  }
}
```

### 4. Upgrade Plan
**POST** `/api/shop-status/upgrade-plan`

Upgrade shop plan (called from external website after payment).

**Body:**
```json
{
  "shop_domain": "store.myshopify.com",
  "plan_type": "pro",
  "images_limit": 500,
  "external_user_id": "user_123",
  "stripe_customer_id": "cus_xyz",
  "stripe_subscription_id": "sub_xyz"
}
```

## Database Models

### Shop
- `shop_domain`: Unique store identifier
- `plan_type`: free, basic, pro, unlimited
- `images_used`: Current month usage
- `images_limit`: Monthly limit
- `is_active`: Account status

### UsageLog
- `shop_domain`: Store identifier
- `event_type`: image_generated, add_to_cart, limit_reached
- `product_id`, `product_name`: Product info
- `generated_image_url`: Result URL
- `generation_time_ms`: Performance metric

## TODO

- [ ] Implement actual Gemini API integration
- [ ] Add image upload to cloud storage (S3/Cloudinary)
- [ ] Add authentication for external website
- [ ] Add monthly usage reset cron job
- [ ] Add rate limiting
- [ ] Add request validation middleware
- [ ] Add comprehensive error handling
- [ ] Add unit tests

## Notes

- Free tier: 15 images/month
- Limit resets monthly
- Shops are auto-created on first request
- Usage is tracked per shop domain
=======
# seebeforebuy-ai-backend
>>>>>>> af56220830aec25dc39dcf4d522ceb62987328ba
