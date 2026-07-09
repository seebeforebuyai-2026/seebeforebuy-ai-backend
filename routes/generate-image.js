// Generate image route - handles Gemini API calls
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client, bucketName } = require("../config/s3");
const ShopModel = require("../models/dynamodb-shop");
const UsageLogModel = require("../models/dynamodb-usage-log");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");

// Configure multer for image upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post("/", upload.single("userImage"), async (req, res) => {
  const startTime = Date.now();

  try {
    const { shop_domain, product_name, product_image_url, session_id } =
      req.body;
    const userImage = req.file;

    // Validation
    if (!shop_domain) {
      return res.status(400).json({ error: "shop_domain is required" });
    }

    if (!userImage) {
      return res.status(400).json({ error: "User image is required" });
    }

    console.log(`🎨 Generating image for ${shop_domain}...`);
    console.log(`   Product: ${product_name}`);
    console.log(`   Session ID: ${session_id || "not provided"}`);
    console.log(`   User image size: ${userImage.size} bytes`);

    // Get shop data first
    const shop = await ShopModel.findOrCreate(shop_domain);

    // Check usage limit
    if (shop.images_used >= shop.images_limit) {
      console.log(
        `⚠️  Usage limit reached: ${shop.images_used}/${shop.images_limit}`,
      );
      return res.status(429).json({
        error: "limit_reached",
        message: "You have reached your image generation limit for this month",
        usage: {
          used: shop.images_used,
          limit: shop.images_limit,
          plan: shop.plan_type,
        },
      });
    }

    // Call Gemini API with both user image and product image
    // Prefer per-request category from frontend, fall back to shop-level setting
    const productCategory =
      req.body.product_category || shop.product_category || "apparel";
    console.log(`🏷️  Product category: ${productCategory}`);

    const aiResult = await generateImageWithGemini(
      userImage,
      product_name,
      product_image_url,
      productCategory,
    );

    // Extract image URL
    const generatedImageUrl = aiResult.imageUrl;

    // Increment usage
    await ShopModel.incrementUsage(shop_domain);

    const generationTime = Date.now() - startTime;

    setImmediate(async () => {
      try {
        const adviceModel = genAI.getGenerativeModel({
          model: "gemini-3-pro-image",
        });
        const advicePrompt = `Based on the product "${product_name}", give personalized styling advice in 2-3 sentences. Be encouraging and specific.`;
        const adviceResult = await adviceModel.generateContent([advicePrompt]);
        const aiDescription = adviceResult.response.text();

        await UsageLogModel.create({
          shop_domain,
          shop_id: shop.shop_id,
          event_type: "image_generated",
          session_id: session_id || null,
          product_name,
          product_image_url,
          generated_image_url: generatedImageUrl,
          generation_time_ms: generationTime,
          ai_description: aiDescription,
        });
        console.log(`✅ Background: usage logged + styling advice saved`);
      } catch (bgErr) {
        console.error("⚠️  Background task error (non-fatal):", bgErr.message);
      }
    });

    console.log(
      `✅ Image ready — responding immediately (${generationTime}ms)`,
    );
    console.log(`   Usage: ${shop.images_used + 1}/${shop.images_limit}`);

    res.json({
      success: true,
      generated_image_url: generatedImageUrl,
      usage: {
        used: shop.images_used + 1,
        limit: shop.images_limit,
        plan: shop.plan_type,
      },
      generation_time_ms: generationTime,
    });
  } catch (error) {
    console.error("❌ Error generating image:", error);
    res.status(500).json({
      error: "Failed to generate image",
      message: error.message,
    });
  }
});

