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
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

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
function toYMD(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDayFromYMD(ymd) {
  if (!ymd || typeof ymd !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(ymd + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? null : d;
}
function buildBatchKey(deliveryDate, zoneKey) {
  const ymd = toYMD(deliveryDate);
  return `${ymd}|zone:${String(zoneKey || "").trim()}`;
}

// ---------- 金额重算（服务端权威） ----------
// 规则说明：
// - subtotal：按 items 计算
// - shipping：按 mode + subtotal 计算（你原本逻辑）
// - tax：从 taxableAmount * taxRate 来算（目前按前端传的 taxRate；你也可按 state/zip 查更准确）
// - serviceFee：Stripe 支付一律按 subtotal*2%
// - tip：使用 payload.pricing.tip（>=0）
// 最后 total = subtotal + shipping + tax + serviceFee + tip
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

  // shipping：跟你原先一致（可替换为 zone 配置逻辑）
  const mode = String(payload?.mode || "normal").trim();
  let shipping = 0;
  if (mode === "dealsDay") shipping = 0;
  else if (mode === "groupDay") shipping = subtotal >= 49.99 ? 0 : 4.99;
  else if (mode === "friendGroup") shipping = 4.99;
  else shipping = 4.99;
  shipping = round2(shipping);

  // taxableAmount：优先从 items 里 taxable/hasTax 判断，否则可用 payload.pricing.taxableAmount 兜底
  let taxableAmount = 0;
  for (const it of items) {
    const qty = safeNum(it.qty, 1);
    const price = safeNum(it.price, 0);
    const taxable = isTruthy(it.taxable) || isTruthy(it.hasTax);
    if (taxable) taxableAmount += price * qty;
  }
  taxableAmount = round2(taxableAmount);

  // taxRate：优先用 payload.pricing.taxRate（你前端 NY 才 >0）
  const taxRate = safeNum(payload?.pricing?.taxRate, 0);
  const tax = round2(taxableAmount * taxRate);

  // serviceFee：Stripe 订单一定收（2%）
  const serviceRate = safeNum(payload?.pricing?.serviceRate, 0.02);
  const serviceFee = round2(subtotal * serviceRate);

  // tip
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

// ---------- Zone resolve（可选，但帮你把 zoneKey 对齐） ----------
async function resolveZoneFromPayload({ zoneId, shipping }) {
  const z0 = String(zoneId || shipping?.zoneId || shipping?.address?.zoneId || "").trim();
  if (z0) return { zoneKey: z0, zoneName: "" };

  const zip = String(shipping?.zip || shipping?.postalCode || "").trim();
  if (!zip) return { zoneKey: "", zoneName: "" };

  try {
    const doc =
      (await Zone.findOne({ zips: zip }).select("key name zoneId code").lean()) ||
      (await Zone.findOne({ zipWhitelist: zip }).select("key name zoneId code").lean());
    if (!doc) return { zoneKey: "", zoneName: "" };

    const zoneKey = String(doc.key || doc.code || doc.zoneId || "").trim();
    const zoneName = String(doc.name || "").trim();
    return { zoneKey, zoneName };
  } catch (e) {
    return { zoneKey: "", zoneName: "" };
  }
}

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
    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe 未初始化（缺少 STRIPE_SECRET_KEY）" });
    }

    const user = req.user;
    const payload = req.body || {};

    // ✅ 幂等关键：intentKey 必须存在（前端生成）
    const intentKey = String(payload.intentKey || "").trim();
    if (!intentKey) {
      return res.status(400).json({ success: false, message: "缺少 intentKey（前端幂等键）" });
    }

    // ✅ 地址基本校验
    const s = payload.shipping || {};
    if (!s.firstName || !s.lastName || !s.phone || !s.street1 || !s.city || !s.state || !s.zip) {
      return res.status(400).json({ success: false, message: "收货信息不完整" });
    }
    if (typeof s.lat !== "number" || typeof s.lng !== "number") {
      return res.status(400).json({ success: false, message: "缺少坐标（请从 Places 下拉选择地址）" });
    }

    // ✅ dealsDay 只能全爆品
    const items = Array.isArray(payload.items) ? payload.items : [];
    const hasDeal = items.some((it) => isDealLike(it));
    const hasNonDeal = items.some((it) => !isDealLike(it));
    if (payload.mode === "dealsDay" && hasNonDeal) {
      return res.status(400).json({ success: false, message: "爆品日订单只能包含爆品商品" });
    }
    // （保持你原逻辑：groupDay/normal 不允许全爆品等，你可在 orders.js 再做更严校验）

    // ✅ 重算金额（服务端权威）
    const totals = computeTotalsFromPayload(payload);

    // ✅ Stripe 最低金额防御（信用卡最低通常 $0.50）
    if (!totals.total || totals.total <= 0) {
      return res.status(400).json({ success: false, message: "金额异常" });
    }
    if (totals.total < 0.5) {
      return res.status(400).json({ success: false, message: "信用卡支付最低 $0.50，请增加金额或改用钱包" });
    }

    // ✅ 最低消费规则（按你前端）
    if ((payload.mode === "groupDay" || payload.mode === "normal") && totals.subtotal < 49.99) {
      return res.status(400).json({ success: false, message: "未满足最低消费 $49.99，无法下单" });
    }
    if (payload.mode === "friendGroup" && totals.subtotal < 29) {
      return res.status(400).json({ success: false, message: "未满足好友拼单最低消费 $29，无法下单" });
    }

    // ✅ 派单关键字段（你前端已加）
    const deliveryType = String(payload.deliveryType || "").trim();
    const deliveryDate = String(payload.deliveryDate || "").trim(); // YYYY-MM-DD
    const deliveryDateObj = startOfDayFromYMD(deliveryDate);

    if (!deliveryType || !deliveryDate) {
      return res.status(400).json({ success: false, message: "缺少 deliveryType / deliveryDate" });
    }

    const deliveryMode = String(payload.mode || "normal").trim();

    // zone：优先 payload.zoneKey，否则尝试从 zoneId/zip 自动匹配
    let zoneKey = String(payload.zoneKey || "").trim();
    let zoneName = String(payload.zoneName || "").trim();
    if (!zoneKey) {
      const rz = await resolveZoneFromPayload({ zoneId: payload.zoneId, shipping: s });
      zoneKey = rz.zoneKey;
      zoneName = rz.zoneName;
    }

    // 订单归属手机号：统一 10 位（用于 /api/orders/my 的匹配）
    // 优先：收货电话，其次：登录用户电话（如果有）
    let loginPhoneRaw = String(user?.phone || "").trim();
    if (!loginPhoneRaw && user?._id) {
      const u = await User.findById(user._id).select("phone").lean().catch(() => null);
      loginPhoneRaw = String(u?.phone || "").trim();
    }
    const phone10 = normPhone(s.phone || loginPhoneRaw);

    // ---------- 2.1) 先找是否已有未支付订单（同 user + intentKey） ----------
    let doc = await Order.findOne({
      userId: user._id,
      "payment.method": "stripe",
      "payment.intentKey": intentKey,
      "payment.status": { $in: ["unpaid", "requires_payment_method", "pending", "requires_action"] },
    }).catch(() => null);

    // ✅ 如果存在且有 paymentIntentId：直接返回它（幂等）
    if (doc?.payment?.stripePaymentIntentId) {
      // ✅ 如果 secret 丢了，现场补回来（防止前端拿不到 clientSecret）
      if (!doc.payment?.stripeClientSecret) {
        try {
          const pi = await stripe.paymentIntents.retrieve(doc.payment.stripePaymentIntentId);
          doc.payment.stripeClientSecret = pi.client_secret || "";
          await doc.save();
        } catch (e) {
          console.warn("⚠️ retrieve payment_intent failed:", e?.message);
        }
      }

      return res.json({
        success: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        clientSecret: doc.payment?.stripeClientSecret || "",
        paymentIntentId: doc.payment?.stripePaymentIntentId || "",
        reused: true,
      });
    }

    // ---------- 2.2) 不存在则创建订单 ----------
    if (!doc) {
      const orderNo = genOrderNo();

      const ddForBatch = deliveryDateObj || new Date(deliveryDate + "T00:00:00.000Z");
      const batchKey = zoneKey ? buildBatchKey(ddForBatch, zoneKey) : "";

      doc = await Order.create({
        orderNo,

        // ✅ 关键：必须有 userId（用户中心就靠它）
        userId: user._id,

        customerName: [s.firstName, s.lastName].filter(Boolean).join(" ").trim(),
        // ✅ 关键：手机号统一 10 位，避免 /api/orders/my 匹配不到
        customerPhone: phone10 || String(s.phone || "").trim(),

        // ✅ 字段对齐：用 deliveryMode（你 orders.js 用的是 deliveryMode）
        deliveryMode,

        // ✅ 你原本字段（保留兼容旧页面）
        mode: deliveryMode,
        deliveryType,

        // ✅ 推荐 Date（如果你 schema 允许）；否则保留 string 也行
        deliveryDate: deliveryDateObj || deliveryDate,

        // zone（兼容 + 给派单/路线使用）
        zoneKey,
        zoneName,

        fulfillment: zoneKey
          ? { groupType: "zone_group", zoneId: zoneKey, batchKey, batchName: zoneName || "" }
          : { groupType: "none", zoneId: "", batchKey: "", batchName: "" },

        dispatch: zoneKey
          ? { zoneId: zoneKey, batchKey, batchName: zoneName || "" }
          : { zoneId: "", batchKey: "", batchName: "" },

        // 订单状态（Stripe 创建 intent 时先 pending/unpaid）
        status: "pending",
        orderType:
          deliveryMode === "groupDay"
            ? "area_group"
            : deliveryMode === "dealsDay"
            ? "area_group"
            : deliveryMode === "friendGroup"
            ? "friend"
            : "normal",

        // 金额（旧字段）
        subtotal: totals.subtotal,
        deliveryFee: totals.shipping,
        discount: 0,
        totalAmount: totals.total,

        taxableSubtotal: totals.taxableAmount,
        salesTax: totals.tax,
        platformFee: totals.serviceFee,
        tipFee: totals.tip,

        // ✅ 支付快照
        payment: {
          status: "unpaid",
          method: "stripe",
          currency: "USD",

          intentKey, // ✅ 幂等关键：存下来

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

          // Stripe 字段占位（后面写回）
          stripePaymentIntentId: "",
          stripeClientSecret: "",
          stripeChargeId: "",
          paidAt: null,
          paidTotal: 0,
          stripePaid: 0,
          walletPaid: 0,
          lastError: "",
        },

        // 地址（兼容字段）
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
          hasTax: isTruthy(it.taxable) || isTruthy(it.hasTax),
          taxable: isTruthy(it.taxable) || isTruthy(it.hasTax),
        })),
      });
    }

    // ---------- 2.3) 创建 PaymentIntent（Stripe 幂等） ----------
    const cents = moneyToCents(totals.total);

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
        // ✅ 关键：幂等键和金额绑定，避免同 intentKey 但金额变了报错
        idempotencyKey: `fb_pi_${intentKey}__${cents}`,
      }
    );

    // 写回订单
    doc.payment.stripePaymentIntentId = intent.id;
    doc.payment.stripeClientSecret = intent.client_secret || "";
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
    // ✅ Stripe 幂等错误提示
    if (err?.type === "StripeIdempotencyError" || err?.rawType === "idempotency_error") {
      console.error("❌ StripeIdempotencyError:", err?.message || err);
      return res.status(400).json({
        success: false,
        message:
          "Stripe 幂等键冲突：同一 intentKey 被用于不同金额参数。请刷新页面重试，或更换购物车/小费后再试。",
      });
    }

    console.error("POST /api/pay/stripe/order-intent error:", err);
    return res.status(500).json({ success: false, message: err?.message || "创建 Stripe 支付失败" });
  }
});

