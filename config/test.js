const { EventsApi, ApiKeySession } = require("klaviyo-api");

const klavioApiKey = process.env.KLAVIO_API_KEY || "pk_TFQhJ4_779696a46a11325b80fbae2a219441ca1f";

const session = new ApiKeySession(klavioApiKey);
const eventsApi = new EventsApi(session);

async function testCreditsExhaustedEvent() {
  try {
    console.log("🚀 Firing Credits Exhausted test event...");

    await eventsApi.createEvent({
      data: {
        type: "event",
        attributes: {
          metric: {
            data: {
              type: "metric",
              attributes: {
                name: "Credits Exhausted",
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
            credits_left: 0,
            credits_total: 50,
            monthly_tryon: 50,
            daily_tryon: 2,
            daily_loss: 420,
            upgrade_link: "https://dashboard.seebeforebuy.in/upgrade",
            dashboard_link: "https://dashboard.seebeforebuy.in/",
            popup_link: "https://dashboard.seebeforebuy.in/settings",
          },
        },
      },
    });

    console.log("✅ Credits Exhausted event fired successfully!");

  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.error("   Details:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

testCreditsExhaustedEvent();