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
function moneyFromCents(cents) {
  const n = Number(cents || 0);
  return Math.round(n) / 100;
}

// =====================================================
// 钱包充值入账（幂等 + 更宽容）
// meta 可能来自：
//  - checkout.session.completed 的 sess.metadata
//  - payment_intent.succeeded 的 pi.metadata
// =====================================================
async function applyWalletRechargeFromMeta(meta, extra = {}) {
  if (!meta) return { ok: false, reason: "no_meta" };

  const rechargeId = String(meta.rechargeId || "").trim();

  // ✅ 允许 meta.type 缺失：只要有 rechargeId 且能在 DB 找到 stripe pending 记录，也能入账
  const type = String(meta.type || "").trim();

  if (!rechargeId || !mongoose.Types.ObjectId.isValid(rechargeId)) {
    return { ok: false, reason: "bad_rechargeId", rechargeId };
  }

  const rec = await Recharge.findById(rechargeId);
  if (!rec) return { ok: false, reason: "recharge_not_found", rechargeId };

  // 如果 meta.type 有且不是 wallet_recharge，则不处理
  // ✅ 但如果 meta.type 缺失，我们允许继续；并且要求这条 recharge 是 stripe/zelle 之一（你主要用 stripe）
  if (type && type !== "wallet_recharge") {
    return { ok: false, reason: "not_wallet_recharge", type };
  }

  // ✅ 额外保护：只允许处理 Stripe 充值（避免误把订单 paymentIntent 的 metadata.orderId 带了 rechargeId 就加钱）
  // 你的 Recharge 创建时 payMethod="stripe" 或 "zelle"
  const payMethod = String(rec.payMethod || "").toLowerCase();
  if (payMethod && payMethod !== "stripe") {
    return { ok: false, reason: "not_stripe_recharge", payMethod };
  }

  // amount 优先：meta.amount -> extra.amount -> DB rec.amount（兜底）
  const amount =
    Number(meta.amount || 0) ||
    Number(extra.amount || 0) ||
    Number(rec.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "bad_amount", amount };
  }

  // ✅ 幂等：已 done 直接返回
  if (String(rec.status || "") === "done") {
    return { ok: true, already: true, rechargeId, amount };
  }

  // 1️⃣ 先把 Recharge 标记 done（并发安全：只有这一步成功才加钱）
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

  // 没改动：说明被别的 webhook/worker 处理过，不再加钱
  if (!r.modifiedCount) {
    return { ok: true, already: true, rechargeId, amount, note: "already_done_by_other_worker" };
  }

  // 2️⃣ 钱包加钱（唯一真实余额来源）
  const wallet = await Wallet.findOneAndUpdate(
    { userId: rec.userId },
    { $inc: { balance: amount, totalRecharge: amount } },
    { new: true, upsert: true }
  ).lean();

  return { ok: true, rechargeId, amount, walletBalance: Number(wallet?.balance || 0) };
}
// ✅ ping：用来确认 /api/stripe 是否真的挂上了
router.get("/ping", (req, res) => {
  res.json({
    ok: true,
    name: "stripe_webhook",
    ts: new Date().toISOString(),
    file: "backend/src/routes/stripe_webhook.js",
  });
});
// =====================================================
// POST /api/stripe/webhook
// =====================================================
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  // ✅ 关键：先确认 Stripe 有没有打到你服务
  console.log("🔔 Stripe webhook HIT", new Date().toISOString());

  const sig = req.headers["stripe-signature"];
  let event;

  // 1️⃣ 验签
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ""
    );
    console.log("✅ Stripe webhook VERIFIED type=", event.type);
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
      const meta = sess?.metadata || {};

      const amount =
        Number(meta.amount || 0) ||
        moneyFromCents(sess?.amount_total);

      const out = await applyWalletRechargeFromMeta(meta, {
        amount,
        remarkAppend: `checkout_session=${sess?.id || ""}`,
      });

      if (out.ok) {
        console.log("✅ Stripe wallet (session.completed)", {
          rechargeId: out.rechargeId,
          amount: out.amount,
          walletBalance: out.walletBalance,
          already: !!out.already,
          note: out.note || "",
        });
        return res.json({ received: true });
      }
    }

    // =================================================
    // B) payment_intent.succeeded（钱包 + 订单兜底）
    // =================================================
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      // B1) 先尝试钱包充值（pi.metadata）
      const out = await applyWalletRechargeFromMeta(pi?.metadata || {}, {
        amount:
          Number(pi?.metadata?.amount || 0) ||
          moneyFromCents(pi?.amount_received),
        remarkAppend: `pi=${pi?.id || ""}`,
      });

      if (out.ok) {
        console.log("✅ Stripe wallet (pi.succeeded)", {
          rechargeId: out.rechargeId,
          amount: out.amount,
          walletBalance: out.walletBalance,
          already: !!out.already,
          note: out.note || "",
        });
        return res.json({ received: true });
      }

      // B2) 不是钱包充值 -> 按订单支付处理
      const orderId = String(pi?.metadata?.orderId || "").trim();
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

        console.log("✅ Stripe order paid", { orderId, pi: pi.id, paid });
      } else {
        // 不处理也可以，但留个日志方便你排查 metadata 是否正确
        console.log("ℹ️ PI succeeded (not wallet, no valid orderId)", {
          pi: pi?.id,
          metaKeys: Object.keys(pi?.metadata || {}),
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
        pi: pi?.id,
        msg: pi?.last_payment_error?.message,
      });
      return res.json({ received: true });
    }

    // 其它事件
    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Stripe webhook 处理异常:", err);
    return res.status(500).send("Webhook handler failed");
  }
});

export default router;
