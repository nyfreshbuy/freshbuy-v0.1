// backend/src/routes/stripe_webhook.js
// ✅ Stripe webhook：
// 1) 订单：payment_intent.succeeded -> Order 标记已支付（你原有逻辑）
// 2) 充值：checkout.session.completed -> User.walletBalance 增加 + 写 Recharge 记录（新增）

import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";

import Order from "../models/order.js";
import User from "../models/user.js";
import Recharge from "../models/Recharge.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// ========= utils =========
function normPhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

/**
 * ✅ Webhook 必须 raw body（不能被 express.json() 解析过）
 * 注意：在主入口 server.js 里，这个路由必须挂在 express.json() 之前
 */
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  // 1) 验签
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Stripe Webhook 验签失败:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    // =====================================================
    // A) ✅ 充值：Checkout Session 支付完成
    // 你在 /api/recharge/stripe/create 里用的是 checkout.sessions.create
    // 所以成功事件是 checkout.session.completed
    // metadata 必须有：userId / rechargeAmount
    // =====================================================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const sessionId = String(session?.id || "");
      const paymentIntentId = String(session?.payment_intent || "");
      const metaUserId = session?.metadata?.userId ? String(session.metadata.userId) : "";
      const metaAmount = session?.metadata?.rechargeAmount ? Number(session.metadata.rechargeAmount) : 0;

      const uid = toObjectIdMaybe(metaUserId);

      // amount 兜底：优先 metadata，其次 session.amount_total
      const amountTotal = Number(session?.amount_total || 0) / 100;
      const amount = metaAmount > 0 ? metaAmount : amountTotal;

      // 基础校验
      if (!uid || !amount || amount <= 0) {
        console.warn("⚠️ recharge webhook missing metadata/amount:", {
          event: event.type,
          sessionId,
          metaUserId,
          metaAmount,
          amountTotal,
        });
        return res.json({ received: true });
      }

      // ✅ 幂等：同一个 session / payment_intent 不能重复入账
      const dedupOr = [];
      if (sessionId) dedupOr.push({ remark: { $regex: `session=${sessionId}` } });
      if (paymentIntentId) dedupOr.push({ remark: { $regex: `pi=${paymentIntentId}` } });

      const existing = dedupOr.length
        ? await Recharge.findOne({ payMethod: "stripe", $or: dedupOr }).lean()
        : null;

      if (existing) {
        return res.json({ received: true, dedup: true });
      }

      // 1) 写充值记录（done）
      await Recharge.create({
        userId: uid,
        amount: amount,
        bonus: "",
        payMethod: "stripe",
        status: "done",
        remark: `session=${sessionId}${paymentIntentId ? " | pi=" + paymentIntentId : ""}`,
      });

      // 2) 加钱包余额
      await User.updateOne({ _id: uid }, { $inc: { walletBalance: amount } });

      console.log("✅ Recharge credited:", {
        userId: String(uid),
        amount,
        sessionId,
        paymentIntentId,
      });
    }

    // =====================================================
    // B) ✅ 订单：PaymentIntent 支付成功（你原有逻辑）
    // =====================================================
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      // ✅ 你创建 intent 时应写 metadata：orderId / userId / customerPhone(或 phone10)
      const orderId = pi.metadata?.orderId ? String(pi.metadata.orderId) : "";
      const intentKey = pi.metadata?.intentKey ? String(pi.metadata.intentKey) : "";

      const metaUserId = pi.metadata?.userId ? String(pi.metadata.userId) : "";
      const metaPhone = pi.metadata?.customerPhone ? String(pi.metadata.customerPhone) : "";

      const uid = toObjectIdMaybe(metaUserId);
      const phone10 = normPhone(metaPhone);

      const paid = Number(pi.amount_received || 0) / 100;
      const amountTotal = Number(pi.amount || 0) / 100;

      // ✅ 统一写入的“已支付”字段
      const paidPatch = {
        status: "paid",
        paidAt: new Date(),

        "payment.status": "paid",
        "payment.method": "stripe",
        "payment.amountTotal": amountTotal,
        "payment.paidTotal": paid,

        "payment.stripePaymentIntentId": pi.id,
        "payment.stripeChargeId": "",

        // 兼容旧字段
        isPaid: true,
        paymentStatus: "paid",
        "payment.intentId": pi.id,
        "payment.intentKey": intentKey || undefined,
      };

      // ✅ Webhook 同时补 userId + customerPhone（用于“我的订单”）
      if (uid) paidPatch.userId = uid;
      if (phone10) paidPatch.customerPhone = phone10;

      // 3) 尝试更新（优先 orderId）
      let r = null;

      if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
        r = await Order.updateOne({ _id: orderId }, { $set: paidPatch });
      } else {
        if (!orderId) {
          console.warn("⚠️ payment_intent.succeeded 但 metadata.orderId 缺失，pi=", pi?.id);
        } else {
          console.warn("⚠️ metadata.orderId 非法（不是 ObjectId），orderId=", orderId, "pi=", pi?.id);
        }
      }

      // 4) 兜底：orderId 缺失或更新不到，用 intentId/intentKey 找订单
      if (!r || !r.modifiedCount) {
        const q = {
          $or: [{ "payment.stripePaymentIntentId": pi.id }, { "payment.intentId": pi.id }],
        };

        if (intentKey) {
          q.$or.push({ "payment.intentKey": intentKey });
          q.$or.push({ intentKey });
        }

        const r2 = await Order.updateOne(q, { $set: paidPatch });
        r = r2;
      }

      console.log("✅ Stripe Webhook 更新订单结果:", {
        event: event.type,
        pi: pi.id,
        orderId: orderId || null,
        intentKey: intentKey || null,
        metaUserId: metaUserId || null,
        metaPhone: metaPhone || null,
        matched: r?.matchedCount ?? null,
        modified: r?.modifiedCount ?? null,
        amountTotal,
        paid,
      });
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      console.warn("⚠️ Stripe payment_failed:", {
        pi: pi?.id,
        msg: pi?.last_payment_error?.message || "",
      });
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("❌ Stripe Webhook 处理异常:", e);
    return res.status(500).send("Server Error");
  }
});

export default router;
