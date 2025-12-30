// backend/src/routes/pay_stripe.js
import express from "express";
import Stripe from "stripe";

import Order from "../models/Order.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

if (!STRIPE_SECRET_KEY) {
  console.warn("⚠️ STRIPE_SECRET_KEY 未设置，Stripe 接口将不可用");
}
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" }) : null;

// ---------- 工具 ----------
function moneyToCents(n) {
  const v = Number(n || 0);
  return Math.round(v * 100);
}
function genOrderNo() {
  // 简单可读；你也可以换成更严格的唯一生成器
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

function computeTotalsFromPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  let subtotal = 0;
  let totalQty = 0;
  for (const it of items) {
    const qty = Number(it.qty || 1);
    const price = Number(it.price || 0);
    totalQty += qty;
    subtotal += price * qty;
  }

  // 你前端 snapshot 已经算过 shipping，这里再按同一规则算一次（以免前端被改）
  const mode = payload?.mode || "normal";
  let shipping = 0;
  if (mode === "dealsDay") shipping = 0;
  else if (mode === "groupDay") shipping = subtotal >= 49.99 ? 0 : 4.99;
  else shipping = 4.99;

  const total = Number((subtotal + shipping).toFixed(2));
  return {
    totalQty,
    subtotal: Number(subtotal.toFixed(2)),
    shipping: Number(shipping.toFixed(2)),
    total,
  };
}

// ---------- 1) 给前端取 publishable key ----------
router.get("/publishable-key", (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ success: false, message: "STRIPE_PUBLISHABLE_KEY 未配置" });
  }
  return res.json({ success: true, key: STRIPE_PUBLISHABLE_KEY });
});

// ---------- 2) 创建订单 + PaymentIntent ----------
// 前端会 POST /api/pay/stripe/order-intent
router.post("/order-intent", requireLogin, express.json(), async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe 未初始化（缺少 STRIPE_SECRET_KEY）" });

    const user = req.user; // requireLogin 一般会挂 user
    const payload = req.body || {};

    // 重新计算金额（防篡改）
    const totals = computeTotalsFromPayload(payload);
    if (!totals.total || totals.total <= 0) {
      return res.status(400).json({ success: false, message: "金额异常" });
    }

    // 规则：普通/区域团最低 49.99（你前端同样限制）
    if ((payload.mode === "groupDay" || payload.mode === "normal") && totals.subtotal < 49.99) {
      return res.status(400).json({ success: false, message: "未满足最低消费 $49.99，无法下单" });
    }

    // 地址基本校验
    const s = payload.shipping || {};
    if (!s.firstName || !s.lastName || !s.phone || !s.street1 || !s.city || !s.state || !s.zip) {
      return res.status(400).json({ success: false, message: "收货信息不完整" });
    }
    if (typeof s.lat !== "number" || typeof s.lng !== "number") {
      return res.status(400).json({ success: false, message: "缺少坐标（请从 Places 下拉选择地址）" });
    }

    const orderNo = genOrderNo();

    // 先创建订单（payment 先 unpaid）
    const doc = await Order.create({
      orderNo,

      userId: user._id,
      customerName: [s.firstName, s.lastName].filter(Boolean).join(" ").trim(),
      customerPhone: s.phone,

      deliveryType: "home",
      status: "pending", // 履约状态
      orderType: payload.mode === "groupDay" ? "area_group" : payload.mode === "dealsDay" ? "area_group" : "normal",

      // 金额（老字段）
      subtotal: totals.subtotal,
      deliveryFee: totals.shipping,
      discount: 0,
      totalAmount: totals.total,

      // 支付快照（新字段）
      payment: {
        status: "unpaid",
        method: "stripe",
        currency: "USD",
        amountSubtotal: totals.subtotal,
        amountDeliveryFee: totals.shipping,
        amountDiscount: 0,
        amountTotal: totals.total,
      },

      // 地址（兼容字段）
      addressText: s.fullText || "",
      note: s.note || "",

      address: {
        fullText: s.fullText || "",
        zip: s.zip || "",
        zoneId: "", // 你如果有 zone 规则可在后端查
        lat: s.lat,
        lng: s.lng,
      },

      items: (payload.items || []).map((it) => ({
        productId: it.productId || undefined,
        legacyProductId: "",
        name: it.name || "",
        sku: it.sku || "",
        price: Number(it.price || 0),
        qty: Number(it.qty || 1),
        image: it.image || "",
        lineTotal: Number((Number(it.price || 0) * Number(it.qty || 1)).toFixed(2)),
        cost: Number(it.cost || 0),
      })),
    });

    // 创建 PaymentIntent
    const intent = await stripe.paymentIntents.create({
      amount: moneyToCents(totals.total),
      currency: "usd",
      automatic_payment_methods: { enabled: true }, // 支持卡/Apple Pay 等（看你的 Stripe 设置）
      metadata: {
        orderId: String(doc._id),
        orderNo: String(orderNo),
        userId: String(user._id),
      },
    });

    // 写回订单 paymentIntentId
    doc.payment.stripePaymentIntentId = intent.id;
    // ⚠️ 不建议存 client_secret（这里只是兼容；你也可以不存）
    doc.payment.stripeClientSecret = intent.client_secret || "";
    await doc.save();

    return res.json({
      success: true,
      orderId: String(doc._id),
      orderNo: doc.orderNo,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
    });
  } catch (err) {
    console.error("POST /api/pay/stripe/order-intent error:", err);
    return res.status(500).json({ success: false, message: err?.message || "创建 Stripe 支付失败" });
  }
});

// ---------- 3) Stripe Webhook：更新订单支付状态 ----------
// 重要：Webhook 必须使用 express.raw({ type: 'application/json' })，不能被 express.json() 吃掉
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe) return res.status(500).send("stripe not initialized");
      if (!STRIPE_WEBHOOK_SECRET) {
        // 允许你先不配 webhook secret，至少不报 500
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

      // 只处理关键事件
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;
        const orderId = pi.metadata?.orderId;
        const orderNo = pi.metadata?.orderNo;

        const q = orderId ? { _id: orderId } : orderNo ? { orderNo } : null;
        if (q) {
          await Order.updateOne(q, {
            $set: {
              "payment.status": "paid",
              "payment.paidAt": new Date(),
              "payment.stripePaid": (pi.amount_received || pi.amount || 0) / 100,
              "payment.paidTotal": (pi.amount_received || pi.amount || 0) / 100,
              "payment.stripeChargeId": (pi.latest_charge || "") + "",
              status: "paid", // 履约状态改 paid（你也可以改成 packing）
              paidAt: new Date(),
            },
          });
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object;
        const orderId = pi.metadata?.orderId;
        const orderNo = pi.metadata?.orderNo;
        const q = orderId ? { _id: orderId } : orderNo ? { orderNo } : null;
        if (q) {
          await Order.updateOne(q, {
            $set: {
              "payment.status": "failed",
              "payment.lastError": pi.last_payment_error?.message || "payment_failed",
            },
          });
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("stripe webhook error:", err);
      return res.status(500).send("webhook handler error");
    }
  }
);

export default router;

/*
✅ 你还需要在 backend/src/server.js 挂载（你自己改一下位置）：

import stripePayRouter from "./routes/pay_stripe.js";

// 注意：webhook 需要 raw body，最好把它挂在全局 express.json() 之前或单独处理
app.use("/api/pay/stripe", stripePayRouter);

*/
