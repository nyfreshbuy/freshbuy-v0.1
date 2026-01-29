// backend/src/routes/pay_stripe.js
import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";
import Order from "../models/order.js";
import User from "../models/user.js";
import Zone from "../models/Zone.js";
import { requireLogin } from "../middlewares/auth.js";
import { computeTotalsFromPayload } from "../utils/checkout_pricing.js";
const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!STRIPE_SECRET_KEY) console.warn("⚠️ STRIPE_SECRET_KEY 未设置，Stripe 接口将不可用");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" }) : null;

// =========================
// 工具
// =========================
function moneyToCents(n) {
  return Math.round(Number(n || 0) * 100);
}
function centsToMoney(c) {
  return Number((Number(c || 0) / 100).toFixed(2));
}
function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
function isTruthy(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function normPhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}
function startOfDay(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x;
}
function toYMD(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function buildBatchKey(deliveryDate, zoneKey) {
  const ymd = toYMD(deliveryDate);
  return `${ymd}|zone:${String(zoneKey || "").trim()}`;
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

function isDealLike(it) {
  if (!it) return false;
  if (it.isDeal === true || it.isSpecial === true || it.isHot === true) return true;
  if (String(it.tag || "").includes("爆品")) return true;
  if (String(it.type || "").toLowerCase() === "hot") return true;
  return false;
}
// ✅ 特价：N for $X 行小计（与前端 checkout.html 同口径）
function calcSpecialLineTotal(it, qty) {
  const q = Math.max(0, Math.floor(safeNum(qty, 0)));
  if (!it || q <= 0) return 0;

  const price = safeNum(it.priceNum ?? it.price, 0);

  const specialQty = safeNum(
    it.specialQty ?? it.specialN ?? it.specialCount ?? it.dealQty,
    0
  );

  const specialTotalPrice = safeNum(
    it.specialTotalPrice ?? it.specialTotal ?? it.specialPrice ?? it.dealTotalPrice ?? it.dealPrice,
    0
  );

  if (specialQty > 0 && specialTotalPrice > 0 && q >= specialQty) {
    const groups = Math.floor(q / specialQty);
    const remainder = q % specialQty;
    return round2(groups * specialTotalPrice + remainder * price);
  }

  return round2(q * price);
}
// =========================
// zone 解析（可选，给派单/路线用）
// =========================
async function resolveZoneFromPayload(payload, shipping) {
  const zoneId = String(payload?.zoneId || shipping?.zoneId || shipping?.address?.zoneId || "").trim();
  if (zoneId) return { zoneKey: zoneId, zoneName: "" };

  const zip = String(shipping?.zip || shipping?.postalCode || "").trim();
  if (!zip) return { zoneKey: "", zoneName: "" };

  const doc =
    (await Zone.findOne({ zips: zip }).select("key name zoneId code").lean()) ||
    (await Zone.findOne({ zipWhitelist: zip }).select("key name zoneId code").lean());

  if (!doc) return { zoneKey: "", zoneName: "" };
  const zoneKey = String(doc.key || doc.code || doc.zoneId || "").trim();
  const zoneName = String(doc.name || "").trim();
  return { zoneKey, zoneName };
}

// =========================
// 1) publishable key
// =========================
router.get("/publishable-key", (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ success: false, message: "STRIPE_PUBLISHABLE_KEY 未配置" });
  }
  return res.json({ success: true, key: STRIPE_PUBLISHABLE_KEY });
});
// =========================
// ✅ 2.5 给【已有订单】创建 PaymentIntent（用于 orders/checkout 的 remaining 部分）
// POST /api/pay/stripe/intent-for-order
// body: { orderId }
// 规则：
// - 订单必须存在且未支付
// - PI 金额 = order.totalAmount - (wallet.paid + stripe.paid)
// - 不再创建新订单（避免钱包扣款丢失）
// =========================
router.post("/intent-for-order", requireLogin, express.json(), async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe 未初始化（缺少 STRIPE_SECRET_KEY）" });
    }

    const orderId = String(req.body?.orderId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "orderId 无效" });
    }

    const doc = await Order.findById(orderId);
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    // ✅ 权限：只能操作自己的订单（或 admin）
    const uid = String(req.user?._id || req.user?.id || "");
    if (doc.userId && String(doc.userId) !== uid && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "无权限" });
    }

    // 已支付幂等
    if (doc.status === "paid" || doc.payment?.status === "paid") {
      return res.json({ success: true, message: "already paid", orderNo: doc.orderNo });
    }

    const total = Number(doc.totalAmount || 0);
    const walletPaid = Number(doc.payment?.wallet?.paid || 0);
    const stripePaid = Number(doc.payment?.stripe?.paid || 0);
    const remaining = round2(total - walletPaid - stripePaid);

    if (!Number.isFinite(remaining) || remaining <= 0) {
      return res.status(400).json({
        success: false,
        message: `无需 Stripe（remaining=${remaining}）`,
      });
    }

    // Stripe 最低 $0.50
    if (remaining < 0.5) {
      return res.status(400).json({
        success: false,
        message: "Stripe 最低 $0.50，请改用纯钱包或增加金额",
      });
    }

    // ✅ 幂等：如果已有 intentId，直接复用
    const existingIntentId = String(doc.payment?.stripe?.intentId || "").trim();
    if (existingIntentId) {
      return res.json({
        success: true,
        reused: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        paymentIntentId: existingIntentId,
        clientSecret: "",
        remaining,
      });
    }

    const cents = moneyToCents(remaining);
    const intentKey = String(doc.payment?.idempotencyKey || doc.orderNo || doc._id);

    const intent = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          orderId: String(doc._id),
          orderNo: String(doc.orderNo),
          userId: String(doc.userId || ""),
          intentKey,
          amountCents: String(cents),
          source: "intent-for-order",
        },
      },
      { idempotencyKey: `fb_exist_${intentKey}__${cents}` }
    );

    // 写回订单
    doc.payment = doc.payment || {};
    doc.payment.method = "stripe";
    doc.payment.status = "unpaid";
    doc.payment.stripe = doc.payment.stripe || {};
    doc.payment.stripe.intentId = intent.id;
    await doc.save();

    return res.json({
      success: true,
      reused: false,
      orderId: String(doc._id),
      orderNo: doc.orderNo,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      remaining,
    });
  } catch (err) {
    console.error("POST /api/pay/stripe/intent-for-order error:", err);
    return res.status(500).json({ success: false, message: err?.message || "创建 intent 失败" });
  }
});
// =========================
// 2) 创建/复用订单 + PaymentIntent
// POST /api/pay/stripe/order-intent
// =========================
router.post("/order-intent", requireLogin, express.json(), async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe 未初始化（缺少 STRIPE_SECRET_KEY）" });
    }

    const user = req.user;
    const payload = req.body || {};
    // ✅ 防止钱包/混合支付误走 Stripe 创建订单接口
