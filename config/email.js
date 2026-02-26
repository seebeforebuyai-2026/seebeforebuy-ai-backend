/**
 * ============================================
 * Email Configuration (Nodemailer)
 * ============================================
 * 
 * Simple email sending using Nodemailer with Gmail SMTP
 */

const nodemailer = require('nodemailer');

// Create transporter with Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASSWORD, // Your Gmail App Password
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

    const fromEmail = process.env.EMAIL_USER || 'noreply@seebeforebuy.com';

    // Email options
    const mailOptions = {
      from: `"See Before Buy AI" <${fromEmail}>`,
      to: toEmail,
      subject: '🎉 Welcome to See Before Buy AI!',
      html: `
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
      <p><strong>Login URL:</strong> <a href="https://seebeforebuy.com/login">https://seebeforebuy.com/login</a></p>
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
      <li>✅ 15 AI-generated images per month</li>
      <li>✅ Unlimited product pages</li>
      <li>✅ Basic analytics</li>
      <li>✅ Email support</li>
    </ul>
    
    <p>Need more images? Upgrade anytime from your dashboard!</p>
    
    <a href="https://seebeforebuy.com/login" class="button">Login to Dashboard</a>
    
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
      `,
      text: `
Welcome to See Before Buy AI!

Hi ${shopName} team,

Thank you for installing See Before Buy AI! Your account has been created successfully.

Your Login Credentials:
Email: ${toEmail}
Temporary Password: ${temporaryPassword}
Login URL: https://seebeforebuy.com/login

⚠️ Please change your password after first login for security.

Next Steps:
1. Add the "Try the Look" button to your product pages
2. Test the virtual try-on feature
3. Monitor your usage in the dashboard

Your Free Plan Includes:
- 15 AI-generated images per month
- Unlimited product pages
- Basic analytics
- Email support

Need help? Contact us at support@seebeforebuy.com

Best regards,
The See Before Buy AI Team
      `,
    };

    // Send email
    console.log('📤 Sending email via Nodemailer (Gmail)...');
    const info = await transporter.sendMail(mailOptions);

    console.log('✅ Email sent successfully!');
    console.log('   Message ID:', info.messageId);

    return true;

  } catch (error) {
    console.error('❌ Error sending email:', error);
    console.error('   Error message:', error.message);

    // Don't throw error - just log it
    return false;
  }
}

module.exports = {
  transporter,
  sendWelcomeEmail,
};

console.log('✅ Nodemailer configured with Gmail SMTP');
console.log('📧 From email:', process.env.EMAIL_USER || 'Not configured');
