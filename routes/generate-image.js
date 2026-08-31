// Generate image route - handles OpenAI gpt-image-2 virtual try-on
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client, bucketName } = require("../config/s3");
const ShopModel = require("../models/dynamodb-shop");
const UsageLogModel = require("../models/dynamodb-usage-log");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const {
  trackFirstTryOn,
  trackLowCredits,
  trackCreditsExhausted,
} = require("../config/email");
const { selectPromptKey } = require("../services/prompt-selection");
// NOTE: Using native FormData + Blob (Node 18+), NOT the form-data npm package

// Configure multer for image upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// OpenAI config
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/edits";

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

    const productCategory =
      req.body.product_category || shop.product_category || "default";

    let selectedCategories = Array.isArray(shop.product_categories)
      ? shop.product_categories
      : [];
    const rawSelectedCategories =
      req.body.categories || req.body.selected_categories || null;
    if (rawSelectedCategories) {
      try {
        const parsed = JSON.parse(rawSelectedCategories);
        if (Array.isArray(parsed)) {
          selectedCategories = parsed;
        }
      } catch (parseError) {
        console.warn(
          "⚠️ Could not parse incoming categories payload:",
          parseError.message,
        );
      }
    }

    const promptTextSeed = [
      product_name,
      req.body.product_title || "",
      req.body.product_description || "",
      req.body.product_category || "",
    ]
      .filter(Boolean)
      .join(" ");

    // ── NEW: if frontend sent a fully-resolved custom_prompt, use it directly ──
    const customPrompt = req.body.custom_prompt || null;

    let resolvedCategory = "default";
    if (!customPrompt) {
      // Fall back to old selectPromptKey logic only when no custom prompt
      resolvedCategory = selectPromptKey({
        productText: promptTextSeed || product_name || productCategory,
        selectedCategories,
        fallbackCategory: productCategory,
      });
    }

    console.log(`🏷️  Product category: ${productCategory}`);
    if (customPrompt) {
      console.log(
        `📝 Using custom_prompt from frontend (${customPrompt.length} chars)`,
      );
    } else {
      console.log(`🧠 Resolved prompt category: ${resolvedCategory}`);
    }

    const aiResult = await generateImageWithOpenAI(
      userImage,
      product_name,
      product_image_url,
      resolvedCategory,
      customPrompt, // <-- pass through (null if not provided)
    );

    // Extract image URL + prompt tracking info
    const generatedImageUrl = aiResult.imageUrl;
    const promptCategory = aiResult.promptCategory || productCategory;
    const promptPreview = aiResult.promptPreview || null;
    const aiModel = aiResult.aiModel || "gpt-image-2";

    if (shop.images_used === 2) {
      await trackFirstTryOn(
        shop.shop_email,
        shop.shop_name || shop.shop_domain,
        product_name,
        shop.images_limit - 1,
        shop.images_limit,
      );
    }

    // Increment usage
    await ShopModel.incrementUsage(shop_domain);

    const previousCreditsLeft = shop.images_limit - shop.images_used;
    const creditsUsed = shop.images_used + 1;
    const creditsLeft = shop.images_limit - creditsUsed;

    if (previousCreditsLeft > 10 && creditsLeft <= 10) {
      await trackLowCredits(
        shop.shop_email,
        shop.shop_name || shop.shop_domain,
        creditsLeft,
        shop.images_limit,
        creditsUsed,
      );
    }

    if (creditsLeft === 0) {
      await trackCreditsExhausted(
        shop.shop_email,
        shop.shop_name || shop.shop_domain,
        shop.images_limit,
        shop.images_used + 1,
      );
    }

    const generationTime = Date.now() - startTime;

    setImmediate(async () => {
      try {
        await UsageLogModel.create({
          shop_domain,
          shop_id: shop.shop_id,
          event_type: "image_generated",
          session_id: session_id || null,
          product_name,
          product_image_url,
          generated_image_url: generatedImageUrl,
          generation_time_ms: generationTime,
          // Prompt tracking — the key new fields
          ai_model: aiModel,
          prompt_category: promptCategory,
          prompt_preview: promptPreview,
        });
        console.log(`✅ Background: usage logged`);
        console.log(`   Model: ${aiModel} | Category: ${promptCategory}`);
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
  default: (productName) =>
    `Create a polished, photorealistic fashion image of the customer wearing the product shown in the reference image. Preserve the customer's face, skin tone, pose, hairstyle, and background while replacing the clothing with the exact style, fit, and details from the reference. Make the result look like a real, high-end fashion photo.`,

  party_dresses: (productName) =>
    `Create a polished, photorealistic fashion image of the customer wearing the party dress shown in the product reference image. Preserve the customer's face, skin tone, pose, hairstyle, and background while replacing the clothing with the exact party dress style, fit, and details from the reference. Match the dress color, silhouette, neckline, fabric, and embellishments closely and make the result look like a real, high-end fashion photo.`,

  cocktail_dress: (productName) => `TASK:
Image 1: Product photo of a Cocktail Dress
         (a semi-formal to formal short dress — typically knee-length or above,
          could be bodycon, A-line, fit-and-flare, wrap, or structured.
          Often features embellishments: sequins, lace, satin, or embroidery)
Image 2: Full body or 3/4 body photo of the user (woman)
Goal: Show the user wearing this exact cocktail dress as if she put it on in real life.

STEP 1 — ANALYZE THE DRESS:
- Identify silhouette: bodycon, A-line, fit-and-flare, wrap, shift, or structured/peplum
- Identify neckline: V-neck, sweetheart, off-shoulder, one-shoulder, halter, or strapless
- Identify length: above knee (mini), at knee, or just below knee
- Identify embellishment type: sequins, lace, satin, velvet, embroidery, or chiffon overlay
- Identify sleeve: sleeveless, spaghetti strap, short sleeve, or long sleeve

STEP 2 — FULL BODY PLACEMENT:
- Neckline must start at the exact position shown in the product — match precisely
- Side seams must follow the user's actual body outline
- For bodycon: fabric clings to the body — show the user's natural curves through the fabric
- For A-line/fit-and-flare: fitted at bodice, flares at waist or hip — show fabric volume at skirt
- Hem must fall at the correct position on the user's legs (above knee, at knee, or below)
- Back of the dress (if open-back): must show the opening naturally if the user's back is visible

STEP 3 — NECKLINE PRECISION:
- Sweetheart: curved neckline following the bust line — no gap, no floating fabric
- Off-shoulder: fabric sits ACROSS the collarbone, both shoulders bare
  The tube of fabric must hug the chest and NOT slide or float
- One-shoulder: one side covers, the other is completely bare — exact shoulder position must match
- Strapless: fabric starts at the chest — show the structural boning edge
  No straps must be visible unless the product has them
- Halter: ties or loops at the back of the neck — fabric falls from neck to bust
- V-neck: reproduce exact depth of V — shallow or plunging, match the product exactly

STEP 4 — EMBELLISHMENT REALISM (MOST CRITICAL FOR PARTY WEAR):
- Full sequin dress:
  Each sequin must individually catch light
  Show MULTIPLE light catches across the dress — not a single reflection
  Sequins near the light source: bright sparkle
  Sequins in shadow areas: darker but still reflective
  The sequin texture must look dimensional — tiny discs overlapping each other
  Never render a sequin dress as a flat shiny surface
- Lace overlay:
  The lace pattern must be visible as a mesh — semi-transparent
  Reproduce the exact floral or geometric lace motif from the product
  Show the fabric beneath the lace through the mesh holes
  Lace edges must appear delicate — not thick or painted
- Satin dress:
  Very high contrast — bright specular highlight on the peaks of fabric folds
  Deep, dark shadow in the valleys
  The highlight must move as a single bright band across the surface
  Show the characteristic "liquid" quality of satin — one side bright, other in shadow
- Velvet dress:
  Directional pile — the colour appears lighter in one direction, darker in the other
  Show the characteristic colour shift where the fabric changes direction
  Matte surface — no high-gloss shine like satin
  Rich, deep colour with soft diffused highlight
- Embroidered bodice:
  Reproduce exact embroidery motif, thread colour, and placement
  Raised thread texture must be visible — not flat
  Stone or crystal embellishments must catch light as individual points

STEP 5 — BODYCON SPECIFIC RULES:
- Fabric must hug the body continuously — no gaps or floating sections
- Show the natural contour of the user's body THROUGH the fabric
- Fabric creases at the hip and mid-thigh from body movement
- The dress must look like it is ON the body — not placed over it

STEP 6 — FIT-AND-FLARE / A-LINE SPECIFIC RULES:
- The transition from fitted bodice to flared skirt must happen at the exact waistline
- Skirt volume must look three-dimensional — show fabric fullness and movement
- Hem must swing or show slight movement — not hang perfectly flat

STEP 7 — LIGHTING:
- Identify dominant light direction from user's photo
- Sequin dress: multiple scattered light catches — not directional, scattered sparkle
- Satin: one broad directional highlight band across the surface
- Velvet: soft diffused highlight, darker in shadow — no specular shine
- Lace: light passes through the mesh holes, creating soft light patterns on skin beneath

STEP 8 — SELF CHECK:
[ ] Does the neckline style match the product exactly?
[ ] Is the hem at the correct length on the user's legs?
[ ] Are sequins rendered as individual light-catching elements (not flat shiny surface)?
[ ] Is satin showing high-contrast directional highlight and shadow?
[ ] Is lace semi-transparent with mesh pattern visible?
[ ] Is velvet showing directional pile colour shift?
[ ] Does bodycon fabric hug the body — not float over it?
[ ] User's face, skin tone, and body completely unchanged?
[ ] No extra jewellery, accessories, or shoes added?

Output the final image only.`,
  evening_gown: (productName) => `TASK:
Image 1: Product photo of an Evening Gown
         (a full-length formal gown worn to black-tie events, galas, or
          formal parties — typically floor-length or with a train.
          Could be ball gown, mermaid, A-line, column/sheath, or empire waist.
          Often features premium fabrics: chiffon, tulle, satin, velvet, or heavily
          embellished with crystals, beading, or intricate embroidery)
Image 2: Full body photo of the user (woman) — must show full height for gown length to work
Goal: Show the user wearing this exact evening gown.

STEP 1 — ANALYZE THE GOWN:
- Identify silhouette: ball gown, mermaid/trumpet, A-line, column/sheath, or empire waist
- Identify neckline: plunging V, sweetheart, off-shoulder, illusion, halter, or high neck
- Identify train: no train, sweep train, chapel train, or dramatic cathedral train
- Identify fabric: satin, chiffon, tulle, velvet, organza, crepe, or beaded fabric
- Identify embellishments: crystal/bead embroidery, feather trim, ruching, or draping detail

STEP 2 — FULL BODY SILHOUETTE PLACEMENT:
Ball Gown:
- Fitted structured bodice from shoulder to natural waist
- Dramatic full skirt begins at the waist — volume is EXTREME
- Skirt must look three-dimensional with layers of fabric creating depth
- If tulle underlayer: show the tulle volume creating the shape beneath the outer fabric
- The skirt must be the most dramatic visual element — wide, full, majestic

Mermaid / Trumpet:
- Fitted from chest to mid-thigh — skin-tight, show the body's shape through the fabric
- Flares dramatically below the knee — the flare must look like an explosion of fabric
- The transition point (where it flares) must happen at the exact right position on the leg
- Train (if present): fabric extends behind the user — show the length trailing naturally

A-line Gown:
- Fitted at the bodice, gradually flares from the waist to the floor
- More subtle volume than ball gown — elegant flow, not extreme fullness
- Floor-length hem must touch or brush the floor at the correct height

Column / Sheath:
- Minimal flare — follows the body from shoulder to floor in a straight line
- Shows the body's silhouette through the fabric
- Any ruching, draping, or side slits must be reproduced exactly
- Side slit: must show at the exact height — revealing the leg naturally from that point

Empire Waist:
- Bodice ends just below the bust line — seam sits at the bust, not the natural waist
- Skirt flows from under the bust — lightweight, flowing fabric
- Fabric must look fluid and flowing from the high waistline

STEP 3 — TRAIN REPRODUCTION:
- If the product has a train: it must extend BEHIND the user on the floor
- Even if the user is facing forward, the train must be implied at the sides or back
- Train fabric must follow gravity — lying on the floor, not floating
- If the product photo shows the train spread out: reproduce that spread
- Train embellishments or border must match the gown exactly

STEP 4 — PREMIUM FABRIC REALISM:
Beaded / Crystal Embroidery (most common on evening gowns):
- Each bead and crystal must individually catch light
- Different parts of the gown have different bead densities — reproduce this
- Heavy beading at bodice: maximum sparkle and light reflection
- Lighter beading at skirt: more subtle, scattered sparkle
- Bugle beads (elongated): show the directional light reflection along their length
- Crystal stones: show the faceted refraction — multiple light points per stone, not one dot

Chiffon gown:
- Multiple layers visible at the skirt — slight transparency in thin areas
- Fabric flows and moves — hem appears to float slightly
- Light passes through the fabric — show subtle glow at the hem edges

Tulle ball gown:
- Show multiple layers of tulle creating volume — each layer adds depth
- Tulle is stiff and holds its shape — the skirt must look structural, not floppy
- Surface tulle may have embroidery or sparkle — reproduce exactly
- The sheer quality of tulle must be visible — it is NOT opaque fabric

Ruched satin/crepe:
- Ruching creates horizontal gather lines across the fabric
- Each gather must be visible as a ridge — not smoothed out
- Fabric between gathers pulls tight — show the tension in the fabric

STEP 5 — NECKLINE PRECISION:
- Illusion neckline: sheer fabric covers the décolletage and shoulders
  The skin beneath is visible through the sheer — reproduce this transparency
  Embellishments on the illusion fabric float above the skin
- Plunging V: reproduce exact depth — may plunge to the sternum or lower
- Off-shoulder: fabric sits at the arm line, both shoulders completely exposed
- High neck / Turtleneck: fabric reaches the base of the neck completely

STEP 6 — LIGHTING FOR FORMAL EVENING WEAR:
- Evening gowns are designed for dramatic lighting — reproduce this quality
- Beaded/crystal fabric: scattered multi-point sparkle across the entire dress
- Satin gown: dramatic single highlight band — very bright highlight, very deep shadow
- Velvet gown: rich deep colour, soft highlight, almost no specular shine
- The gown must look GLAMOROUS — not flat or muted
- Maintain light direction consistency from the user's photo

STEP 7 — SELF CHECK:
[ ] Does the silhouette match the product exactly (ball gown volume, mermaid flare point)?
[ ] Does the hem reach the floor at the correct height on the user?
[ ] If there is a train, is it shown trailing behind/to the side?
[ ] Are beads and crystals rendered as individual light-catching elements?
[ ] Is tulle showing volume and slight transparency?
[ ] Is chiffon showing soft flow and layered depth?
[ ] Is the neckline style exactly reproduced?
[ ] Does the gown look GLAMOROUS — not flat or dull?
[ ] User's face, skin tone, and body completely unchanged?
[ ] No extra jewellery, accessories, or shoes added to the image?

Output the final image only.`,
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
  ) => `Task: Perform a professional virtual Kurti/Kurta try-on.
Target Subject: The person in the Customer Image (@Image1).
Product to Try On: "${productName}" (shown in the Product Reference Image @Image2).

Instructions:
1. Study @Image2 carefully — copy the EXACT garment shown: its length (hip/thigh/knee/ankle), neckline shape, sleeve style, color, embroidery, prints, and silhouette precisely as shown. Do not assume or invent any detail.
2. Replace the current upper garment of the subject in @Image1 with the exact Kurti/Kurta from @Image2.
3. Fit the neckline cleanly around the collar bones. Match the sleeves and hemline exactly as shown in @Image2 — if it is a short kurti, keep it short; if ankle-length, render it ankle-length.
4. Reproduce all embroidery, block prints, or thread work from @Image2 as ethnic surface decoration on the fabric — never interpret neckline embroidery as blazer lapels.
5. Strictly preserve the subject's face, hair, lower body clothing, hands, pose, and original background exactly as shown in @Image1.`,

  saree: (
    productName,
  ) => `Task: Perform a highly realistic virtual Saree try-on.
Target Subject: The person in the Customer Image (@Image1).
Product to Try On: "${productName}" (shown in the Product Reference Image @Image2).

Instructions:
1. Elegantly drape the Saree "${productName}" shown in @Image2 onto the person in @Image1.
2. The pallu (saree drape) must cascade naturally over the subject's left shoulder, and the waist pleats must align neatly to their waistline, matching their body contours.
3. Match the blouse design and sleeve cut as depicted in @Image2, fitting it seamlessly to the subject.
4. Preserve the intricate zari borders, silk/georgette textures, and woven motifs of the saree in @Image2 with high fidelity.
5. Do not modify the subject's face, skin tone, expression, hairstyle, hands, or original background from @Image1.`,

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

async function generateImageWithOpenAI(
  userImage,
  productName,
  productImageUrl,
  productCategory = "apparel",
  customPrompt = null, // NEW — full prompt text from frontend prompts.js
) {
  try {
    console.log("🎨 Starting OpenAI gpt-image-2 virtual try-on...");
    console.log("   Product:", productName);
    console.log("   Category:", productCategory);
    console.log("   User image size:", userImage.size, "bytes");

    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set in environment variables.");
    }

    // Step 1: Resolve prompt — custom_prompt takes priority over CATEGORY_PROMPTS
    let promptText;
    if (customPrompt && customPrompt.trim().length > 0) {
      promptText = customPrompt.trim();
      console.log(
        `📝 Using custom_prompt from frontend (${promptText.length} chars)`,
      );
    } else {
      const promptFunction =
        CATEGORY_PROMPTS[productCategory] || CATEGORY_PROMPTS.default;
      promptText = promptFunction(productName);
      console.log(
        `📝 Using CATEGORY_PROMPTS[${productCategory}] (${promptText.length} chars)`,
      );
    }

    // ── DETAILED REQUEST LOG — visible in PM2 logs for every request ──────
    console.log("┌─────────────────────────────────────────────────────");
    console.log(`│ 🔍 AI REQUEST DETAILS`);
    console.log(`│ Shop     : ${productName}`);
    console.log(`│ Category : ${productCategory}`);
    console.log(`│ Model    : gpt-image-2 (low quality)`);
    console.log(`│ Endpoint : ${OPENAI_ENDPOINT}`);
    console.log(`│ Prompt preview (first 300 chars):`);
    console.log(`│ ${promptText.substring(0, 300).replace(/\n/g, "\n│ ")}`);
    console.log("└─────────────────────────────────────────────────────");

    // Step 2: Download product image
    let productImageBuffer = null;
    let productImageMimeType = "image/jpeg";

    if (productImageUrl) {
      console.log("📥 Step 2: Downloading product image...");
      try {
        // Normalize protocol-relative URLs (//example.com/...) to https://
        const normalizedUrl = productImageUrl.startsWith("//")
          ? "https:" + productImageUrl
          : productImageUrl;
        const productResponse = await fetch(normalizedUrl);
        if (!productResponse.ok)
          throw new Error(`HTTP ${productResponse.status}`);
        productImageBuffer = Buffer.from(await productResponse.arrayBuffer());
        const ct = productResponse.headers.get("content-type");
        if (ct) productImageMimeType = ct.split(";")[0].trim();
        console.log(
          "✅ Product image downloaded:",
          productImageBuffer.length,
          "bytes",
        );
      } catch (err) {
        console.error("❌ Could not download product image:", err.message);
        console.log("   Will proceed with customer image only");
      }
    }

    // Step 3: Build FormData using native FormData + Blob (required by OpenAI)
    // Key rules: use image[] for multiple images, never set Content-Type manually
    console.log("🎨 Step 3: Calling OpenAI gpt-image-2 /v1/images/edits...");

    // Convert user image to PNG (OpenAI edits endpoint only accepts PNG)
    console.log("🔄 Converting user image to PNG...");
    const userImagePng = await sharp(userImage.buffer).png().toBuffer();
    console.log(`✅ User image PNG: ${userImagePng.length} bytes`);

    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("quality", "low");
    form.append("prompt", promptText);

    // Customer photo → @Image1 using native Blob
    form.append(
      "image[]",
      new Blob([userImagePng], { type: "image/png" }),
      "customer_photo.png",
    );

    // Product photo → @Image2 using native Blob
    if (productImageBuffer) {
      const productImagePng = await sharp(productImageBuffer).png().toBuffer();
      form.append(
        "image[]",
        new Blob([productImagePng], { type: "image/png" }),
        "product_photo.png",
      );
      console.log(
        `✅ Product image PNG: ${productImagePng.length} bytes included as @Image2`,
      );
    }

    console.log("⏳ Generating image (15-30 seconds)...");
    const apiRes = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        // Do NOT set Content-Type — fetch sets it automatically with correct boundary
      },
      body: form,
    });

    if (!apiRes.ok) {
      const errData = await apiRes.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error ${apiRes.status}: ${errData.error?.message || apiRes.statusText}`,
      );
    }

    const imageData = await apiRes.json();
    console.log("📥 Response received from OpenAI");

    // Step 4: Extract base64 image
    const generatedBase64 = imageData?.data?.[0]?.b64_json;
    if (!generatedBase64) {
      console.error(
        "❌ No image in response:",
        JSON.stringify(imageData).substring(0, 400),
      );
      throw new Error("OpenAI did not return an image.");
    }

    const generatedImageBuffer = Buffer.from(generatedBase64, "base64");
    console.log(`✅ Image extracted — ${generatedImageBuffer.length} bytes`);

    // Step 5: Compress PNG → JPEG for faster delivery
    console.log("🗜️  Compressing PNG → JPEG...");
    const compressedBuffer = await sharp(generatedImageBuffer)
      .jpeg({ quality: 85, progressive: true, mozjpeg: true })
      .toBuffer();
    console.log(
      `   ${generatedImageBuffer.length} → ${compressedBuffer.length} bytes (${Math.round((1 - compressedBuffer.length / generatedImageBuffer.length) * 100)}% smaller)`,
    );

    // Step 6: Upload to S3
    console.log("📤 Step 6: Uploading to S3...");
    const s3Url = await uploadImageToS3(
      {
        buffer: compressedBuffer,
        originalname: "openai-tryon.jpg",
        mimetype: "image/jpeg",
      },
      productName,
    );
    console.log("✅ Complete! Virtual try-on image ready");
    return {
      imageUrl: s3Url,
      promptCategory: productCategory,
      promptPreview: promptText.substring(0, 500),
      aiModel: "gpt-image-2",
    };
  } catch (error) {
    console.error("❌ OpenAI generation error:", error.message);
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