// Category-specific prompts for different product types
const CATEGORY_PROMPTS = {
  apparel: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the garment shown in the product reference image.
 
INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the garment's color, cut, pattern, fabric and details. Any mannequin, hanger, model, packaging or background from this reference is ignored and never appears in the output.
 
THE OUTPUT IS ONE SINGLE PHOTOGRAPH containing exactly one person — the customer — in their original setting. It is a normal photo of one human being. There is no second panel, no split-screen, no grid, no before/after, no duplicate of the person, and no separate picture of the garment anywhere in the frame.
 
KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and facial features, the same skin tone, the same hairstyle, the same body shape and proportions, the same exact pose and stance, the same hands and arms, and the same background and lighting. The person has one head, two arms, and two hands with five fingers each — a single, anatomically correct human body with no duplicated or extra limbs, hands or fingers.
 
CHANGE ONLY THE CLOTHING: dress the customer in the ${productName}, matching its exact color, design, print, seams and details from the reference. The fabric drapes, folds and fits naturally over the customer's real body and current pose, with realistic wrinkles, texture and soft contact shadows. Blend the garment's lighting into the existing scene so it looks genuinely photographed on the person, not pasted on.
 
STYLE: high-end fashion editorial quality — sharp, clean, flattering studio-or-natural light, premium and fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,

  kurti: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the Kurti/Kurta shown in the product reference image.

INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the Kurti's color, cut, neckline, sleeve style, print and fabric. Any mannequin, hanger, model, packaging or background from this reference is ignored and never appears in the output.

THE OUTPUT IS ONE SINGLE PHOTOGRAPH of the customer in their original setting — one human being, photographed normally. There is no collage, split-screen, grid, before/after, duplicate person, or separate garment picture anywhere in the frame.

KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and facial features, the same skin tone, the same hairstyle, the same body shape and proportions, the same exact pose and stance, the same hands, arms, and lower body clothing (unless the product is a full set), and the same background and lighting. The person has one head, two arms, and two hands with five fingers each.

CHANGE ONLY THE UPPER GARMENT: dress the customer in the ${productName} Kurti/Kurta. Match the neckline precisely around the collar bones. Render the sleeve style (3/4, full, or half) accurately on the customer's arms. Reproduce the traditional prints, block prints, embroidery or solid colors with clean detail. The fabric (cotton, rayon, or silk) drapes with elegant straight folds matching the customer's posture, with realistic wrinkles and soft shadows.

STYLE: ethnic fashion editorial quality — clean, flattering natural or studio light, premium and fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,

  saree: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the Saree shown in the product reference image.

INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the Saree's color, border design, fabric, weave pattern and blouse style. Any mannequin, model or background from this reference is ignored and never appears in the output.

THE OUTPUT IS ONE SINGLE PHOTOGRAPH of the customer in their original setting — one human being, photographed normally. There is no collage, split-screen, grid, before/after, duplicate person, or separate garment picture anywhere in the frame.

KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and facial features, the same skin tone, the same hairstyle and the same background and lighting. The person has one head, two arms, and two hands with five fingers each.

DRAPE THE SAREE ELEGANTLY: the pallu (decorative end) cascades naturally over the left shoulder, and the waist pleats are neatly aligned at the customer's waistline following their body contours. The blouse design and sleeve cut from the reference fits seamlessly on the customer. Reproduce intricate zari borders, silk/georgette textures and woven motifs with high fidelity. The fabric flows with natural movement and realistic drape.

STYLE: luxury ethnic fashion editorial quality — rich, vibrant and fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,

  t_shirt: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the T-shirt shown in the product reference image.

INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the T-shirt's color, graphic design, fit and neckline. Any mannequin, hanger, model, packaging or background from this reference is ignored and never appears in the output.

THE OUTPUT IS ONE SINGLE PHOTOGRAPH of the customer in their original setting — one human being, photographed normally. There is no collage, split-screen, grid, before/after, duplicate person, or separate garment picture anywhere in the frame.

KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and facial features, the same skin tone, the same hairstyle, the same body shape and proportions, the same exact pose, the same hands, arms and background. The person has one head, two arms, and two hands with five fingers each.

CHANGE ONLY THE SHIRT: dress the customer in the ${productName} T-shirt. Wrap the crew neck or V-neck collar naturally around the base of the neck; align the shoulder seams to the customer's shoulders. Transfer any graphic print, chest branding or pocket details with proportional, flat alignment on the torso. Render natural cotton/jersey fabric folds around the armpits, chest and waistline.

STYLE: casual street-fashion quality — clean, flattering natural or studio light, fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,

  shirt: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the button-up Shirt shown in the product reference image.

INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the shirt's color, pattern, collar style, sleeve length and fabric. Any mannequin, hanger, model, packaging or background from this reference is ignored and never appears in the output.

THE OUTPUT IS ONE SINGLE PHOTOGRAPH of the customer in their original setting — one human being, photographed normally. There is no collage, split-screen, grid, before/after, duplicate person, or separate garment picture anywhere in the frame.

KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and facial features, the same skin tone, the same hairstyle, the same body shape and proportions, the same exact pose, the same hands, arms and background. The person has one head, two arms, and two hands with five fingers each.

CHANGE ONLY THE SHIRT: dress the customer in the ${productName}. Render a structured, crisp collar wrapping around the neck and the button placket aligned cleanly down the center of the torso. Fit the cuffs and sleeve lengths accurately to the customer's arm posture (rolled up or buttoned at the wrist). Render premium fabric folds (linen, Oxford cotton or satin) with structured shoulder seams and realistic contact shadows.

STYLE: smart-casual or formal fashion editorial quality — clean, flattering light, fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,

  suit: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the Blazer/Suit shown in the product reference image.

INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the suit's color, lapel style, button count, fit and fabric. Any mannequin, hanger, model, packaging or background from this reference is ignored and never appears in the output.

THE OUTPUT IS ONE SINGLE PHOTOGRAPH of the customer in their original setting — one human being, photographed normally. There is no collage, split-screen, grid, before/after, duplicate person, or separate garment picture anywhere in the frame.

KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and facial features, the same skin tone, the same hairstyle, the same body shape and proportions, the same exact pose, the same hands, arms and background. The person has one head, two arms, and two hands with five fingers each.

CHANGE ONLY THE JACKET: dress the customer in the ${productName} blazer/suit jacket. Render sharp lapels, structured shoulder padding and neat button enclosures matching the coat's tailored geometry. Keep the shirt and tie/innerwear visible beneath the lapels. Render structured seams and luxury wool or blended fabric with subtle lighting highlights and deep natural shadows.

STYLE: high-end formal fashion quality — sharp, clean, professionally lit, fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,

  streetwear: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the streetwear item shown in the product reference image.

INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the item's color, design, fit, graphics and fabric weight. Any mannequin, hanger, model, packaging or background from this reference is ignored and never appears in the output.

THE OUTPUT IS ONE SINGLE PHOTOGRAPH of the customer in their original setting — one human being, photographed normally. There is no collage, split-screen, grid, before/after, duplicate person, or separate garment picture anywhere in the frame.

KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and facial features, the same skin tone, the same hairstyle, the same body shape and proportions, the same exact pose, the same hands, arms and background. The person has one head, two arms, and two hands with five fingers each.

CHANGE ONLY THE GARMENT: dress the customer in the ${productName}. Render the signature oversized or relaxed silhouette, retaining the heavy fabric weight, ribbed cuffs and hem. If it is a hoodie, drape the hood naturally around the neck and shoulders. Keep any graphic designs, embroidery or text crisp and undistorted on the fabric. Blend the urban streetwear lighting and shadows into the customer's environment.

STYLE: premium streetwear/urban fashion editorial quality — clean, flattering light, fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,

  watch: (
    productName,
  ) => `You are simulating a real photograph of a customer wearing a watch — not compositing two images together. The final result must look like the watch ${productName} was physically on the customer's wrist when the original photo was taken.

You will receive two images: (1) a photo of a real customer's wrist, and (2) a product photo of a watch on a plain background.

BEFORE generating anything, analyze image 1 and determine:
- The exact angle of the wrist relative to the camera (is it angled away, rotated, foreshortened? Most wrist photos are NOT a flat front-on view — the hand/arm creates a 3D twist.)
- The single dominant light source direction (e.g. "harsh light from camera-flash, head-on" or "soft daylight from upper-left"). Look at the shadows already on the hand and skin in image 1 to determine this — the shadow side of the fingers and the highlight side of the knuckles tell you exactly where the light is coming from.
- The color temperature of that light (cool blue-white flash vs warm ambient light vs neutral daylight).

You must use this analysis to control how you render the watch. Do not skip this step.

CORE RULE — THIS IS NOT A STICKER:
A flat, front-facing, evenly-lit photo of the watch dial pasted onto the wrist is a FAILURE. If the wrist in image 1 is angled even slightly, the watch case and dial MUST be rendered at that same angle — foreshortened, with one side of the case closer to camera and larger, the other side smaller and receding. A perfectly circular, perfectly flat dial facing the camera when the wrist itself is turned is the single biggest sign of failure — check for this explicitly before finalizing.

1. WRIST IDENTIFICATION AND PLACEMENT:
   - Locate the wrist in image 1. Position the watch case centered on top of the wrist, between the wrist bone and the base of the hand.
   - Match the watch case's rotation and tilt to the wrist's actual rotation in the photo. If the camera is looking at the wrist from above-and-to-the-side (the common phone-selfie angle), the dial must be rendered as an ellipse, not a circle, with the far edge of the case compressed.
   - Scale the case and strap width to the real wrist thickness shown in image 1, not the product photo's apparent scale.

2. STRAP MUST WRAP — NO EXCEPTIONS:
   - The strap is a 3D band going around a cylinder (the wrist). You must render: the near side of the strap (facing camera, fully visible), the strap curving away at both left and right edges of the wrist, and — critically — a sliver of the strap's underside or far side becoming foreshortened/disappearing behind the wrist.
   - If it is a metal bracelet: render individual links as separate 3D segments that get narrower/more compressed as they wrap toward the side of the wrist, not a flat printed pattern.
   - If it is a leather/fabric strap: render a visible fold or crease where the strap bends to follow the wrist curve, plus a soft shadow the strap casts onto the skin directly beneath it.
   - The strap must visibly press into the skin slightly at the edges — skin should show a very subtle compression line where the strap edge meets it, exactly like a real worn watch.

3. RELIGHT THE WATCH TO MATCH IMAGE 1 — DO NOT REUSE THE PRODUCT PHOTO'S LIGHTING:
   - Throw away the lighting, shadows, and highlights from the product photo (image 2) entirely. Only keep its shape, color, and material identity (what metal, what dial color/design, what strap type).
   - Re-render the watch as if it were lit by the exact light source you identified on the customer's skin in image 1, matching direction, harshness, and color temperature.
   - If image 1 shows hard direct flash (small tight highlights on knuckles, deep short shadows): the watch crystal must show one small, sharp, bright reflection point, not a soft glow. Metal must show tight, high-contrast specular highlights with darker mid-tones, not even brightness across the whole case.
   - If image 1 shows soft ambient light (long soft shadows, gradual transitions on skin): the watch must show broader, dimmer reflections, smoother gradients across the metal, no harsh hotspot.
   - Either way: the brightest point on the watch metal and the brightest point on the customer's adjacent skin must come from the same direction. If the skin is brightest on its upper-left edge, the watch's brightest highlight must also be on its upper-left edge. This consistency check is mandatory.

4. MATERIAL REALISM — AVOID THE "PLASTIC" LOOK:
   - Polished metal is never one flat color. It must show: a dark contact-shadow edge where it meets skin, a mid-tone body color, and one or two small bright specular points — never a uniform flat fill.
   - The watch crystal (glass) must show a faint reflective sheen at an angle consistent with the light direction — think of it as a slightly convex mirror catching one bright streak, not a transparent flat circle showing the dial perfectly clearly with zero glare.
   - Do not increase the saturation or sharpness of the watch beyond what is naturally present elsewhere in image 1. If the customer's skin has slight photographic noise/grain from the original camera, the watch must show matching grain — an unnaturally crisp, noise-free watch next to grainier skin is a dead giveaway of compositing.

5. SHADOW CONTACT:
   - Render a contact shadow directly underneath the watch case where it touches the wrist, with the shadow direction and softness matching the light source from image 1 (hard flash = short sharp shadow directly under the case; soft ambient = wider, softer shadow extending slightly to the side opposite the light).

6. PRESERVE EVERYTHING ELSE:
   - Do not alter the customer's wrist, hand, skin tone, skin texture, pose, or background except where the watch occludes skin or casts a shadow.
   - Preserve the dial's actual numerals, hands, color, and any text exactly as shown in the product photo — only the lighting/shading on top of that design should change, not the design itself.
   - Output resolution and aspect ratio must match image 1.

7. SELF-CHECK BEFORE OUTPUT — verify all of these are true, and if any fail, regenerate:
   - Is the dial an ellipse (foreshortened), not a perfect circle, if the wrist is angled?
   - Does the strap visibly wrap around the side of the wrist, with at least one part receding/foreshortened?
   - Does the brightest highlight on the watch match the brightest highlight direction on the adjacent skin?
   - Does the metal show varied tones (highlight, mid-tone, shadow edge) rather than one flat color?

8. IF THE WRIST IS NOT CLEARLY VISIBLE OR AT AN UNUSABLE ANGLE (closed fist, wrist out of frame), return the original photo unmodified — do not force a placement.

Output only the final photorealistic image. No text, no borders, no watermark.`,

  shoes: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the footwear shown in the product reference image.
 
INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the shoes' color, design, material and details. Any box, stand, model or background from this reference is ignored and never appears in the output.
 
THE OUTPUT IS ONE SINGLE FULL-BODY PHOTOGRAPH of the customer in their original setting — one human being, photographed normally, with both feet visible. There is no collage, split-screen, grid, duplicate person, or separate picture of the shoes anywhere in the frame.
 
KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and features, skin tone, hairstyle, body shape and proportions, the same exact pose and stance, the same leg position, and the same background and lighting. The person has one head, two arms with two hands (five fingers each), and two legs ending in two feet — a single anatomically correct body with no extra limbs.
 
CHANGE ONLY THE FOOTWEAR: put the ${productName} on the customer's feet as a matching left-and-right pair, one shoe per foot, matching the reference's exact color, design and material. Each shoe is sized to its foot for a natural, realistic fit, with believable laces, sole, texture and material. The shoes make proper contact with the ground and cast natural shadows beneath them — never floating.
 
STYLE: premium footwear campaign quality — sharp, clean, flattering light, fully photorealistic, shoes clearly visible and prominent. Preserve the customer photo's original framing and aspect ratio.`,

  jewellery: (
    productName,
  ) => `You are a professional jewellery photo compositor. You will receive two images: (1) a photo of a real customer (showing their hand, neck, or ears), and (2) a product photo of a jewellery item (${productName}). Your task is to generate a single photorealistic image showing the customer wearing the exact product from image 2, composited naturally onto their body from image 1.

STRICT RULES — DO NOT DEVIATE:

1. IDENTIFY THE JEWELLERY TYPE from image 2 first (ring / necklace / earrings) and apply the matching placement rule below. Do not guess — use the product image to confirm category before placing it.

2. RING PLACEMENT:
   - Identify the customer's RING FINGER only (fourth finger, between the middle finger and pinky) on ONE hand, unless the original photo clearly shows both hands posed for rings.
   - The ring must sit at the base of the finger, around a single knuckle (the lowest knuckle, where a ring naturally rests). Never let the band stretch, bridge, or touch two separate fingers.
   - Match the ring's circular band shape to the actual curvature and width of that specific finger. The visible band width must be proportional to the finger's real thickness shown in the original photo — do not enlarge or shrink the ring to a generic size.
   - The ring must not float above the skin or sink below it. The band sits flush against the skin with a small, realistic shadow gap only where skin curves away from the metal (just below the knuckle).

3. NECKLACE PLACEMENT:
   - Drape the necklace naturally along the customer's collarbone and neck curve, following gravity. The chain must follow the contour of the neck and chest, not float in front as a flat 2D overlay.
   - The pendant (if any) must hang centered and pointing straight down due to gravity, resting against the skin or clothing naturally — never sideways or tilted unless the person's body is tilted.
   - Where the chain crosses clothing versus skin, adjust opacity and shadow contact accordingly — chain on skin shows soft contact shadow, chain on fabric shows a slightly more defined edge.

4. EARRING PLACEMENT:
   - Anchor earrings precisely at the earlobe (for studs/drops) or the upper ear cartilage (only if the product image shows a cartilage piece). Do not place earrings mid-air near the ear.
   - Drop earrings must hang straight down following gravity, swinging naturally away from the neck, never clipping into hair or the jawline.
   - Match earring scale to the actual ear size visible in the original photo.

5. MATERIAL AND LIGHTING — CRITICAL FOR REALISM:
   - Extract the lighting direction, color temperature, and intensity from the ORIGINAL CUSTOMER PHOTO (image 1), not from the product photo. The jewellery must be lit as if it exists in the same room/light as the customer.
   - Preserve the product's actual material properties from image 2 (gold tone, silver tone, gemstone color, polish level) but re-render its specular highlights and reflections to match the light source(s) visible on the customer's skin in image 1.
   - Metal must show realistic specular highlights (small, sharp bright points) and soft ambient reflections of nearby skin tone — metal sitting on skin always picks up a faint warm reflection from that skin. Avoid flat, uniform, plastic-looking material with no highlight variation.
   - Gemstones must show internal light refraction (a bright core highlight plus subtle color dispersion at edges), not a flat painted circle.
   - Do not oversaturate or oversharpen the jewellery relative to the rest of the image — it must look like it was photographed in the same shot as the customer, with matching grain, sharpness, and depth of field.

6. SCALE AND PERSPECTIVE:
   - Match the jewellery's perspective and angle to the body part it sits on. A ring on a finger angled toward the camera must be foreshortened correctly, not pasted flat.
   - Do not resize the jewellery item from its true proportions shown in the product photo (image 2) beyond what is needed for correct relative scale to the customer's body part.

7. PRESERVE EVERYTHING ELSE:
   - Do not alter the customer's hand, neck, ears, skin tone, skin texture, pose, or background in any way except where the jewellery physically occludes or casts a shadow on the skin.
   - Do not add, remove, or modify any other jewellery, clothing, or accessories already visible in the original photo.
   - Output resolution and aspect ratio must match the original customer photo (image 1).

8. IF THE ORIGINAL PHOTO DOES NOT CLEARLY SHOW A SUITABLE BODY PART (e.g., no visible hand for a ring, no visible neck for a necklace, no visible ears for earrings), do not attempt placement — instead return the original photo unmodified with no jewellery added.

Output only the final composited photorealistic image. No text, no borders, no watermark.`,

  footwear: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing the footwear shown in the product reference image.
 
INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the shoes' color, design, material and details. Any box, stand, model or background from this reference is ignored and never appears in the output.
 
THE OUTPUT IS ONE SINGLE FULL-BODY PHOTOGRAPH of the customer in their original setting — one human being, photographed normally, with both feet visible. There is no collage, split-screen, grid, duplicate person, or separate picture of the shoes anywhere in the frame.
 
KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and features, skin tone, hairstyle, body shape and proportions, the same exact pose and stance, the same leg position, and the same background and lighting. The person has one head, two arms with two hands (five fingers each), and two legs ending in two feet — a single anatomically correct body with no extra limbs.
 
CHANGE ONLY THE FOOTWEAR: put the ${productName} on the customer's feet as a matching left-and-right pair, one shoe per foot, matching the reference's exact color, design and material. Each shoe is sized to its foot for a natural, realistic fit, with believable laces, sole, texture and material. The shoes make proper contact with the ground and cast natural shadows beneath them — never floating.
 
STYLE: premium footwear campaign quality — sharp, clean, flattering light, fully photorealistic, shoes clearly visible and prominent. Preserve the customer photo's original framing and aspect ratio.`,

  accessories: (
    productName,
  ) => `Generate a single, photorealistic photograph of the person from the customer image, now wearing or holding the accessory shown in the product reference image.
 
INPUT ROLES (read carefully):
- CUSTOMER IMAGE: the real person. This is the ONLY individual who appears in the result.
- PRODUCT REFERENCE IMAGE: a reference of the ${productName}. Use it ONLY to read the accessory's exact shape, color, material and details. Any stand, box, model or background from this reference is ignored and never appears in the output.
 
THE OUTPUT IS ONE SINGLE PHOTOGRAPH of the customer in their original setting — one human being, photographed normally. There is no collage, split-screen, grid, duplicate person, or separate picture of the accessory anywhere in the frame.
 
KEEP IDENTICAL TO THE CUSTOMER IMAGE: the same face and features, skin tone, hairstyle, body shape and proportions, the same exact pose and gesture, and the same background and lighting. The person has one head, two arms, and two hands with five fingers each — a single anatomically correct body with no duplicated limbs.
 
PLACE THE ACCESSORY NATURALLY AND AT CORRECT SCALE, exactly as it would really be worn or held:
- Bag / purse: held in one hand or resting on one shoulder, with realistic weight and leather/material texture.
- Watch: on ONE wrist, sized to the wrist, with a visible dial, correct strap, and realistic reflections.
- Sunglasses / glasses: sit on the face aligned with both eyes and resting on the ears, two lenses, with natural lens reflections.
- Hat / cap: sits on the head with a natural fit and correct fabric texture.
- Scarf: draped around the neck with natural fabric folds and movement.
- Belt: around the waist with a correct fit and a clearly detailed buckle.
 
The accessory looks expensive and real, with fine material detail and lighting that matches the customer's scene. The person looks natural and stylish.
 
STYLE: high-end luxury accessories advertisement quality — editorial, sharp, fully photorealistic. Preserve the customer photo's original framing and aspect ratio.`,
};