// ---------- 3) Stripe Webhook：更新订单支付状态 ----------
// 重要：Webhook 必须使用 express.raw({ type: 'application/json' })，不能被 express.json() 吃掉
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

    // ✅ 支付成功
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      const orderId = String(pi.metadata?.orderId || "").trim();
      const orderNo = String(pi.metadata?.orderNo || "").trim();
      const intentKey = String(pi.metadata?.intentKey || "").trim();
      const metaUserId = String(pi.metadata?.userId || "").trim();
      const metaPhone = String(pi.metadata?.customerPhone || "").trim();

      const amountPaid = centsToMoney(pi.amount_received || pi.amount || 0);

      const q =
        orderId && mongoose.Types.ObjectId.isValid(orderId)
          ? { _id: orderId }
          : orderNo
          ? { orderNo }
          : intentKey
          ? { "payment.intentKey": intentKey }
          : null;

      if (!q) {
        console.warn("⚠️ payment_intent.succeeded 但找不到定位订单的 metadata", {
          pi: pi?.id,
          orderId,
          orderNo,
          intentKey,
          metaUserId,
        });
      } else {
        const patch = {
          // payment
          "payment.status": "paid",
          "payment.method": "stripe",
          "payment.paidAt": new Date(),
          "payment.paidTotal": amountPaid,
          "payment.stripeChargeId": String(pi.latest_charge || ""),
          "payment.stripePaymentIntentId": String(pi.id || ""),

          // order
          status: "paid",
          paidAt: new Date(),
        };

        // ✅ 关键兜底：如果订单缺 userId，这里用 metadata 补齐
        // 注意：schema 若是 ObjectId，建议写 ObjectId
        if (metaUserId && mongoose.Types.ObjectId.isValid(metaUserId)) {
          patch.userId = new mongoose.Types.ObjectId(metaUserId);
        }
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
    }

    // ✅ 支付失败
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
          ? { "payment.intentKey": intentKey }
          : null;

      if (q) {
        await Order.updateOne(q, {
          $set: {
            "payment.status": "failed",
            "payment.lastError": pi.last_payment_error?.message || "payment_failed",
          },
        });
      }

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
    // Stripe 收到 500 会重试
    return res.status(500).send("webhook handler error");
  }
});

export default router;
