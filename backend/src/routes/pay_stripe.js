// backend/src/routes/pay_stripe.js
import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";

import Order from "../models/order.js";
import User from "../models/user.js";
import Zone from "../models/Zone.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!STRIPE_SECRET_KEY) console.warn("⚠️ STRIPE_SECRET_KEY 未设置，Stripe 接口将不可用");

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

// ---------- utils ----------
function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
function moneyToCents(n) {
  return Math.round(Number(n || 0) * 100);
}
function centsToMoney(c) {
  return round2(Number(c || 0) / 100);
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
function normPhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
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
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}
function startOfDayFromYMD(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const d = new Date(String(ymd) + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? null : d;
}
function toYMD(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function buildBatchKey(deliveryDate, zoneId) {
  const ymd = toYMD(deliveryDate);
  return `${ymd}|zone:${String(zoneId || "").trim()}`;
}

// ---------- totals (server-authoritative) ----------
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

  let deliveryFee = 0;
  if (mode === "dealsDay") deliveryFee = 0;
  else if (mode === "groupDay") deliveryFee = subtotal >= 49.99 ? 0 : 4.99;
  else if (mode === "friendGroup") deliveryFee = 4.99;
  else deliveryFee = 4.99;
  deliveryFee = round2(deliveryFee);

  // taxableSubtotal
  let taxableSubtotal = 0;
  for (const it of items) {
    const qty = Math.max(1, safeNum(it.qty, 1));
    const price = safeNum(it.price, 0);
    const taxable = isTruthy(it.taxable) || isTruthy(it.hasTax);
    if (taxable) taxableSubtotal += price * qty;
  }
  taxableSubtotal = round2(taxableSubtotal);

  // taxRate from payload.pricing.taxRate
  const salesTaxRate = safeNum(payload?.pricing?.taxRate, 0);
  const salesTax = round2(taxableSubtotal * salesTaxRate);

  // tip
  const tipFee = Math.max(0, round2(safeNum(payload?.pricing?.tip, 0)));

  // platformFee: 你 schema 的 pre-validate 会根据 payment.method==="stripe" 自动算 2%
  // 这里只把 payment.method 设为 stripe，并把 platformFee 先置 0 让 pre-validate 算。
  const discount = 0;

  // totalAmount 先返回一个“预估”，真正入库总额以 Order pre-validate 计算为准
  const totalEstimated = round2(subtotal + deliveryFee + salesTax + tipFee + round2((subtotal + deliveryFee + salesTax - discount) * 0.02));

  return {
    subtotal,
    deliveryFee,
    taxableSubtotal,
    salesTaxRate: round2(salesTaxRate),
    salesTax,
    tipFee,
    discount,
    totalEstimated,
  };
}

// ---------- Zone resolve ----------
async function resolveZoneFromPayload({ zoneId, shipping }) {
  const z0 = String(zoneId || shipping?.zoneId || shipping?.address?.zoneId || "").trim();
  if (z0) return { zoneId: z0, zoneName: "" };

  const zip = String(shipping?.zip || shipping?.postalCode || "").trim();
  if (!zip) return { zoneId: "", zoneName: "" };

  const doc =
    (await Zone.findOne({ zips: zip }).select("key name zoneId code").lean()) ||
    (await Zone.findOne({ zipWhitelist: zip }).select("key name zoneId code").lean());

  if (!doc) return { zoneId: "", zoneName: "" };
  const zoneKey = String(doc.key || doc.code || doc.zoneId || "").trim();
  const zoneName = String(doc.name || "").trim();
  return { zoneId: zoneKey, zoneName };
}

// ---------- 1) publishable key ----------
router.get("/publishable-key", (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ success: false, message: "STRIPE_PUBLISHABLE_KEY 未配置" });
  }
  return res.json({ success: true, key: STRIPE_PUBLISHABLE_KEY });
});

