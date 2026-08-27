const klavioApiKey =
  process.env.KLAVIO_API_KEY || "pk_TFQhJ4_779696a46a11325b80fbae2a219441ca1f";

const { EventsApi, ListsApi, ApiKeySession } = require("klaviyo-api");

// Initialize Klaviyo
const session = new ApiKeySession(klavioApiKey);
const eventsApi = new EventsApi(session);
const listsApi = new ListsApi(session);

// Your Klaviyo List ID — Email List
const LIST_ID = "ShJbSJ";

async function sendWelcomeEmail(toEmail, shopName, temporaryPassword) {
  try {
    console.log("📧 Sending welcome email via Klaviyo...");
    console.log("   To:", toEmail);
    console.log("   Shop:", shopName);

    // Step 1: Add profile to list — this sets consent to SUBSCRIBED automatically
    await listsApi.createListRelationships(LIST_ID, {
      data: [
        {
          type: "profile",
          attributes: {
            email: toEmail,
            first_name: shopName,
            properties: {
              merchant_name: shopName,
              temporary_password: temporaryPassword,
            },
          },
        },
      ],
    });

    console.log("✅ Profile subscribed to list!");

    // Step 2: Fire App Installed event
    await eventsApi.createEvent({
      data: {
        type: "event",
        attributes: {
          metric: {
            data: {
              type: "metric",
              attributes: {
                name: "App Installed",
              },
            },
          },
          profile: {
            data: {
              type: "profile",
              attributes: {
                email: toEmail,
              },
            },
          },
          properties: {
            onboarding_link: `https://admin.shopify.com/store/${shopName}/apps/see-before-buy-ai-full/app`,
            temporary_password: temporaryPassword,
            shop_name: shopName,
          },
        },
      },
    });

    console.log("✅ Klaviyo App Installed event sent successfully!");
    return true;

  } catch (error) {
    console.error("❌ Klaviyo error:", error);
    console.error("   Error message:", error.message);
    return false;
  }
}

module.exports = {
  sendWelcomeEmail,
};

console.log("✅ Klaviyo configured");