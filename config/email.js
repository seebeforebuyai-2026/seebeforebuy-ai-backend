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

/**
 * Track First Try-On event via Klaviyo
 *
 * @param {string} merchantEmail - Merchant's email address
 * @param {string} shopName - Shop name
 * @param {string} productName - Product that was tried on
 * @param {number} creditsLeft - Credits remaining
 * @param {number} creditsTotal - Total credits
 * @returns {Promise<boolean>} - Success status
 */
async function trackFirstTryOn(merchantEmail, shopName, productName, creditsLeft, creditsTotal) {
  try {
    console.log("👗 Tracking First Try On event via Klaviyo...");
    console.log("   Merchant:", merchantEmail);
    console.log("   Product:", productName);

    await eventsApi.createEvent({
      data: {
        type: "event",
        attributes: {
          metric: {
            data: {
              type: "metric",
              attributes: {
                name: "First Try On",
              },
            },
          },
          profile: {
            data: {
              type: "profile",
              attributes: {
                email: merchantEmail,
              },
            },
          },
          properties: {
            merchant_name: shopName,
            product_name: productName,
            credits_left: creditsLeft,
            credits_total: creditsTotal,
            dashboard_link: `https://admin.shopify.com/store/${shopName}/apps/see-before-buy-ai-full/app`,
            popup_link: `https://admin.shopify.com/store/${shopName}/apps/see-before-buy-ai-full/app/settings`,
            upgrade_link: `https://admin.shopify.com/store/${shopName}/apps/see-before-buy-ai-full/app/plans`,
          },
        },
      },
    });

    console.log("✅ First Try On event sent successfully!");
    return true;

  } catch (error) {
    console.error("❌ Klaviyo error:", error.message);
    if (error.response) {
      console.error("   Details:", JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

/**
 * Track Low Credits event via Klaviyo
 *
 * @param {string} merchantEmail - Merchant's email address
 * @param {string} shopName - Shop name
 * @param {number} creditsLeft - Credits remaining
 * @param {number} creditsTotal - Total credits
 * @param {number} creditsUsed - Credits used so far
 * @returns {Promise<boolean>} - Success status
 */
async function trackLowCredits(merchantEmail, shopName, creditsLeft, creditsTotal, creditsUsed) {
  try {
    console.log("⚡ Tracking Low Credits event via Klaviyo...");
    console.log("   Merchant:", merchantEmail);
    console.log("   Credits Left:", creditsLeft);

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
                email: merchantEmail,
              },
            },
          },
          properties: {
            merchant_name: shopName,
            credits_left: creditsLeft,
            credits_total: creditsTotal,
            credits_used: creditsUsed,
            days_left: creditsUsed > 0 ? Math.ceil(creditsLeft / (creditsUsed / 30)) : 30,
            upgrade_link: `https://admin.shopify.com/store/${shopName}/apps/see-before-buy-ai-full/app/plans`,
            dashboard_link: `https://admin.shopify.com/store/${shopName}/apps/see-before-buy-ai-full/app`,
            popup_link: `https://admin.shopify.com/store/${shopName}/apps/see-before-buy-ai-full/app/settings`,
          },
        },
      },
    });

    console.log("✅ Low Credits event sent successfully!");
    return true;

  } catch (error) {
    console.error("❌ Klaviyo error:", error.message);
    if (error.response) {
      console.error("   Details:", JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}



/**
 * Track Credits Exhausted event via Klaviyo
 *
 * @param {string} merchantEmail - Merchant's email address
 * @param {string} shopName - Shop name
 * @param {number} creditsTotal - Total credits
 * @param {number} monthlyTryon - Total try-ons this month
 * @returns {Promise<boolean>} - Success status
 */
async function trackCreditsExhausted(merchantEmail, shopName, creditsTotal, monthlyTryon) {
  try {
    console.log("🔴 Tracking Credits Exhausted event via Klaviyo...");
    console.log("   Merchant:", merchantEmail);

    const dailyTryon = Math.round(monthlyTryon / 30);
    const dailyLoss = Math.round(dailyTryon * 0.3 * 700); // 30% conversion × ₹700 AOV

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
                email: merchantEmail,
              },
            },
          },
          properties: {
            merchant_name: shopName,
            credits_left: 0,
            credits_total: creditsTotal,
            monthly_tryon: monthlyTryon,
            daily_tryon: dailyTryon,
            daily_loss: dailyLoss,
            upgrade_link: "https://dashboard.seebeforebuy.in/upgrade",
            dashboard_link: "https://dashboard.seebeforebuy.in/",
            popup_link: "https://dashboard.seebeforebuy.in/settings",
          },
        },
      },
    });

    console.log("✅ Credits Exhausted event sent successfully!");
    return true;

  } catch (error) {
    console.error("❌ Klaviyo error:", error.message);
    if (error.response) {
      console.error("   Details:", JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

module.exports = {
  sendWelcomeEmail,
  trackFirstTryOn,
  trackLowCredits,
  trackCreditsExhausted, // 👈 yeh add karo
};


console.log("✅ Klaviyo configured");


