// backend/src/routes/pay_stripe.js
import express from "express";
import Stripe from "stripe";

import Order from "../models/order.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!STRIPE_SECRET_KEY) console.warn("⚠️ STRIPE_SECRET_KEY 未设置，Stripe 接口将不可用");

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

// ---------- 工具 ----------
function moneyToCents(n) {
  const v = Number(n || 0);
  return Math.round(v * 100);
}
function centsToMoney(c) {
  return Number((Number(c || 0) / 100).toFixed(2));
}
function genOrderNo() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const ts =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  return "FB" + ts + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}
function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}
function isTruthy(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function isDealLike(it) {
  if (!it) return false;
  if (it.isDeal === true || it.isSpecial === true || it.isHot === true) return true;
  if (String(it.tag || "").includes("爆品")) return true;
  if (String(it.type || "").toLowerCase() === "hot") return true;
  return false;
}

// ---------- 金额重算（服务端权威） ----------
function computeTotalsFromPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];

  let subtotal = 0;
  let totalQty = 0;

  for (const it of items) {
    const qty = safeNum(it.qty, 1);
    const price = safeNum(it.price, 0);
    totalQty += qty;
    subtotal += price * qty;
  }
  subtotal = round2(subtotal);

  // shipping：跟你原先一致
  const mode = String(payload?.mode || "normal").trim();
  let shipping = 0;
  if (mode === "dealsDay") shipping = 0;
  else if (mode === "groupDay") shipping = subtotal >= 49.99 ? 0 : 4.99;
  else if (mode === "friendGroup") shipping = 4.99;
  else shipping = 4.99;
  shipping = round2(shipping);

  // taxableAmount：优先按 items taxable/hasTax 来算
  let taxableAmount = 0;
  for (const it of items) {
    const qty = safeNum(it.qty, 1);
    const price = safeNum(it.price, 0);
    const taxable = isTruthy(it.taxable) || isTruthy(it.hasTax);
    if (taxable) taxableAmount += price * qty;
  }
  taxableAmount = round2(taxableAmount);

  const taxRate = safeNum(payload?.pricing?.taxRate, 0);
  const tax = round2(taxableAmount * taxRate);

  // Stripe 订单一定收（2%）
  const serviceRate = safeNum(payload?.pricing?.serviceRate, 0.02);
  const serviceFee = round2(subtotal * serviceRate);

  const tip = Math.max(0, round2(safeNum(payload?.pricing?.tip, 0)));

  const total = round2(subtotal + shipping + tax + serviceFee + tip);

  return {
    totalQty,
    subtotal,
    shipping,
    taxableAmount,
    taxRate: round2(taxRate),
    tax,
    serviceRate: round2(serviceRate),
    serviceFee,
    tip,
    total,
  };
}

// ---------- 0) 健康检查（可选） ----------
router.get("/ping", (req, res) => {
  res.json({
    ok: true,
    stripeReady: !!stripe,
    hasSecret: !!STRIPE_SECRET_KEY,
    hasPublishable: !!STRIPE_PUBLISHABLE_KEY,
    hasWebhookSecret: !!STRIPE_WEBHOOK_SECRET,
  });
});

// ---------- 1) 给前端取 publishable key ----------
router.get("/publishable-key", (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ success: false, message: "STRIPE_PUBLISHABLE_KEY 未配置" });
  }
  return res.json({ success: true, key: STRIPE_PUBLISHABLE_KEY });
});