// ---------- 2) create/reuse order + PaymentIntent ----------
// POST /api/pay/stripe/order-intent
router.post("/order-intent", requireLogin, express.json(), async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe 未初始化（缺少 STRIPE_SECRET_KEY）" });
    }

    const user = req.user;
    const payload = req.body || {};
    const intentKey = String(payload.intentKey || "").trim(); // 前端幂等键
    if (!intentKey) return res.status(400).json({ success: false, message: "缺少 intentKey" });

    // shipping validate
    const s = payload.shipping || {};
    if (!s.firstName || !s.lastName || !s.phone || !s.street1 || !s.city || !s.state || !s.zip) {
      return res.status(400).json({ success: false, message: "收货信息不完整" });
    }
    if (typeof s.lat !== "number" || typeof s.lng !== "number") {
      return res.status(400).json({ success: false, message: "缺少坐标（请从 Places 下拉选择地址）" });
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return res.status(400).json({ success: false, message: "购物车为空" });

    // dealsDay only deals
    const hasNonDeal = items.some((it) => !isDealLike(it));
    if (String(payload.mode || "") === "dealsDay" && hasNonDeal) {
      return res.status(400).json({ success: false, message: "爆品日订单只能包含爆品商品" });
    }

    // totals
    const totals = computeTotalsFromPayload(payload);

    // stripe min
    if (!totals.totalEstimated || totals.totalEstimated <= 0) {
      return res.status(400).json({ success: false, message: "金额异常" });
    }
    if (totals.totalEstimated < 0.5) {
      return res.status(400).json({ success: false, message: "信用卡支付最低 $0.50，请增加金额或改用钱包" });
    }

    // min subtotal rules
    const mode = String(payload.mode || "normal").trim();
    if ((mode === "groupDay" || mode === "normal") && totals.subtotal < 49.99) {
      return res.status(400).json({ success: false, message: "未满足最低消费 $49.99，无法下单" });
    }
    if (mode === "friendGroup" && totals.subtotal < 29) {
      return res.status(400).json({ success: false, message: "未满足好友拼单最低消费 $29，无法下单" });
    }

    // delivery info
    const deliveryType = String(payload.deliveryType || "").trim();
    const deliveryDateStr = String(payload.deliveryDate || "").trim(); // YYYY-MM-DD
    const deliveryDateObj = startOfDayFromYMD(deliveryDateStr);
    if (!deliveryType || !deliveryDateObj) {
      return res.status(400).json({ success: false, message: "缺少 deliveryType / deliveryDate" });
    }

    // phone10
    let loginPhoneRaw = String(user?.phone || "").trim();
    if (!loginPhoneRaw && user?._id) {
      const u = await User.findById(user._id).select("phone").lean().catch(() => null);
      loginPhoneRaw = String(u?.phone || "").trim();
    }
    const phone10 = normPhone(s.phone || loginPhoneRaw);

    // resolve zone
    let zoneId = String(payload.zoneKey || payload.zoneId || "").trim();
    let zoneName = String(payload.zoneName || "").trim();
    if (!zoneId) {
      const rz = await resolveZoneFromPayload({ zoneId: payload.zoneId, shipping: s });
      zoneId = rz.zoneId;
      zoneName = rz.zoneName;
    }
    const batchKey = buildBatchKey(deliveryDateObj, zoneId);

    // ✅ 幂等复用：用 schema 存在的 payment.idempotencyKey 来做 intentKey
    let doc = await Order.findOne({
      userId: user._id,
      "payment.method": "stripe",
      "payment.idempotencyKey": intentKey,
      "payment.status": "unpaid",
    }).catch(() => null);

    // 如果已经有 intentId（schema: payment.stripe.intentId），直接返回复用
    if (doc?.payment?.stripe?.intentId) {
      const intentId = String(doc.payment.stripe.intentId || "");
      const pi = await stripe.paymentIntents.retrieve(intentId).catch(() => null);

      return res.json({
        success: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        clientSecret: pi?.client_secret || "",
        paymentIntentId: intentId,
        reused: true,
      });
    }

    // create order (unpaid/pending)
    if (!doc) {
      doc = await Order.create({
        orderNo: genOrderNo(),

        userId: user._id,
        customerName: [s.firstName, s.lastName].filter(Boolean).join(" ").trim(),
        customerPhone: phone10 || String(s.phone || "").trim(),

        deliveryType: String(payload.deliveryType || "home").trim() || "home",
        deliveryMode: mode, // ✅ schema 对齐

        deliveryDate: deliveryDateObj,

        fulfillment: zoneId
          ? { groupType: "zone_group", zoneId, batchKey, batchName: zoneName || "" }
          : { groupType: "none", zoneId: "", batchKey: "", batchName: "" },

        dispatch: zoneId ? { zoneId, batchKey, batchName: zoneName || "" } : { zoneId: "", batchKey: "", batchName: "" },

        status: "pending",

        // money fields（让 pre-validate 再统一）
        subtotal: totals.subtotal,
        deliveryFee: totals.deliveryFee,
        discount: totals.discount,
        taxableSubtotal: totals.taxableSubtotal,
        salesTaxRate: totals.salesTaxRate,
        salesTax: totals.salesTax,
        tipFee: totals.tipFee,

        // payment (schema对齐)
        payment: {
          status: "unpaid",
          method: "stripe",
          amountTotal: undefined,
          paidTotal: 0,

          // ✅ 用 schema 存在字段存 intentKey
          idempotencyKey: intentKey,

          stripe: {
            intentId: "", // 后面写回
            paid: 0,
          },
        },

        addressText: String(s.fullText || "").trim(),
        note: String(s.note || "").trim(),

        address: {
          fullText: String(s.fullText || "").trim(),
          zip: String(s.zip || "").trim(),
          zoneId: String(payload.zoneId || zoneId || "").trim(),
          lat: s.lat,
          lng: s.lng,
        },

        items: items.map((it) => ({
          productId: it.productId || undefined,
          legacyProductId: String(it.legacyProductId || it._id || it.id || "").trim(),
          name: String(it.name || ""),
          sku: String(it.sku || ""),
          price: safeNum(it.price, 0),
          qty: Math.max(1, safeNum(it.qty, 1)),
          image: String(it.image || ""),
          lineTotal: round2(safeNum(it.price, 0) * Math.max(1, safeNum(it.qty, 1))),
          cost: safeNum(it.cost, 0),
          hasTax: isTruthy(it.taxable) || isTruthy(it.hasTax),
        })),
      });
    }

    // create PaymentIntent
    // ✅ 这里 amount 用 doc.totalAmount（让 pre-validate 的 platformFee 生效后金额一致）
    // doc 是 create 后的文档，pre-validate 已经跑过了
    const cents = moneyToCents(doc.totalAmount);

    const intent = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          orderId: String(doc._id),
          orderNo: String(doc.orderNo),
          userId: String(user._id),
          customerPhone: phone10 || "",
          intentKey: intentKey,
          amountCents: String(cents),
        },
      },
      {
        idempotencyKey: `fb_pi_${intentKey}__${cents}`,
      }
    );

    // ✅ 写回 schema 正确字段：payment.stripe.intentId
    await Order.updateOne(
      { _id: doc._id },
      {
        $set: {
          "payment.stripe.intentId": String(intent.id),
          "payment.amountTotal": Number(doc.totalAmount || 0),
        },
      }
    );

    return res.json({
      success: true,
      orderId: String(doc._id),
      orderNo: doc.orderNo,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      reused: false,
      totalAmount: doc.totalAmount,
    });
  } catch (err) {
    if (err?.type === "StripeIdempotencyError" || err?.rawType === "idempotency_error") {
      console.error("❌ StripeIdempotencyError:", err?.message || err);
      return res.status(400).json({
        success: false,
        message: "Stripe 幂等键冲突：同一 intentKey 被用于不同金额参数。请刷新页面重试。",
      });
    }
    console.error("POST /api/pay/stripe/order-intent error:", err);
    return res.status(500).json({ success: false, message: err?.message || "创建 Stripe 支付失败" });
  }
});

