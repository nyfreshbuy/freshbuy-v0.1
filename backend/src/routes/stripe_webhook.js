import express from "express";
import Stripe from "stripe";
import Order from "../models/order.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Webhook 必须 raw body（不能被 express.json() 解析过）
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook 验签失败:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    // ✅ 支付成功
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      const orderId = pi.metadata?.orderId;
      if (!orderId) {
        console.warn("⚠️ payment_intent.succeeded 但 metadata.orderId 缺失, pi=", pi?.id);
        return res.json({ received: true });
      }

      const paid = Number(pi.amount_received || 0) / 100;
      const amountTotal = Number(pi.amount || 0) / 100;

      // ✅ 重点：不要覆盖 payment 整块，只更新需要的字段
      const r = await Order.updateOne(
        { _id: orderId, status: { $in: ["pending"] } }, // 你也可以放宽成不限制 status
        {
          $set: {
            // 订单主状态
            status: "paid",
            paidAt: new Date(),

            // payment 统一状态
            "payment.status": "paid",
            "payment.method": "stripe",
            "payment.amountTotal": amountTotal,
            "payment.paidTotal": paid,

            // stripe 子结构
            "payment.stripe.intentId": pi.id,
            "payment.stripe.paid": paid,
          },
        }
      );

      console.log("✅ Stripe Webhook 更新结果:", r?.modifiedCount, "orderId=", orderId, "pi=", pi.id);
    }

    // （可选）你也可以记录失败事件，方便排查
    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      console.warn("⚠️ payment_failed:", pi?.id, pi?.last_payment_error?.message || "");
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("❌ Webhook 处理异常:", e);
    // Stripe 收到 500 会重试
    return res.status(500).send("Server Error");
  }
});

export default router;