async function generateImageWithGemini(
  userImage,
  productName,
  productImageUrl,
  productCategory = "apparel",
) {
  try {
    console.log("🎨 Starting AI virtual try-on generation...");
    console.log("   Product:", productName);
    console.log("   Category:", productCategory);
    console.log("   User image size:", userImage.size, "bytes");
    console.log("   Product image URL:", productImageUrl);

    const userImageBase64 = userImage.buffer.toString("base64");
    const userImageMimeType = userImage.mimetype;

    // Step 1: Download product image if URL is provided
    let productImageBase64 = null;
    let productImageMimeType = "image/jpeg";

    if (productImageUrl) {
      console.log("📥 Step 1: Downloading product image...");
      console.log("   URL:", productImageUrl);
      try {
        const productResponse = await fetch(productImageUrl);

        if (!productResponse.ok) {
          throw new Error(
            `HTTP ${productResponse.status}: ${productResponse.statusText}`,
          );
        }

        const productBuffer = Buffer.from(await productResponse.arrayBuffer());
        productImageBase64 = productBuffer.toString("base64");

        // Detect mime type from URL or response
        const contentType = productResponse.headers.get("content-type");
        if (contentType) {
          productImageMimeType = contentType;
        }

        console.log("✅ Product image downloaded");
        console.log("   Size:", productBuffer.length, "bytes");
        console.log("   Type:", productImageMimeType);
      } catch (error) {
        console.error("❌ Could not download product image:", error.message);
        console.log("   Continuing WITHOUT product image...");
        console.log("   ⚠️  This will result in poor quality output!");
      }
    } else {
      console.warn("⚠️  No product image URL provided!");
      console.log("   Product name only:", productName);
    }

    console.log(
      "🎨 Step 2: Generating virtual try-on with gemini-3-pro-image Image...",
    );
    const imageModel = genAI.getGenerativeModel({
      model: "gemini-3-pro-image",
    });

    // Get category-specific prompt
    const promptFunction =
      CATEGORY_PROMPTS[productCategory] || CATEGORY_PROMPTS.apparel;
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
      console.log("✅ Product image added to request");
    } else {
      console.warn("⚠️  WARNING: No product image in request!");
      console.log("   This will likely produce poor results.");
      console.log(
        "   Make sure product_image_url is being sent from frontend.",
      );
    }

    console.log(
      "📊 Total images in request:",
      contentParts.filter((p) => p.inlineData).length,
    );
    console.log("⏳ Generating image (this may take 10-30 seconds)...");
    const imageResult = await imageModel.generateContent(contentParts);
    const imageResponse = imageResult.response;

    console.log("📥 Response received from Gemini");

    // Step 3: Extract generated image
    console.log("🔍 Step 3: Extracting generated image...");
    let generatedImageBuffer = null;

    if (imageResponse.candidates && imageResponse.candidates[0]) {
      const candidate = imageResponse.candidates[0];

      console.log("   Candidate found, checking for image data...");

      if (candidate.content && candidate.content.parts) {
        console.log("   Parts found:", candidate.content.parts.length);

        for (let i = 0; i < candidate.content.parts.length; i++) {
          const part = candidate.content.parts[i];

          if (part.inlineData && part.inlineData.data) {
            // Found generated image!
            console.log(`✅ Generated image found in part ${i}`);
            console.log("   Mime type:", part.inlineData.mimeType);
            generatedImageBuffer = Buffer.from(part.inlineData.data, "base64");
            console.log("   Image size:", generatedImageBuffer.length, "bytes");
            break;
          } else if (part.text) {
            console.log(
              `   Part ${i} contains text:`,
              part.text.substring(0, 100),
            );
          }
        }
      }
    }

    if (!generatedImageBuffer) {
      console.error("❌ No image generated in response");
      console.log(
        "   Response structure:",
        JSON.stringify(imageResponse, null, 2).substring(0, 500),
      );
      throw new Error("No image generated in response");
    }

    // ── COMPRESS: PNG → JPEG (~300-500KB vs ~4MB raw PNG) ──────────────────
    console.log("🗜️  Compressing image PNG → JPEG...");
    console.log("   Original size:", generatedImageBuffer.length, "bytes");
    const compressedBuffer = await sharp(generatedImageBuffer)
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();
    console.log(
      "   Compressed size:",
      compressedBuffer.length,
      "bytes",
      `(${Math.round((1 - compressedBuffer.length / generatedImageBuffer.length) * 100)}% smaller)`,
    );

    // Create file object for S3 upload (JPEG now)
    const generatedImageFile = {
      buffer: compressedBuffer,
      originalname: `gemini-tryon-${productName}.jpg`,
      mimetype: "image/jpeg",
    };

    // Step 4: Upload to S3
    console.log("📤 Step 4: Uploading to S3...");
    const s3Url = await uploadImageToS3(generatedImageFile, productName);

    console.log("✅ Complete! Virtual try-on image ready");

    return { imageUrl: s3Url };
  } catch (error) {
    console.error("❌ AI generation error:", error.message);
    console.error("   Full error:", error);

    // Fallback: Upload original image
    console.log("⚠️  Falling back to original image");

    try {
      const imageUrl = await uploadImageToS3(userImage, productName);
      return { imageUrl };
    } catch (uploadError) {
      throw new Error("Failed to process image: " + uploadError.message);
    }
  }
}

