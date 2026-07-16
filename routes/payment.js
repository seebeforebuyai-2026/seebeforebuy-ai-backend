const { Cashfree } = require("cashfree-pg");
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment =
  process.env.CASHFREE_ENV === "PROD"
    ? Cashfree.Environment.PRODUCTION
    : Cashfree.Environment.SANDBOX;

const request = {
  order_amount: amount,           // e.g. 500
  order_currency: "INR",
  order_id: "SBB_" + Date.now(), // unique order ID
  customer_details: {
    customer_id: shop_domain,     // merchant's store domain
    customer_email: email,
    customer_phone: "9999999999"  // required by Cashfree
  },
  order_meta: {
    return_url: "https://app.seebeforebuy.in/payment/success?order_id={order_id}"
  }
};
// Call Cashfree API → get back payment_session_id
const response = await Cashfree.PGCreateOrder("2023-08-01", request);

// What this does: after payment, Cashfree redirects user to your return_url
// You call this to verify the payment actually succeeded (don't trust the frontend)

const response = await Cashfree.PGFetchOrder("2023-08-01", order_id);
// response.data.order_status === "PAID" means success
// Then update the shop's plan in DynamoDB