if (payload?.useWallet === true || payload?.payMethod === "wallet" || payload?.paymentMethod === "wallet") {
  return res.status(400).json({
    success: false,
    message: "钱包/混合支付请先调用 /api/orders/checkout，然后用 /api/pay/stripe/intent-for-order 创建剩余款的 Stripe intent",
  });
}
    const intentKey = String(payload.intentKey || "").trim();
    if (!intentKey) return res.status(400).json({ success: false, message: "缺少 intentKey（前端幂等键）" });

    // ✅ 登录手机号（关键：用于 customerPhone，保证“我的订单”能查到）
    let loginPhoneRaw = String(user?.phone || "").trim();
    if (!loginPhoneRaw && user?._id) {
      const u = await User.findById(user._id).select("phone").lean();
      loginPhoneRaw = String(u?.phone || "").trim();
    }
    const loginPhone10 = normPhone(loginPhoneRaw);

    const s = payload.shipping || {};
        // ✅ 订单备注统一入口：支持 顶层 remark/note + shipping.note（用于后台订单/贴纸）
    const orderNote = String(
      payload?.remark ??
        payload?.note ??
        s?.remark ??
        s?.note ??
        ""
    ).trim();
    if (!s.firstName || !s.lastName || !s.phone || !s.street1 || !s.city || !s.state || !s.zip) {
      return res.status(400).json({ success: false, message: "收货信息不完整" });
    }
    if (typeof s.lat !== "number" || typeof s.lng !== "number") {
      return res.status(400).json({ success: false, message: "缺少坐标（请从 Places 下拉选择地址）" });
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return res.status(400).json({ success: false, message: "items 不能为空" });

    const hasNonDeal = items.some((it) => !isDealLike(it));
    if ((payload.mode || payload.deliveryMode) === "dealsDay" && hasNonDeal) {
      return res.status(400).json({ success: false, message: "爆品日订单只能包含爆品商品" });
    }

    const totals = computeTotalsFromPayload(payload, {
  payChannel: "stripe",
  taxRateNY: Number(process.env.NY_TAX_RATE || 0.08875),
  platformRate: 0.02,
  platformFixed: 0.5,
});
    if (!totals.totalAmount || totals.totalAmount <= 0) {
      return res.status(400).json({ success: false, message: "金额异常" });
    }
    if (totals.totalAmount < 0.5) {
      return res.status(400).json({ success: false, message: "信用卡支付最低 $0.50，请增加金额或改用钱包" });
    }

    // 最低消费
    const mode = String(payload.mode || payload.deliveryMode || "normal").trim();
    if ((mode === "groupDay" || mode === "normal") && totals.subtotal < 49.99) {
      return res.status(400).json({ success: false, message: "未满足最低消费 $49.99，无法下单" });
    }
    if (mode === "friendGroup" && totals.subtotal < 29) {
      return res.status(400).json({ success: false, message: "未满足好友拼单最低消费 $29，无法下单" });
    }

    // deliveryType / deliveryDate 必须
    const deliveryType = String(payload.deliveryType || "home").trim();
    const deliveryDate = payload.deliveryDate ? startOfDay(new Date(payload.deliveryDate)) : null;
    if (!deliveryType || !deliveryDate || Number.isNaN(deliveryDate.getTime())) {
      return res.status(400).json({ success: false, message: "缺少 deliveryType / deliveryDate" });
    }

    // zone/fulfillment/dispatch（可选但建议写）
    const { zoneKey, zoneName } = await resolveZoneFromPayload(payload, s);
    const batchKey = zoneKey ? buildBatchKey(deliveryDate, zoneKey) : "";

    const fulfillment = zoneKey
      ? { groupType: "zone_group", zoneId: zoneKey, batchKey, batchName: zoneName || "" }
      : { groupType: "none", zoneId: "", batchKey: "", batchName: "" };

    const dispatch = zoneKey
      ? { zoneId: zoneKey, batchKey, batchName: zoneName || "" }
      : { zoneId: "", batchKey: "", batchName: "" };

    // ---------- 2.1 查找幂等订单 ----------
    let doc = await Order.findOne({
      userId: user._id,
      "payment.method": "stripe",
      "payment.idempotencyKey": intentKey,
      "payment.status": "unpaid",
    }).catch(() => null);

    // 如果已存在 intentId：直接返回（前端可用 intentId 重新取 clientSecret 或走 confirm）
    if (doc?.payment?.stripe?.intentId) {
      return res.json({
        success: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        clientSecret: "",
        paymentIntentId: doc.payment.stripe.intentId,
        reused: true,
      });
    }

    // ---------- 2.2 创建订单 ----------
    if (!doc) {
      doc = await Order.create({
        orderNo: genOrderNo(),

        // ✅ 必须绑定 userId
        userId: user._id,

        customerName: [s.firstName, s.lastName].filter(Boolean).join(" ").trim(),

        // ✅ 关键修复：归属手机号用登录手机号（没有就 fallback 收货手机号）
        customerPhone: (loginPhone10 || normPhone(s.phone) || String(s.phone || "")).trim(),

        deliveryType,
        deliveryMode: mode,
        deliveryDate,

        fulfillment,
        dispatch,

        // 地址
        addressText: s.fullText || [s.street1, s.apt, s.city, s.state, s.zip].filter(Boolean).join(", "),
               note: orderNote,
        address: {
          fullText: s.fullText || "",
          zip: s.zip || "",
          zoneId: zoneKey || "",
          lat: s.lat,
          lng: s.lng,
        },

        // 金额（严格对齐 model）
        subtotal: totals.subtotal,
        deliveryFee: totals.shipping,
        taxableSubtotal: totals.taxableSubtotal,
        salesTaxRate: totals.taxRate,
        salesTax: totals.salesTax,
        platformFee: totals.platformFee,
        tipFee: totals.tipFee,
        discount: 0,
        totalAmount: totals.totalAmount,

        // 支付块（严格对齐 model）
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

          stripe: { intentId: "", paid: 0 },
          wallet: { paid: 0 },
          zelle: { paid: 0 },
        },

        status: "pending",

        items: items.map((it) => ({
          productId: mongoose.Types.ObjectId.isValid(String(it.productId || "")) ? it.productId : undefined,
          legacyProductId: String(it.legacyProductId || it.id || it._id || ""),
          name: it.name || "",
          sku: it.sku || "",
          price: safeNum(it.price, 0),
          qty: Math.max(1, safeNum(it.qty, 1)),
          image: it.image || "",
          lineTotal: round2(safeNum(it.price, 0) * Math.max(1, safeNum(it.qty, 1))),
          cost: safeNum(it.cost, 0),
          hasTax: isTruthy(it.taxable) || isTruthy(it.hasTax),
        })),
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
        // ✅ 这里必须用反引号，不然你会直接语法错误
        idempotencyKey: `fb_pi_${intentKey}__${cents}`,
      }
    );

    // 写回 intentId
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

// =========================
// ✅ 2.9 前端支付成功后立即确认（强烈建议前端调用）
// POST /api/pay/stripe/confirm
// body: { orderId, paymentIntentId, paidCents? }
// =========================
router.post("/confirm", requireLogin, express.json(), async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe 未初始化（缺少 STRIPE_SECRET_KEY）" });
    }

    const orderId = String(req.body?.orderId || "").trim();
    const paymentIntentId = String(req.body?.paymentIntentId || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "orderId 无效" });
    }
    if (!paymentIntentId) {
      return res.status(400).json({ success: false, message: "paymentIntentId required" });
    }

    const doc = await Order.findById(orderId);
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    // ✅ 权限：只能确认自己的订单（或 admin）
    const uid = String(req.user?._id || req.user?.id || "");
    if (doc.userId && String(doc.userId) !== uid && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "无权限" });
    }

    // 已 paid 幂等
    if (doc.status === "paid" || doc.payment?.status === "paid") {
      return res.json({ success: true, message: "already paid", orderNo: doc.orderNo });
    }

    // 查询 Stripe 真相（更可靠）
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!pi) return res.status(400).json({ success: false, message: "paymentIntent not found" });

    if (String(pi.status) !== "succeeded") {
      return res.status(400).json({ success: false, message: `payment not succeeded: ${pi.status}` });
    }

    const paid = centsToMoney(pi.amount_received || pi.amount || 0);

    // ✅ 标记 paid（严格对齐 model）
    const now = new Date();
    doc.status = "paid";
    doc.paidAt = now;

    doc.payment = doc.payment || {};
    doc.payment.status = "paid";
    doc.payment.method = "stripe";
    doc.payment.paidTotal = round2(paid);

    doc.payment.stripe = doc.payment.stripe || {};
    doc.payment.stripe.intentId = String(pi.id);
    doc.payment.stripe.paid = round2(paid);

    await doc.save();

    return res.json({
      success: true,
      message: "paid",
      orderId: String(doc._id),
      orderNo: doc.orderNo,
      totalAmount: doc.totalAmount,
      payment: doc.payment,
    });
  } catch (err) {
    console.error("POST /api/pay/stripe/confirm error:", err);
    return res.status(500).json({ success: false, message: err?.message || "confirm failed" });
  }
});

// =========================
// 3) Webhook：支付成功后改 paid（兜底）
// ⚠️ 注意：此路由必须拿到 raw body，且不要被全局 express.json 提前吃掉
// =========================
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
          "payment.paidTotal": round2(paid),
          "payment.stripe.intentId": String(pi.id),
          "payment.stripe.paid": round2(paid),
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

      await Order.updateOne(q, { $set: { "payment.status": "unpaid" } });

      console.warn("⚠️ webhook failed:", { pi: pi.id, orderId: orderId || null, intentKey: intentKey || null });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("stripe webhook error:", err);
    return res.status(500).send("webhook handler error");
  }
});

export default router;
