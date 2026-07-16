/**
 * Test OpenAI gpt-image-2 /v1/images/edits with two PNG images
 * Run: node test-openai.js
 */

require("dotenv").config();
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function test() {
  console.log("🔑 API Key present:", !!OPENAI_API_KEY);
  if (!OPENAI_API_KEY) { console.error("❌ Set OPENAI_API_KEY in .env"); process.exit(1); }

  // Create simple PNG buffers
  const fakeUserPng = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 100, b: 100, alpha: 1 } }
  }).png().toBuffer();

  const fakeProductPng = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 100, g: 100, b: 200, alpha: 1 } }
  }).png().toBuffer();

  console.log("📦 User PNG:", fakeUserPng.length, "bytes");
  console.log("📦 Product PNG:", fakeProductPng.length, "bytes");

  // ── Use native FormData + Blob (Node 18+) ────────────────────────────────
  console.log("\n── Test: Native FormData + Blob ──");
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("quality", "low");
  form.append("prompt", "A plain white t-shirt on white background, product photography.");
  form.append("image[]", new Blob([fakeUserPng], { type: "image/png" }), "customer.png");
  form.append("image[]", new Blob([fakeProductPng], { type: "image/png" }), "product.png");

  try {
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      // Do NOT set Content-Type — fetch sets it automatically with boundary
      body: form,
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 300) }; }

    if (res.status === 200) {
      const b64 = data?.data?.[0]?.b64_json;
      if (b64) {
        fs.writeFileSync(path.join(__dirname, "test-openai-output.png"), Buffer.from(b64, "base64"));
        console.log("✅ SUCCESS! Image saved to test-openai-output.png");
      } else {
        console.log("⚠️  200 OK but no image:", JSON.stringify(data).substring(0, 200));
      }
    } else {
      console.log(`❌ Status ${res.status}:`, data?.error?.message || JSON.stringify(data).substring(0, 300));
    }
  } catch (e) {
    console.log("❌ Fetch error:", e.message);
  }
}

test().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
