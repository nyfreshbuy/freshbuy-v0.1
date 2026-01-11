import express from "express";
import Stripe from "stripe";
import Order from "../models/order.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook 验签失败", err.message);
      return res.status(400).send(`Webhook Error`);
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const orderId = pi.metadata?.orderId;

      if (!orderId) {
        console.warn("⚠️ PaymentIntent 无 orderId");
        return res.json({ received: true });
      }

      await Order.updateOne(
        { _id: orderId, status: "pending" },
        {
          $set: {
            status: "paid",
            paidAt: new Date(),
            payment: {
              method: "stripe",
              intentId: pi.id,
              amount: pi.amount_received / 100,
            },
          },
        }
      );

      console.log("✅ 订单已支付:", orderId);
    }

    res.json({ received: true });
  }
);

export default router;
