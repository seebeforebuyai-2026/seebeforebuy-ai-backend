/**
 * ============================================
 * AWS SES (Simple Email Service) Configuration
 * ============================================
 * 
 * This file configures AWS SES for sending emails.
 * SES is Amazon's email sending service.
 */

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

// Create SES client with AWS credentials
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Send welcome email to merchant
 * 
 * @param {string} toEmail - Merchant's email address
 * @param {string} shopName - Shop name
 * @param {string} temporaryPassword - Generated password
 * @returns {Promise<boolean>} - Success status
 */
async function sendWelcomeEmail(toEmail, shopName, temporaryPassword) {
  try {
    console.log('📧 Preparing to send welcome email...');
    console.log('   To:', toEmail);
    console.log('   Shop:', shopName);

    // Email sender (must be verified in AWS SES)
    const fromEmail = process.env.SES_FROM_EMAIL || 'noreply@seebeforebuy.com';

    // Email subject
    const subject = '🎉 Welcome to See Before Buy AI!';

    // Email body (HTML)
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
      border-radius: 10px 10px 0 0;
    }
    .content {
      background: #f9f9f9;
      padding: 30px;
      border-radius: 0 0 10px 10px;
    }
    .credentials {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
      border-left: 4px solid #667eea;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 30px;
      text-decoration: none;
      border-radius: 8px;
      margin: 20px 0;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎉 Welcome to See Before Buy AI!</h1>
  </div>
  
  <div class="content">
    <p>Hi ${shopName} team,</p>
    
    <p>Thank you for installing See Before Buy AI! Your account has been created successfully.</p>
    
    <p>Your customers can now use AI-powered virtual try-on to see themselves wearing your products before they buy.</p>
    
    <div class="credentials">
      <h3>📋 Your Login Credentials</h3>
      <p><strong>Email:</strong> ${toEmail}</p>
      <p><strong>Temporary Password:</strong> <code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px;">${temporaryPassword}</code></p>
      <p><strong>Login URL:</strong> <a href="https://dashboard.seebeforebuy.in/">https://dashboard.seebeforebuy.in/</a></p>
      <p style="color: #666; font-size: 14px; margin-top: 15px;">
        ⚠️ Please change your password after first login for security.
      </p>
    </div>
    
    <h3>🚀 Next Steps:</h3>
    <ol>
      <li>Add the "Try the Look" button to your product pages via the theme editor</li>
      <li>Test the virtual try-on feature with sample products</li>
      <li>Monitor your usage in the dashboard</li>
    </ol>
    
    <h3>📊 Your Free Plan Includes:</h3>
    <ul>
      <li>✅ 50 AI-generated images per month</li>
      <li>✅ Unlimited product pages</li>
      <li>✅ Basic analytics</li>
      <li>✅ Email support</li>
    </ul>
    
    <p>Need more images? Upgrade anytime from your dashboard!</p>
        
    <p>If you have any questions, reply to this email or contact us at <a href="mailto:support@seebeforebuy.com">support@seebeforebuy.com</a></p>
    
    <p>Best regards,<br>
    The See Before Buy AI Team</p>
  </div>
  
  <div class="footer">
    <p>© 2025 See Before Buy AI. All rights reserved.</p>
    <p>This email was sent to ${toEmail} because you installed our app on Shopify.</p>
  </div>
</body>
</html>
    `;

    // Email body (Plain text fallback)
    const textBody = `
Welcome to See Before Buy AI!

Hi ${shopName} team,

Thank you for installing See Before Buy AI! Your account has been created successfully.

Next Steps:
1. Add the "Try the Look" button to your product pages
2. Test the virtual try-on feature
3. Monitor your usage in the dashboard

Your Free Plan Includes:
- 50 AI-generated images per month
- Unlimited product pages
- Basic analytics
- Email support

Need help? Contact us at contact@seebeforebuy.com

Best regards,
The See Before Buy AI Team 
    `; 

    // Prepare email parameters
    const params = {
      Source: fromEmail,
      Destination: {
        ToAddresses: [toEmail],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8',
          },
          Text: {
            Data: textBody,
            Charset: 'UTF-8',
          },
        },
      },
    };

    // Send email via AWS SES
    console.log('📤 Sending email via AWS SES...');
    const command = new SendEmailCommand(params);
    const response = await sesClient.send(command);

    console.log('✅ Email sent successfully!');
    console.log('   Message ID:', response.MessageId);

    return true;

  } catch (error) {
    console.error('❌ Error sending email:', error);
    console.error('   Error code:', error.name);
    console.error('   Error message:', error.message);

    // Don't throw error - just log it
    // We don't want email failure to break account creation
    return false;
  }
}

module.exports = {
  sesClient,
  sendWelcomeEmail,
};

console.log('✅ SES Client configured');
console.log('📧 From email:', process.env.SES_FROM_EMAIL || 'noreply@seebeforebuy.com');
