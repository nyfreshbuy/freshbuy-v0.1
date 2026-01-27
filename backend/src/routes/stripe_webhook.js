// backend/src/routes/stripe_webhook.js
// ✅ Stripe webhook：
// 1) 订单支付成功 -> 更新 Order 为 paid（你原来的逻辑保留+增强）
// 2) 钱包充值成功 -> Recharge: pending->done + Wallet.balance += amount（幂等防重复）
//
// ⚠️ 注意：这个路由必须挂在 express.json() 之前（因为 webhook 需要 raw body）

import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";

import Order from "../models/order.js";
import Recharge from "../models/Recharge.js";
import Wallet from "../models/Wallet.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
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

function moneyFromCents(cents) {
  const n = Number(cents || 0);
  return Math.round(n) / 100;
}

async function applyWalletRechargeFromMeta(meta, extra = {}) {
  // meta: { type, rechargeId, amount, userId }
  if (!meta) return { ok: false, reason: "no_meta" };

  const type = String(meta.type || "").trim();
  if (type !== "wallet_recharge") return { ok: false, reason: "not_wallet_recharge" };

  const rechargeId = String(meta.rechargeId || "").trim();
  if (!rechargeId || !mongoose.Types.ObjectId.isValid(rechargeId)) {
    return { ok: false, reason: "bad_rechargeId", rechargeId };
  }

  // amount 优先来自 meta.amount，其次用 extra.amount
  const amount =
    Number(meta.amount || 0) ||
    Number(extra.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "bad_amount", amount };
  }

  const rec = await Recharge.findById(rechargeId).lean();
  if (!rec) return { ok: false, reason: "recharge_not_found", rechargeId };

  // ✅ 幂等：如果已 done，直接不再入账
  if (String(rec.status || "") === "done") {
    return { ok: true, already: true, rechargeId, amount };
  }

  // ✅ 将 Recharge 标记为 done（带条件，防并发重复）
  const r1 = await Recharge.updateOne(
    { _id: rec._id, status: { $ne: "done" } },
    {
      $set: {
        status: "done",
        paidAt: new Date(),
        // 把 extra 信息写进 remark 方便追溯
        remark: String(rec.remark || "") + (extra.remarkAppend ? ` | ${extra.remarkAppend}` : ""),
      },
    }
  );

  // 如果并发下别人先改 done 了，这里 matched/modified 可能为 0，此时不要再加钱
  if (!r1.modifiedCount) {
    return { ok: true, already: true, rechargeId, amount, note: "status_already_done_by_other_worker" };
  }

  // ✅ 钱包加钱（Wallet 是你余额来源）
  const w = await Wallet.findOneAndUpdate(
    { userId: rec.userId },
    { $inc: { balance: amount, totalRecharge: amount } },
    { new: true, upsert: true }
  ).lean();

  return { ok: true, rechargeId, amount, walletBalance: Number(w?.balance || 0) };
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
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ""
    );
  } catch (err) {
    console.error("❌ Stripe Webhook 验签失败:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    // =====================================================
    // A) 钱包充值（推荐优先处理 checkout.session.completed）
    // =====================================================
    if (event.type === "checkout.session.completed") {
      const sess = event.data.object;

      // sess.metadata 来自你 wallet_recharge.js 的 metadata
      const meta = sess?.metadata || {};
      const amount =
        Number(meta.amount || 0) ||
        moneyFromCents(sess?.amount_total); // 兜底

      const out = await applyWalletRechargeFromMeta(meta, {
        amount,
        remarkAppend: `stripe_session=${sess?.id || ""}`,
      });

      if (out.ok && (out.already || out.walletBalance !== undefined)) {
        console.log("✅ Stripe webhook wallet (session.completed):", {
          event: event.type,
          session: sess?.id,
          rechargeId: out.rechargeId,
          amount: out.amount,
          walletBalance: out.walletBalance,
          already: !!out.already,
        });
        return res.json({ received: true });
      }
      // 如果不是钱包充值，继续往下走订单逻辑
    }

    // =====================================================
    // B) payment_intent.succeeded（钱包充值 & 订单支付都可能走这里）
    // =====================================================
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      // -----------------------------
      // B1) 先尝试钱包充值（读取 PaymentIntent metadata）
      // 你需要在 wallet_recharge.js 里写 payment_intent_data.metadata
      // -----------------------------
      const out = await applyWalletRechargeFromMeta(pi?.metadata || {}, {
        amount: Number(pi?.metadata?.amount || 0) || moneyFromCents(pi?.amount_received),
        remarkAppend: `pi=${pi?.id || ""}`,
      });

      if (out.ok) {
        console.log("✅ Stripe webhook wallet (pi.succeeded):", {
          event: event.type,
          pi: pi?.id,
          rechargeId: out.rechargeId,
          amount: out.amount,
          walletBalance: out.walletBalance,
          already: !!out.already,
        });
        return res.json({ received: true });
      }

      // -----------------------------
      // B2) 不是钱包充值 -> 按“订单支付成功”处理（保留你原逻辑）
      // -----------------------------
      const orderId = pi.metadata?.orderId ? String(pi.metadata.orderId) : "";
      const intentKey = pi.metadata?.intentKey ? String(pi.metadata.intentKey) : "";

      const metaUserId = pi.metadata?.userId ? String(pi.metadata.userId) : "";
      const metaPhone = pi.metadata?.customerPhone ? String(pi.metadata.customerPhone) : "";

      const uid = toObjectIdMaybe(metaUserId);
      const phone10 = normPhone(metaPhone);

      const paid = moneyFromCents(pi.amount_received);
      const amountTotal = moneyFromCents(pi.amount);

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

      if (uid) paidPatch.userId = uid;
      if (phone10) paidPatch.customerPhone = phone10;

      let r = null;

      // 优先按 orderId 更新
      if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
        r = await Order.updateOne(
          { _id: orderId },
          { $set: paidPatch }
        );
      } else {
        if (!orderId) {
          console.warn("⚠️ payment_intent.succeeded 但 metadata.orderId 缺失，pi=", pi?.id);
        } else {
          console.warn("⚠️ metadata.orderId 非法（不是 ObjectId），orderId=", orderId, "pi=", pi?.id);
        }
      }

      // 兜底：按 PI / intentKey 找订单
      if (!r || !r.modifiedCount) {
        const q = {
          $or: [
            { "payment.stripePaymentIntentId": pi.id },
            { "payment.intentId": pi.id },
          ],
        };
        if (intentKey) {
          q.$or.push({ "payment.intentKey": intentKey });
          q.$or.push({ intentKey });
        }

        const r2 = await Order.updateOne(q, { $set: paidPatch });
        r = r2;
      }

      console.log("✅ Stripe webhook order paid:", {
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

      return res.json({ received: true });
    }

    // =====================================================
    // C) payment_intent.payment_failed
    // =====================================================
    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      console.warn("⚠️ Stripe payment_failed:", {
        pi: pi?.id,
        msg: pi?.last_payment_error?.message || "",
      });
      return res.json({ received: true });
    }

    // 其它事件不处理也要 200
    return res.json({ received: true });
  } catch (e) {
    console.error("❌ Stripe Webhook 处理异常:", e);
    return res.status(500).send("Server Error");
  }
});

export default router;
