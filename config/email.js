const klavioApiKey =
  process.env.KLAVIO_API_KEY || "pk_TFQhJ4_779696a46a11325b80fbae2a219441ca1f";

const { EventsApi, ProfilesApi, ApiKeySession } = require("klaviyo-api");

const session = new ApiKeySession(klavioApiKey);
const eventsApi = new EventsApi(session);
const profilesApi = new ProfilesApi(session);

// Your Email List ID
const LIST_ID = "ShJbSJ";

async function sendWelcomeEmail(toEmail, shopName, temporaryPassword) {
  try {
    console.log("📧 Sending welcome email via Klaviyo...");
    console.log("   To:", toEmail);
    console.log("   Shop:", shopName);

    // Step 1: Subscribe profile to list — sets consent to SUBSCRIBED
    await profilesApi.subscribeProfiles({
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          profiles: {
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
                  subscriptions: {
                    email: {
                      marketing: {
                        consent: "SUBSCRIBED",
                      },
                    },
                  },
                },
              },
            ],
          },
        },
        relationships: {
          list: {
            data: {
              type: "list",
              id: LIST_ID,
            },
          },
        },
      },
    });

    console.log("✅ Profile subscribed successfully!");

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
    console.error("❌ Klaviyo error:", error.message);

    // Print full error response for debugging
    if (error.response) {
      console.error("   Status:", error.response.status);
      console.error("   Details:", JSON.stringify(error.response.data, null, 2));
    }

    return false;
  }
}

module.exports = { sendWelcomeEmail };

console.log("✅ Klaviyo configured");