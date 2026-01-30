// backend/src/routes/stripe_webhook.js
// =====================================================
// Stripe Webhook：
// A) 钱包充值（Stripe） -> Recharge: pending → done + Wallet.balance += amount
// B) 订单支付成功        -> Order.status = paid + 重新结算写回明细（含特价/平台费/押金/税/小费）
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

// ✅ FIX: 补充 calcSpecialLineTotal 用于对账打印每行特价小计
import { computeTotalsFromPayload, calcSpecialLineTotal } from "../utils/checkout_pricing.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

// ✅ NY 税率（可用环境变量覆盖）
const NY_TAX_RATE = Number(process.env.NY_TAX_RATE || 0.08875);

// =====================================================
// utils
// =====================================================
function moneyFromCents(cents) {
  const n = Number(cents || 0);
  return Math.round(n) / 100;
}
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
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

  // ✅ 允许 meta.type 缺失
  const type = String(meta.type || "").trim();

  if (!rechargeId || !mongoose.Types.ObjectId.isValid(rechargeId)) {
    return { ok: false, reason: "bad_rechargeId", rechargeId };
  }

  const rec = await Recharge.findById(rechargeId);
  if (!rec) return { ok: false, reason: "recharge_not_found", rechargeId };

  // 如果 meta.type 有且不是 wallet_recharge，则不处理
  if (type && type !== "wallet_recharge") {
    return { ok: false, reason: "not_wallet_recharge", type };
  }

  // ✅ 额外保护：只允许处理 Stripe 充值
  const payMethod = String(rec.payMethod || "").toLowerCase();
  if (payMethod && payMethod !== "stripe") {
    return { ok: false, reason: "not_stripe_recharge", payMethod };
  }

  // amount 优先：meta.amount -> extra.amount -> DB rec.amount
  const amount = Number(meta.amount || 0) || Number(extra.amount || 0) || Number(rec.amount || 0);

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
        remark: String(rec.remark || "") + (extra.remarkAppend ? ` | ${extra.remarkAppend}` : ""),
      },
    }
  );

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

