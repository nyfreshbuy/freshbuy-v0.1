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

  for (const it of items) {
    const qty = Math.max(1, safeNum(it.qty, 1));
    const price = safeNum(it.price, 0);
    subtotal += price * qty;
  }
  subtotal = round2(subtotal);

  const mode = String(payload?.mode || "normal").trim();
  let shipping = 0;
  if (mode === "dealsDay") shipping = 0;
  else if (mode === "groupDay") shipping = subtotal >= 49.99 ? 0 : 4.99;
  else if (mode === "friendGroup") shipping = 4.99;
  else shipping = 4.99;
  shipping = round2(shipping);

  // taxableSubtotal：用 items taxable/hasTax
  let taxableSubtotal = 0;
  for (const it of items) {
    const qty = Math.max(1, safeNum(it.qty, 1));
    const price = safeNum(it.price, 0);
    const taxable = isTruthy(it.taxable) || isTruthy(it.hasTax);
    if (taxable) taxableSubtotal += price * qty;
  }
  taxableSubtotal = round2(taxableSubtotal);

  const taxRate = safeNum(payload?.pricing?.taxRate, 0);
  const salesTax = round2(taxableSubtotal * taxRate);

  // 平台费：Stripe 2%
  const platformFee = round2((subtotal + shipping + salesTax) * 0.02);

  const tipFee = Math.max(0, round2(safeNum(payload?.pricing?.tip, 0)));

  const totalAmount = round2(subtotal + shipping + salesTax + platformFee + tipFee);

  return { subtotal, shipping, taxableSubtotal, taxRate, salesTax, platformFee, tipFee, totalAmount };
}

// ---------- 1) publishable key ----------
router.get("/publishable-key", (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ success: false, message: "STRIPE_PUBLISHABLE_KEY 未配置" });
  }
  return res.json({ success: true, key: STRIPE_PUBLISHABLE_KEY });
});

// ---------- 2) 创建/复用订单 + PaymentIntent ----------
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
    const hasNonDeal = items.some((it) => !isDealLike(it));
    if (payload.mode === "dealsDay" && hasNonDeal) {
      return res.status(400).json({ success: false, message: "爆品日订单只能包含爆品商品" });
    }

    const totals = computeTotalsFromPayload(payload);
    if (!totals.totalAmount || totals.totalAmount <= 0) {
      return res.status(400).json({ success: false, message: "金额异常" });
    }
    if (totals.totalAmount < 0.5) {
      return res.status(400).json({ success: false, message: "信用卡支付最低 $0.50，请增加金额或改用钱包" });
    }

    // 最低消费
    if ((payload.mode === "groupDay" || payload.mode === "normal") && totals.subtotal < 49.99) {
      return res.status(400).json({ success: false, message: "未满足最低消费 $49.99，无法下单" });
    }
    if (payload.mode === "friendGroup" && totals.subtotal < 29) {
      return res.status(400).json({ success: false, message: "未满足好友拼单最低消费 $29，无法下单" });
    }

    // 关键：这些是你 order model 里真实字段
    const deliveryType = String(payload.deliveryType || "").trim();
    const deliveryDate = payload.deliveryDate ? new Date(payload.deliveryDate) : null;

    if (!deliveryType || !deliveryDate || Number.isNaN(deliveryDate.getTime())) {
      return res.status(400).json({ success: false, message: "缺少 deliveryType / deliveryDate" });
    }

    // ---------- 2.1 查找幂等订单 ----------
    let doc = await Order.findOne({
      userId: user._id,
      "payment.method": "stripe",
      "payment.idempotencyKey": intentKey,
      "payment.status": { $in: ["unpaid"] },
    }).catch(() => null);

    // 如果已存在 intentId：直接复用
    if (doc?.payment?.stripe?.intentId) {
      return res.json({
        success: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        clientSecret: "", // 不存 clientSecret 也行；前端可以重新 create 或你愿意存也可扩展
        paymentIntentId: doc.payment.stripe.intentId,
        reused: true,
      });
    }

    // ---------- 2.2 创建订单（字段严格对齐 model） ----------
    if (!doc) {
      doc = await Order.create({
        orderNo: genOrderNo(),
        userId: user._id, // ✅ 关键：必须绑定 userId，否则“我的订单”查不到
        customerName: [s.firstName, s.lastName].filter(Boolean).join(" ").trim(),
        customerPhone: s.phone,

        deliveryType,
        deliveryMode: String(payload.mode || "normal"), // ✅ 关键：用 deliveryMode，不要用 mode

        // 地址
        addressText: s.fullText || "",
        note: s.note || "",
        address: {
          fullText: s.fullText || "",
          zip: s.zip || "",
          zoneId: payload.zoneId || "",
          lat: s.lat,
          lng: s.lng,
        },

        // 金额（与你 model 一致）
        subtotal: totals.subtotal,
        deliveryFee: totals.shipping,
        taxableSubtotal: totals.taxableSubtotal,
        salesTaxRate: totals.taxRate,
        salesTax: totals.salesTax,
        platformFee: totals.platformFee,
        tipFee: totals.tipFee,
        discount: 0,
        totalAmount: totals.totalAmount,

        // 支付块（与你 model 一致）
        payment: {
          status: "unpaid",
          method: "stripe",
          paidTotal: 0,
          idempotencyKey: intentKey,

          amountSubtotal: totals.subtotal,
          amountDeliveryFee: totals.shipping,
          amountTax: totals.salesTax,
          amountPlatformFee: totals.platformFee,
          amountTip: totals.tipFee,
          amountDiscount: 0,
          amountTotal: totals.totalAmount,

          stripe: {
            intentId: "", // 下面写入
            paid: 0,
          },
        },

        // 订单状态
        status: "pending",

        items: items.map((it) => ({
          productId: it.productId || undefined,
          legacyProductId: "",
          name: it.name || "",
          sku: it.sku || "",
          price: safeNum(it.price, 0),
          qty: Math.max(1, safeNum(it.qty, 1)),
          image: it.image || "",
          lineTotal: round2(safeNum(it.price, 0) * Math.max(1, safeNum(it.qty, 1))),
          cost: safeNum(it.cost, 0),
          hasTax: isTruthy(it.taxable) || isTruthy(it.hasTax),
        })),

        deliveryDate, // ✅ 你 model 里是 Date
      });
    }

    // ---------- 2.3 创建 PaymentIntent ----------
    const cents = moneyToCents(totals.totalAmount);

    const intent = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          orderId: String(doc._id),
          orderNo: String(doc.orderNo),
          userId: String(user._id),
          intentKey,
          amountCents: String(cents),
        },
      },
      {
        // ✅ 避免“同 intentKey 不同金额”冲突
        idempotencyKey: `fb_pi_${intentKey}__${cents}`,
      }
    );

    // ✅ 写回 model 真实字段：payment.stripe.intentId
    doc.payment = doc.payment || {};
    doc.payment.method = "stripe";
    doc.payment.status = "unpaid";
    doc.payment.idempotencyKey = intentKey;
    doc.payment.stripe = doc.payment.stripe || {};
    doc.payment.stripe.intentId = intent.id;

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

