// backend/src/routes/stripe_webhook.js  （文件名你按你项目实际即可）
// ✅ Stripe webhook：支付成功后把订单标记为已支付（强兜底版本）

import express from "express";
import Stripe from "stripe";
import Order from "../models/order.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// ✅ Webhook 必须 raw body（不能被 express.json() 解析过）
// 注意：在主入口 app.js/index.js 里，这个路由必须挂在 express.json() 之前
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  // 1) 验签
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe Webhook 验签失败:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    // 2) 支付成功
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      // 你在创建 intent 时，最好写 metadata.orderId + metadata.intentKey
      const orderId = pi.metadata?.orderId ? String(pi.metadata.orderId) : "";
      const intentKey = pi.metadata?.intentKey ? String(pi.metadata.intentKey) : "";

      const paid = Number(pi.amount_received || 0) / 100;
      const amountTotal = Number(pi.amount || 0) / 100;

      // ✅ 统一要写入的“已支付”字段（兼容你后台可能读取的不同字段）
      const paidPatch = {
        // 常见主状态
        status: "paid",
        paidAt: new Date(),

        // 常见支付块
        "payment.status": "paid",
        "payment.method": "stripe",
        "payment.amountTotal": amountTotal,
        "payment.paidTotal": paid,

        // stripe 子结构
        "payment.stripe.intentId": pi.id,
        "payment.stripe.paid": paid,

        // ✅ 兼容一些旧字段/后台字段（你后台如果看这些，就不会再显示未支付）
        isPaid: true,
        paymentStatus: "paid",
        "payment.intentId": pi.id, // 有些老结构会用这个
        "payment.intentKey": intentKey || undefined,
      };

      // 3) 尝试更新（优先 orderId）
      let r = null;

      if (orderId) {
        r = await Order.updateOne(
          { _id: orderId },
          { $set: paidPatch }
        );
      } else {
        console.warn("⚠️ payment_intent.succeeded 但 metadata.orderId 缺失，pi=", pi?.id);
      }

      // 4) 兜底：orderId 缺失或更新不到（modifiedCount=0），用 intentId/intentKey 找订单
      if (!r || !r.modifiedCount) {
        const q = {
          $or: [
            { "payment.stripe.intentId": pi.id },
            { "payment.intentId": pi.id },
          ],
        };

        if (intentKey) {
          q.$or.push({ "payment.intentKey": intentKey });
          q.$or.push({ intentKey }); // 如果你把 intentKey 存在订单根字段
        }

        const r2 = await Order.updateOne(q, { $set: paidPatch });
        r = r2;
      }

      console.log("✅ Stripe Webhook 更新结果:", {
        event: event.type,
        pi: pi.id,
        orderId: orderId || null,
        intentKey: intentKey || null,
        matched: r?.matchedCount ?? null,
        modified: r?.modifiedCount ?? null,
        amountTotal,
        paid,
      });
    }

    // （可选）支付失败事件日志
    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      console.warn("⚠️ Stripe payment_failed:", {
        pi: pi?.id,
        msg: pi?.last_payment_error?.message || "",
      });
    }

    // Stripe 收到 2xx 才算成功
    return res.json({ received: true });
  } catch (e) {
    console.error("❌ Stripe Webhook 处理异常:", e);
    // Stripe 收到 500 会重试
    return res.status(500).send("Server Error");
  }
});

export default router;
