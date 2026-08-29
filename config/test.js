const { EventsApi, ApiKeySession } = require("klaviyo-api");

const klavioApiKey = process.env.KLAVIO_API_KEY || "pk_TFQhJ4_779696a46a11325b80fbae2a219441ca1f";

const session = new ApiKeySession(klavioApiKey);
const eventsApi = new EventsApi(session);

async function testLowCreditsEvent() {
  try {
    console.log("🚀 Firing Low Credits test event...");

    await eventsApi.createEvent({
      data: {
        type: "event",
        attributes: {
          metric: {
            data: {
              type: "metric",
              attributes: {
                name: "Low Credits",
              },
            },
          },
          profile: {
            data: {
              type: "profile",
              attributes: {
                email: "seebeforebuy.ai@gmail.com",
              },
            },
          },
          properties: {
            merchant_name: "Test Store",
            credits_left: 8,
            credits_total: 50,
            upgrade_link: "https://dashboard.seebeforebuy.in/upgrade",
            dashboard_link: "https://dashboard.seebeforebuy.in/",
          },
        },
      },
    });

    console.log("✅ Low Credits event fired successfully!");

  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.error("   Details:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

testLowCreditsEvent();