// ---------- 2) 幂等：创建/复用订单 + PaymentIntent ----------
// 前端 POST /api/pay/stripe/order-intent
router.post("/order-intent", requireLogin, express.json(), async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe 未初始化（缺少 STRIPE_SECRET_KEY）" });

    const user = req.user;
    const payload = req.body || {};

    const intentKey = String(payload.intentKey || "").trim();
    if (!intentKey) return res.status(400).json({ success: false, message: "缺少 intentKey（前端幂等键）" });

    const s = payload.shipping || {};
    if (!s.firstName || !s.lastName || !s.phone || !s.street1 || !s.city || !s.state || !s.zip) {
      return res.status(400).json({ success: false, message: "收货信息不完整" });
    }
    if (typeof s.lat !== "number" || typeof s.lng !== "number") {
      return res.status(400).json({ success: false, message: "缺少坐标（请从 Places 下拉选择地址）" });
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    const hasDeal = items.some((it) => isDealLike(it));
    const hasNonDeal = items.some((it) => !isDealLike(it));
    if (payload.mode === "dealsDay" && hasNonDeal) {
      return res.status(400).json({ success: false, message: "爆品日订单只能包含爆品商品" });
    }

    const totals = computeTotalsFromPayload(payload);
    if (!totals.total || totals.total <= 0) return res.status(400).json({ success: false, message: "金额异常" });

    // 你前端规则：最低消费
    if ((payload.mode === "groupDay" || payload.mode === "normal") && totals.subtotal < 49.99) {
      return res.status(400).json({ success: false, message: "未满足最低消费 $49.99，无法下单" });
    }
    if (payload.mode === "friendGroup" && totals.subtotal < 29) {
      return res.status(400).json({ success: false, message: "未满足好友拼单最低消费 $29，无法下单" });
    }

    const deliveryType = String(payload.deliveryType || "").trim();
    const deliveryDate = String(payload.deliveryDate || "").trim();
    const zoneKey = String(payload.zoneKey || "").trim();

    if (!deliveryType || !deliveryDate) {
      return res.status(400).json({ success: false, message: "缺少 deliveryType / deliveryDate" });
    }

    // ---------- 2.1) 找是否已有同 intentKey 的未支付订单（幂等） ----------
    let doc = await Order.findOne({
      userId: user._id,
      "payment.method": "stripe",
      "payment.intentKey": intentKey,
      "payment.status": { $in: ["unpaid", "requires_payment_method", "pending", "created"] },
    }).catch(() => null);

    if (doc?.payment?.stripePaymentIntentId && doc?.payment?.stripeClientSecret) {
      return res.json({
        success: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        clientSecret: doc.payment.stripeClientSecret,
        paymentIntentId: doc.payment.stripePaymentIntentId,
        reused: true,
      });
    }

    // ---------- 2.2) 不存在则创建订单 ----------
    if (!doc) {
      const orderNo = genOrderNo();

      doc = await Order.create({
        orderNo,

        userId: user._id,
        customerName: [s.firstName, s.lastName].filter(Boolean).join(" ").trim(),
        customerPhone: s.phone,

        mode: payload.mode,
        deliveryType,
        deliveryDate,
        zoneKey,
        groupDay: payload.groupDay === true || deliveryType === "groupDay",

        // ✅ 统一：履约状态 pending，支付状态 unpaid（后台经常看这些）
        status: "pending",
        paidAt: null,

        // ✅ 兼容一些后台字段
        isPaid: false,
        paymentStatus: "unpaid",
        payStatus: "unpaid",

        orderType:
          payload.mode === "groupDay"
            ? "area_group"
            : payload.mode === "dealsDay"
            ? "area_group"
            : payload.mode === "friendGroup"
            ? "friend"
            : "normal",

        subtotal: totals.subtotal,
        deliveryFee: totals.shipping,
        discount: 0,
        totalAmount: totals.total,

        payment: {
          status: "unpaid",
          method: "stripe",
          currency: "USD",

          // ✅ 幂等键保存下来
          intentKey,

          // ✅ 兼容：有些后台读 payment.paid
          paid: false,

          amountSubtotal: totals.subtotal,
          amountDeliveryFee: totals.shipping,
          amountDiscount: 0,
          amountTax: totals.tax,
          amountServiceFee: totals.serviceFee,
          amountTip: totals.tip,
          amountTotal: totals.total,

          taxRate: totals.taxRate,
          serviceRate: totals.serviceRate,
          taxableAmount: totals.taxableAmount,
        },

        addressText: s.fullText || "",
        note: s.note || "",

        address: {
          fullText: s.fullText || "",
          zip: s.zip || "",
          zoneId: payload.zoneId || "",
          lat: s.lat,
          lng: s.lng,
        },

        items: items.map((it) => ({
          productId: it.productId || undefined,
          legacyProductId: "",
          name: it.name || "",
          sku: it.sku || "",
          price: safeNum(it.price, 0),
          qty: safeNum(it.qty, 1),
          image: it.image || "",
          lineTotal: round2(safeNum(it.price, 0) * safeNum(it.qty, 1)),
          cost: safeNum(it.cost, 0),
          isSpecial: !!isDealLike(it),
          taxable: isTruthy(it.taxable) || isTruthy(it.hasTax),
        })),
      });
    }

    // ---------- 2.3) 创建 PaymentIntent（同 intentKey 幂等） ----------
    const intent = await stripe.paymentIntents.create(
      {
        amount: moneyToCents(totals.total),
        currency: "usd",
        automatic_payment_methods: { enabled: true },

        // ✅ 关键：webhook 用它来找订单
        metadata: {
          orderId: String(doc._id),
          orderNo: String(doc.orderNo),
          userId: String(user._id),
          intentKey,
        },
      },
      { idempotencyKey: `fb_pi_${intentKey}` }
    );

    // 写回订单（兼容更多字段）
    doc.payment = doc.payment || {};
    doc.payment.stripePaymentIntentId = intent.id;
    doc.payment.stripeClientSecret = intent.client_secret || "";
    doc.payment.status = "pending";
    doc.payment.paid = false;

    // 兼容后台字段
    doc.paymentStatus = "pending";
    doc.payStatus = "pending";

    await doc.save();

    return res.json({
      success: true,
      orderId: String(doc._id),
      orderNo: doc.orderNo,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      reused: false,
    });
  } catch (err) {
    console.error("POST /api/pay/stripe/order-intent error:", err);
    return res.status(500).json({ success: false, message: err?.message || "创建 Stripe 支付失败" });
  }
});