// ✅ ping：确认路由挂载
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
  console.log("🔔 Stripe webhook HIT", new Date().toISOString());

  const sig = req.headers["stripe-signature"];
  let event;

  // 1️⃣ 验签
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
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

      const amount = Number(meta.amount || 0) || moneyFromCents(sess?.amount_total);

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

      return res.json({ received: true });
    }

    // =================================================
    // B) payment_intent.succeeded（钱包 + 订单兜底）
    // =================================================
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      // B1) 先尝试钱包充值（pi.metadata）
      const out = await applyWalletRechargeFromMeta(pi?.metadata || {}, {
        amount: Number(pi?.metadata?.amount || 0) || moneyFromCents(pi?.amount_received),
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

      // B2) 不是钱包充值 -> 按订单支付处理（✅重算明细 + 混合支付累计 + 幂等）
      const orderId = String(pi?.metadata?.orderId || "").trim();
      if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
        const stripePaid = moneyFromCents(pi.amount_received);

        const order = await Order.findById(orderId).lean();
        if (!order) {
          console.log("ℹ️ PI succeeded but order not found", { orderId, pi: pi?.id });
          return res.json({ received: true });
        }

        // ✅ 幂等：同一个 PI 重复通知直接吞掉
        const alreadyPI =
          String(order?.payment?.stripePaymentIntentId || "") === String(pi?.id || "") ||
          String(order?.payment?.stripe?.intentId || "") === String(pi?.id || "");

        if (alreadyPI && (order?.payment?.status === "paid" || order?.status === "paid")) {
          console.log("ℹ️ Stripe webhook duplicate (already paid)", { orderId, pi: pi?.id });
          return res.json({ received: true });
        }

        // ✅ 关键：order.address 没有 state 时，税率会变 0，所以这里必须用订单保存的 salesTaxRate 覆盖
        const ship = order?.address || order?.shipping || {};
        const taxRateFromOrder = Number(order?.salesTaxRate || order?.payment?.amountTaxRate || 0);

        // ✅ 用“订单落库 items”重算（items 应该已包含 specialQty/specialTotalPrice）
        const totalsStripe = computeTotalsFromPayload(
          {
            items: Array.isArray(order?.items) ? order.items : [],
            shipping: ship,
            mode: order?.deliveryMode,
            pricing: {
              tip: Number(order?.tipFee || 0),
              taxRate: Number.isFinite(taxRateFromOrder) ? taxRateFromOrder : 0, // ✅ FIX
            },
          },
          { payChannel: "stripe", taxRateNY: NY_TAX_RATE, platformRate: 0.02, platformFixed: 0.5 }
        );

        // ✅ 对账日志：你在 Render 里搜 “🧾 totals check” 就能看到特价行小计
        console.log("🧾 totals check:", {
          orderId,
          pi: pi?.id,
          totalAmount: totalsStripe.totalAmount,
          depositTotal: totalsStripe.depositTotal,
          salesTax: totalsStripe.salesTax,
          shipping: totalsStripe.shipping,
          subtotal: totalsStripe.subtotal,
          taxRate: totalsStripe.taxRate,
          items: (order.items || []).map((it) => ({
            name: it.name,
            qty: it.qty,
            price: it.price,
            specialQty: it.specialQty,
            specialTotalPrice: it.specialTotalPrice,
            line: calcSpecialLineTotal(it, it.qty),
          })),
        });

        // ✅ 混合支付累计：walletPaid + stripePaid(累计)
        const walletPaid = Number(order?.payment?.wallet?.paid || 0);
        const prevStripePaid = Number(order?.payment?.stripe?.paid || 0);
        const newStripePaid = round2(prevStripePaid + stripePaid);
        const paidTotal = round2(walletPaid + newStripePaid);

        await Order.updateOne(
          { _id: orderId },
          {
            $set: {
              // 状态
              status: "paid",
              isPaid: true,
              paidAt: new Date(),

              // ✅ 写回明细（保证对账一致）
              subtotal: totalsStripe.subtotal,
              deliveryFee: totalsStripe.shipping,
              taxableSubtotal: totalsStripe.taxableSubtotal,
              salesTax: totalsStripe.salesTax,
              depositTotal: totalsStripe.depositTotal,
              platformFee: totalsStripe.platformFee,
              tipFee: totalsStripe.tipFee,
              totalAmount: totalsStripe.totalAmount,
              salesTaxRate: totalsStripe.taxRate,

              // ✅ payment 快照
              "payment.status": "paid",
              "payment.method": "stripe",
              "payment.paidTotal": paidTotal,
              "payment.amountSubtotal": totalsStripe.subtotal,
              "payment.amountDeliveryFee": totalsStripe.shipping,
              "payment.amountTax": totalsStripe.salesTax,
              "payment.amountDeposit": totalsStripe.depositTotal,
              "payment.amountPlatformFee": totalsStripe.platformFee,
              "payment.amountTip": totalsStripe.tipFee,
              "payment.amountTotal": totalsStripe.totalAmount,

              // Stripe 字段
              "payment.stripePaymentIntentId": pi.id,
              "payment.stripe.intentId": pi.id,
              "payment.stripe.paid": newStripePaid,
            },
          }
        );

        console.log("✅ Stripe order paid (recalc+merge)", {
          orderId,
          pi: pi.id,
          stripePaid,
          walletPaid,
          paidTotal,
          totalAmount: totalsStripe.totalAmount,
          subtotal: totalsStripe.subtotal,
        });

        return res.json({ received: true });
      }

      console.log("ℹ️ PI succeeded (not wallet, no valid orderId)", {
        pi: pi?.id,
        metaKeys: Object.keys(pi?.metadata || {}),
      });
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
