/**
 * ============================================
 * Email Configuration (Nodemailer)
 * ============================================
 * 
 * Simple email sending using Nodemailer with Gmail SMTP
 */

const klavioApiKey = process.env.KLAVIO_API_KEY || 'pk_TFQhJ4_779696a46a11325b80fbae2a219441ca1f';


const { EventsApi, ApiKeySession } = require('klaviyo-api');

// Initialize Klaviyo
const session = new ApiKeySession(klavioApiKey);
const eventsApi = new EventsApi(session);

/**
 * Send welcome email to merchant via Klaviyo
 *
 * @param {string} toEmail - Merchant's email address
 * @param {string} shopName - Shop name
 * @param {string} temporaryPassword - Generated password
 * @returns {Promise<boolean>} - Success status
 */
async function sendWelcomeEmail(toEmail, shopName, temporaryPassword) {
  try {
    console.log('📧 Sending welcome email via Klaviyo...');
    console.log('   To:', toEmail);
    console.log('   Shop:', shopName);

    await eventsApi.createEvent({
      data: {
        type: 'event',
        attributes: {
          metric: {
            data: {
              type: 'metric',
              attributes: {
                name: 'App Installed'
              }
            }
          },
          profile: {
            data: {
              type: 'profile',
              attributes: {
                email: toEmail,
                first_name: shopName,
                properties: {
                  merchant_name: shopName,
                  temporary_password: temporaryPassword
                }
              }
            }
          },
          properties: {
            onboarding_link: 'https://dashboard.seebeforebuy.in/',
            temporary_password: temporaryPassword,
            shop_name: shopName
          }
        }
      }
    });

    console.log('✅ Klaviyo App Installed event sent successfully!');
    return true;

  } catch (error) {
    console.error('❌ Klaviyo error:', error);
    console.error('   Error message:', error.message);
    return false;
  }
}

module.exports = {
  sendWelcomeEmail,
};

console.log('✅ Klaviyo configured');