// ---------- 3) Stripe Webhook：更新订单支付状态 ----------
// ⚠️ 重要：这个路由必须拿到 RAW body 才能验签成功
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!stripe) return res.status(500).send("stripe not initialized");
    if (!STRIPE_WEBHOOK_SECRET) {
      console.warn("⚠️ STRIPE_WEBHOOK_SECRET 未设置，webhook 将无法验签");
      return res.status(400).send("webhook secret not configured");
    }

    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error("❌ webhook signature verify failed:", e?.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    // ✅ 关键日志：你看 Render 日志就知道 webhook 进没进来
    console.log("📩 Stripe webhook received:", event.type, "id=", event.id);

    const now = new Date();

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      const orderId = pi.metadata?.orderId;
      const orderNo = pi.metadata?.orderNo;
      const intentKey = pi.metadata?.intentKey;

      const amountPaid = centsToMoney(pi.amount_received || pi.amount || 0);
      const amountTotal = centsToMoney(pi.amount || 0);

      const q =
        orderId
          ? { _id: orderId }
          : orderNo
          ? { orderNo }
          : intentKey
          ? { "payment.intentKey": intentKey }
          : null;

      if (!q) {
        console.warn("⚠️ payment_intent.succeeded 但无法定位订单：metadata 缺失", {
          pi: pi.id,
          orderId,
          orderNo,
          intentKey,
        });
        return res.json({ received: true });
      }

      const upd = await Order.updateOne(q, {
        $set: {
          // ✅ 你原本的字段
          "payment.status": "paid",
          "payment.paidAt": now,
          "payment.paidTotal": amountPaid,
          "payment.amountTotal": amountTotal,
          "payment.stripeChargeId": String(pi.latest_charge || ""),
          "payment.stripePaymentIntentId": String(pi.id || ""),
          "payment.method": "stripe",
          "payment.paid": true,

          // ✅ 订单主字段（后台很多页面只看这些）
          status: "paid",
          paidAt: now,

          // ✅ 兼容字段：非常多后台“是否已支付”就是看这些
          isPaid: true,
          paymentStatus: "paid",
          payStatus: "paid",
        },
      });

      console.log("✅ webhook succeeded updated:", {
        matched: upd?.matchedCount,
        modified: upd?.modifiedCount,
        q,
        pi: pi.id,
        amountPaid,
      });
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;

      const orderId = pi.metadata?.orderId;
      const orderNo = pi.metadata?.orderNo;
      const intentKey = pi.metadata?.intentKey;

      const q =
        orderId
          ? { _id: orderId }
          : orderNo
          ? { orderNo }
          : intentKey
          ? { "payment.intentKey": intentKey }
          : null;

      if (q) {
        const upd = await Order.updateOne(q, {
          $set: {
            "payment.status": "failed",
            "payment.paid": false,
            "payment.lastError": pi.last_payment_error?.message || "payment_failed",

            // 兼容字段
            paymentStatus: "failed",
            payStatus: "failed",
            isPaid: false,
          },
        });
        console.warn("⚠️ webhook payment_failed updated:", {
          matched: upd?.matchedCount,
          modified: upd?.modifiedCount,
          q,
          pi: pi.id,
        });
      } else {
        console.warn("⚠️ payment_failed but cannot locate order:", pi?.id);
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("stripe webhook error:", err);
    return res.status(500).send("webhook handler error");
  }
});

export default router;
