// backend/src/routes/stripe_webhook.js
// =====================================================
// Stripe Webhook：
// A) 钱包充值（Stripe） -> Recharge: pending → done + Wallet.balance += amount
// B) 订单支付成功        -> Order.status = paid
// =====================================================
// ⚠️ 必须使用 RAW BODY（不能被 express.json() 解析）
// ⚠️ 必须挂在 express.json() 之前
// =====================================================

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

// =====================================================
// utils
// =====================================================
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

function moneyFromCents(cents) {
  const n = Number(cents || 0);
  return Math.round(n) / 100;
}

// =====================================================
// 钱包充值入账（幂等）
// =====================================================
async function applyWalletRechargeFromMeta(meta, extra = {}) {
  if (!meta) return { ok: false, reason: "no_meta" };

  if (String(meta.type) !== "wallet_recharge") {
    return { ok: false, reason: "not_wallet_recharge" };
  }

  const rechargeId = String(meta.rechargeId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(rechargeId)) {
    return { ok: false, reason: "bad_rechargeId", rechargeId };
  }

  const amount =
    Number(meta.amount || 0) ||
    Number(extra.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "bad_amount", amount };
  }

  const rec = await Recharge.findById(rechargeId);
  if (!rec) {
    return { ok: false, reason: "recharge_not_found", rechargeId };
  }

  // ✅ 幂等：已 done 直接返回
  if (rec.status === "done") {
    return {
      ok: true,
      already: true,
      rechargeId,
      amount,
    };
  }

  // 1️⃣ 标记 Recharge = done（并发安全）
  const r = await Recharge.updateOne(
    { _id: rec._id, status: { $ne: "done" } },
    {
      $set: {
        status: "done",
        paidAt: new Date(),
        remark:
          String(rec.remark || "") +
          (extra.remarkAppend ? ` | ${extra.remarkAppend}` : ""),
      },
    }
  );

  // 如果没改动，说明被别的 webhook 处理过
  if (!r.modifiedCount) {
    return {
      ok: true,
      already: true,
      rechargeId,
      amount,
    };
  }

  // 2️⃣ 钱包加钱（唯一真实余额来源）
  const wallet = await Wallet.findOneAndUpdate(
    { userId: rec.userId },
    { $inc: { balance: amount, totalRecharge: amount } },
    { new: true, upsert: true }
  ).lean();

  return {
    ok: true,
    rechargeId,
    amount,
    walletBalance: Number(wallet?.balance || 0),
  };
}

// =====================================================
// POST /api/stripe/webhook
// =====================================================
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    // 1️⃣ 验签
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );
    } catch (err) {
      console.error("❌ Stripe webhook 验签失败:", err.message);
      return res.status(400).send("Webhook signature verification failed");
    }

    try {
      // =================================================
      // A) checkout.session.completed（钱包充值首选）
      // =================================================
      if (event.type === "checkout.session.completed") {
        const sess = event.data.object;
        const meta = sess.metadata || {};

        const amount =
          Number(meta.amount || 0) ||
          moneyFromCents(sess.amount_total);

        const out = await applyWalletRechargeFromMeta(meta, {
          amount,
          remarkAppend: `checkout_session=${sess.id}`,
        });

        if (out.ok) {
          console.log("✅ Stripe wallet (session.completed)", {
            rechargeId: out.rechargeId,
            amount: out.amount,
            walletBalance: out.walletBalance,
            already: !!out.already,
          });
          return res.json({ received: true });
        }
      }

      // =================================================
      // B) payment_intent.succeeded（钱包 + 订单兜底）
      // =================================================
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;

        // B1) 先尝试钱包充值
        const out = await applyWalletRechargeFromMeta(pi.metadata || {}, {
          amount:
            Number(pi.metadata?.amount || 0) ||
            moneyFromCents(pi.amount_received),
          remarkAppend: `pi=${pi.id}`,
        });

        if (out.ok) {
          console.log("✅ Stripe wallet (pi.succeeded)", {
            rechargeId: out.rechargeId,
            amount: out.amount,
            walletBalance: out.walletBalance,
            already: !!out.already,
          });
          return res.json({ received: true });
        }

        // B2) 再按订单支付处理
        const orderId = pi.metadata?.orderId;
        if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
          const paid = moneyFromCents(pi.amount_received);

          await Order.updateOne(
            { _id: orderId },
            {
              $set: {
                status: "paid",
                isPaid: true,
                paidAt: new Date(),
                "payment.status": "paid",
                "payment.method": "stripe",
                "payment.paidTotal": paid,
                "payment.stripePaymentIntentId": pi.id,
              },
            }
          );

          console.log("✅ Stripe order paid", {
            orderId,
            pi: pi.id,
            paid,
          });
        }

        return res.json({ received: true });
      }

      // =================================================
      // C) payment_intent.payment_failed
      // =================================================
      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object;
        console.warn("⚠️ Stripe payment failed:", {
          pi: pi.id,
          msg: pi.last_payment_error?.message,
        });
        return res.json({ received: true });
      }

      // 其它事件
      return res.json({ received: true });
    } catch (err) {
      console.error("❌ Stripe webhook 处理异常:", err);
      return res.status(500).send("Webhook handler failed");
    }
  }
);

export default router;
