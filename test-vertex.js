/**
 * Google AI image generation test — tries both Vertex AI and Gemini API endpoints
 * Run: node test-vertex.js
 */

const { GoogleAuth } = require("google-auth-library");
const path = require("path");
const fs = require("fs");

const KEY_FILE = path.join(__dirname, "new-project-profitfirst-fc93b0361f88.json");
const PROJECT_ID = "new-project-profitfirst";
const LOCATION = "us-central1";

// ── Current GA model names as of July 2026 ──────────────────────────────────
const VERTEX_MODELS = [
  "gemini-3-pro-image",           // GA since May 28, 2026 — best for try-on
  "gemini-2.5-flash-image",       // Fast + balanced
  "imagen-4.0-generate-001",      // Imagen 4 GA
  "imagen-4.0-fast-generate-001", // Imagen 4 Fast GA
];

async function getAccessToken() {
  const auth = new GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  return tokenRes.token;
}

function saveImage(data) {
  // Gemini-style response
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const buf = Buffer.from(part.inlineData.data, "base64");
      const file = path.join(__dirname, "test-output.jpg");
      fs.writeFileSync(file, buf);
      return { success: true, size: buf.length, file };
    }
  }
  // Imagen-style response
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (b64) {
    const buf = Buffer.from(b64, "base64");
    const file = path.join(__dirname, "test-output.jpg");
    fs.writeFileSync(file, buf);
    return { success: true, size: buf.length, file };
  }
  return { success: false };
}

async function tryVertexGemini(model, token) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: "Generate a photorealistic image of a plain white t-shirt on white background, studio product photography." }] }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { return { status: res.status, data: { raw: text.substring(0, 200) } }; }
  return { status: res.status, data };
}

async function tryVertexImagen(model, token) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}:predict`;
  const body = {
    instances: [{ prompt: "A plain white t-shirt on white background, product photography" }],
    parameters: { sampleCount: 1 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { return { status: res.status, data: { raw: text.substring(0, 200) } }; }
  return { status: res.status, data };
}

async function test() {
  console.log("🔑 Authenticating...");
  if (!fs.existsSync(KEY_FILE)) { console.error("❌ Key file missing:", KEY_FILE); process.exit(1); }

  const token = await getAccessToken();
  console.log("✅ Token obtained\n");

  let working = null;

  // ── Try Vertex AI models ──────────────────────────────────────────────────
  console.log("── Testing Vertex AI endpoint (" + LOCATION + ") ──");
  for (const model of VERTEX_MODELS) {
    process.stdout.write(`   ${model}... `);
    try {
      const isImagen = model.startsWith("imagen");
      const { status, data } = isImagen
        ? await tryVertexImagen(model, token)
        : await tryVertexGemini(model, token);

      if (status === 200) {
        const saved = saveImage(data);
        if (saved.success) {
          console.log(`✅ WORKS! ${saved.size} bytes → ${saved.file}`);
          working = { provider: "vertex", model };
          break;
        }
        console.log(`⚠️  200 OK but no image. Response: ${JSON.stringify(data).substring(0, 150)}`);
      } else if (status === 404) {
        console.log("❌ 404 — model not found");
      } else if (status === 403) {
        console.log("❌ 403 — permission denied");
      } else {
        const msg = data?.error?.message || JSON.stringify(data).substring(0, 100);
        console.log(`❌ ${status} — ${msg}`);
      }
    } catch (e) {
      console.log(`❌ Error: ${e.message.substring(0, 100)}`);
    }
  }

  // ── If Vertex AI failed, try direct Gemini API with API key ───────────────
  if (!working) {
    console.log("\n── Trying Gemini API (api.generativeai.google.com) ──");
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      console.log("   ⚠️  No GEMINI_API_KEY in environment — skipping");
    } else {
      const geminiModels = ["gemini-3-pro-image", "gemini-2.5-flash-preview-04-17"];
      for (const model of geminiModels) {
        process.stdout.write(`   ${model}... `);
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
          const body = {
            contents: [{ role: "user", parts: [{ text: "Generate a photorealistic image of a white t-shirt on white background." }] }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
          };
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (res.status === 200) {
            const saved = saveImage(data);
            if (saved.success) {
              console.log(`✅ WORKS via Gemini API! ${saved.size} bytes`);
              working = { provider: "gemini-api", model };
              break;
            }
            console.log(`⚠️  200 but no image: ${JSON.stringify(data).substring(0, 150)}`);
          } else {
            const msg = data?.error?.message || "";
            console.log(`❌ ${res.status} — ${msg.substring(0, 100)}`);
          }
        } catch (e) {
          console.log(`❌ ${e.message.substring(0, 80)}`);
        }
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  if (working) {
    console.log(`\n✅✅✅  SUCCESS!`);
    console.log(`   Provider : ${working.provider}`);
    console.log(`   Model    : ${working.model}`);
    console.log(`   Output   : test-output.jpg\n`);
    console.log("🚀 Ready to update generate-image.js and deploy!\n");
  } else {
    console.log("\n❌ Nothing worked yet. Most likely cause:\n");
    console.log("   The Vertex AI API was just enabled — it can take 5-10 minutes to propagate.");
    console.log("   Wait a few minutes and run: node test-vertex.js\n");
    console.log("   Also check billing is active on your Google Cloud project:");
    console.log(`   https://console.cloud.google.com/billing?project=${PROJECT_ID}\n`);
    console.log("   And confirm 'Vertex AI User' role is assigned:");
    console.log(`   https://console.cloud.google.com/iam-admin/iam?project=${PROJECT_ID}\n`);
  }
}

require("dotenv").config();
test().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