// ---------- 3) Webhook：支付成功后改 paid ----------
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!stripe) return res.status(500).send("stripe not initialized");
    if (!STRIPE_WEBHOOK_SECRET) return res.status(400).send("webhook secret not configured");

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error("❌ webhook signature verify failed:", e?.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      const orderId = pi.metadata?.orderId ? String(pi.metadata.orderId) : "";
      const intentKey = pi.metadata?.intentKey ? String(pi.metadata.intentKey) : "";

      const paid = centsToMoney(pi.amount_received || pi.amount || 0);

      // ✅ 用 orderId 优先定位；兜底用 intentId / idempotencyKey
      const q = orderId
        ? { _id: orderId }
        : {
            $or: [
              { "payment.stripe.intentId": String(pi.id) },
              { "payment.idempotencyKey": intentKey },
            ],
          };

      await Order.updateOne(q, {
        $set: {
          status: "paid",
          paidAt: new Date(),

          "payment.status": "paid",
          "payment.method": "stripe",
          "payment.paidTotal": paid,
          "payment.stripe.intentId": String(pi.id),
          "payment.stripe.paid": paid,
        },
      });

      console.log("✅ webhook paid:", { pi: pi.id, orderId: orderId || null, intentKey: intentKey || null, paid });
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      const orderId = pi.metadata?.orderId ? String(pi.metadata.orderId) : "";
      const intentKey = pi.metadata?.intentKey ? String(pi.metadata.intentKey) : "";

      const q = orderId
        ? { _id: orderId }
        : {
            $or: [
              { "payment.stripe.intentId": String(pi.id) },
              { "payment.idempotencyKey": intentKey },
            ],
          };

      await Order.updateOne(q, {
        $set: {
          "payment.status": "unpaid",
        },
      });

      console.warn("⚠️ webhook failed:", { pi: pi.id, orderId: orderId || null, intentKey: intentKey || null });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("stripe webhook error:", err);
    return res.status(500).send("webhook handler error");
  }
});

export default router;