// ---------- 3) Webhook (MUST be raw) ----------
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

      const orderId = String(pi.metadata?.orderId || "").trim();
      const orderNo = String(pi.metadata?.orderNo || "").trim();
      const intentKey = String(pi.metadata?.intentKey || "").trim();
      const metaUserId = String(pi.metadata?.userId || "").trim();
      const metaPhone = String(pi.metadata?.customerPhone || "").trim();

      const amountPaid = centsToMoney(pi.amount_received || pi.amount || 0);
      const now = new Date();

      const q =
        orderId && mongoose.Types.ObjectId.isValid(orderId)
          ? { _id: orderId }
          : orderNo
          ? { orderNo }
          : intentKey
          ? { "payment.idempotencyKey": intentKey }
          : { "payment.stripe.intentId": String(pi.id) };

      const patch = {
        status: "paid",
        paidAt: now,

        "payment.status": "paid",
        "payment.method": "stripe",
        "payment.paidTotal": amountPaid,
        "payment.amountTotal": undefined,

        "payment.stripe.intentId": String(pi.id),
        "payment.stripe.paid": amountPaid,
      };

      // ✅ 兜底补 userId / phone（防止出现“无主订单”导致用户中心看不到）
      const uid = toObjectIdMaybe(metaUserId);
      if (uid) patch.userId = uid;

      const p10 = normPhone(metaPhone);
      if (p10) patch.customerPhone = p10;

      const r = await Order.updateOne(q, { $set: patch });

      console.log("✅ webhook paid updated:", {
        matched: r?.matchedCount,
        modified: r?.modifiedCount,
        pi: pi?.id,
        orderId: orderId || null,
        orderNo: orderNo || null,
        intentKey: intentKey || null,
        metaUserId: metaUserId || null,
        amountPaid,
      });
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      const orderId = String(pi.metadata?.orderId || "").trim();
      const orderNo = String(pi.metadata?.orderNo || "").trim();
      const intentKey = String(pi.metadata?.intentKey || "").trim();

      const q =
        orderId && mongoose.Types.ObjectId.isValid(orderId)
          ? { _id: orderId }
          : orderNo
          ? { orderNo }
          : intentKey
          ? { "payment.idempotencyKey": intentKey }
          : { "payment.stripe.intentId": String(pi.id) };

      await Order.updateOne(q, {
        $set: {
          "payment.status": "unpaid",
          "payment.idempotencyKey": intentKey || undefined,
        },
      });

      console.warn("⚠️ webhook payment_failed:", {
        pi: pi?.id,
        orderId: orderId || null,
        orderNo: orderNo || null,
        intentKey: intentKey || null,
        err: pi?.last_payment_error?.message || "",
      });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("stripe webhook error:", err);
    return res.status(500).send("webhook handler error");
  }
});

export default router;