// Function to upload image to S3
async function uploadImageToS3(imageFile, productName) {
  try {
    console.log("📤 Uploading image to S3...");

    // Generate unique filename
    const ext =
      imageFile.mimetype === "image/jpeg"
        ? "jpg"
        : imageFile.originalname.split(".").pop();
    const fileName = `generated/${uuidv4()}.${ext}`;

    const cleanProductName = (productName || "Unknown")
      .replace(/[\r\n]+/g, " ")
      .replace(/[^\x20-\x7E]/g, "") // strip non-ASCII
      .substring(0, 200);

    // Also sanitize the filename itself
    const safeProductName = cleanProductName
      .replace(/[^a-zA-Z0-9\-_]/g, "-")
      .substring(0, 50);

    // Prepare S3 upload parameters
    const uploadParams = {
      Bucket: bucketName,
      Key: fileName,
      Body: imageFile.buffer,
      ContentType: imageFile.mimetype,
      // Cache for 7 days — images are unique UUIDs so no stale content risk
      CacheControl: "public, max-age=604800, immutable",
      Metadata: {
        "product-name": cleanProductName || "unknown",
        "upload-date": new Date().toISOString(),
      },
    };

    // Upload to S3
    await s3Client.send(new PutObjectCommand(uploadParams));

    // Generate public URL
    const region = process.env.S3_REGION || process.env.AWS_REGION;
    const imageUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${fileName}`;

    console.log("✅ Image uploaded successfully");
    console.log("🔗 URL:", imageUrl);

    return imageUrl;
  } catch (error) {
    console.error("❌ S3 upload error:", error);
    throw new Error("Failed to upload image to S3: " + error.message);
  }
}

module.exports = router;
