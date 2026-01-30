// backend/src/routes/pay_stripe.js
import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";
import crypto from "crypto";

import Order from "../models/order.js";
import User from "../models/user.js";
import Zone from "../models/Zone.js";
import Product from "../models/product.js";
import { requireLogin } from "../middlewares/auth.js";
import { computeTotalsFromPayload, calcSpecialLineTotal } from "../utils/checkout_pricing.js";

// ✅ Stripe Idempotency-Key 必须 1~255 字符：超长就压缩成固定短串
function normalizeIdempotencyKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "ik_" + crypto.randomUUID();
  if (s.length <= 255) return s;
  const hash = crypto.createHash("sha256").update(s).digest("hex"); // 64 chars
  return "ik_" + hash; // 永远 < 255
}

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!STRIPE_SECRET_KEY) console.warn("⚠️ STRIPE_SECRET_KEY 未设置，Stripe 接口将不可用");

// 你项目里也有 2023-10-16 的 webhook 文件，这里保持 2024-06-20 不冲突
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" }) : null;

// ✅ NY 税率（可用环境变量覆盖）
const NY_TAX_RATE = Number(process.env.NY_TAX_RATE || 0.08875);

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

/**
 * ✅ 给 items 补齐：
 * - deposit（每个基础单位押金）
 * - unitCount（规格倍数）
 * - specialQty / specialTotalPrice（✅支持 specialQty=1 单件特价）
 *
 * 说明：Stripe 这条链路前端常不带 deposit/special，所以必须补齐
 */
async function hydrateItemsWithDeposit(items = []) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return arr;

  // 收集 productId（同时兼容 ObjectId + 自定义 id）
  const rawIds = arr
    .map((it) => String(it?.productId || it?._id || it?.id || "").trim())
    .filter(Boolean);

  const mongoIds = rawIds.filter((x) => mongoose.Types.ObjectId.isValid(x));
  const customIds = rawIds.filter((x) => x && !mongoose.Types.ObjectId.isValid(x));

  if (!mongoIds.length && !customIds.length) return arr;

  const pdocs = await Product.find({
    $or: [
      mongoIds.length ? { _id: { $in: mongoIds } } : null,
      customIds.length ? { id: { $in: customIds } } : null,
    ].filter(Boolean),
  })
    .select(
      "id deposit bottleDeposit containerDeposit crv " +
        "specialEnabled specialQty specialTotalPrice specialPrice " +
        "dealQty dealTotalPrice dealPrice " +
        "variants"
    )
    .lean();

  const pmap = new Map();
  for (const p of pdocs) {
    pmap.set(String(p._id), p);
    if (p.id) pmap.set(String(p.id), p);
  }

  return arr.map((it) => {
    const pid = String(it?.productId || it?._id || it?.id || "").trim();
    const p = pmap.get(pid);
    if (!p) return it;

    // 单个押金（优先 bottle/container，再 fallback deposit/crv）
    const depositEach = safeNum(p.bottleDeposit ?? p.containerDeposit ?? p.deposit ?? p.crv ?? 0, 0);

    // unitCount：有 variantKey 就从 variants 里取，否则默认 1
    const variantKey = String(it?.variantKey || it?.variant || "single").trim() || "single";
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const v = variants.find((x) => String(x?.key || "").trim() === variantKey && x?.enabled !== false);
    const unitCount = Math.max(1, Math.floor(Number(v?.unitCount || it?.unitCount || 1)));

    // ✅ 特价：先用 product 根字段
    let specialQty = safeNum(p.specialQty ?? p.dealQty ?? 0, 0);
    let specialTotalPrice = safeNum(
      p.specialTotalPrice ?? p.specialPrice ?? p.dealTotalPrice ?? p.dealPrice ?? 0,
      0
    );

    // ✅ 再用 variant 覆盖（如果未来 variant 也配置特价）
    const vSpecialQty = safeNum(v?.specialQty ?? v?.dealQty ?? 0, 0);
    const vSpecialTotal = safeNum(
      v?.specialTotalPrice ?? v?.specialPrice ?? v?.dealTotalPrice ?? v?.dealPrice ?? 0,
      0
    );
    if ((vSpecialQty === 1 || vSpecialQty >= 2) && vSpecialTotal > 0) {
      specialQty = vSpecialQty;
      specialTotalPrice = vSpecialTotal;
    }

    // ✅ 无效特价清零（✅支持 specialQty=1 单件特价）
    specialQty = Math.max(0, Math.floor(Number(specialQty || 0)));
    specialTotalPrice = round2(Math.max(0, Number(specialTotalPrice || 0)));

    const okSpecial =
      (specialQty === 1 && specialTotalPrice > 0) || (specialQty >= 2 && specialTotalPrice > 0);

    if (!okSpecial) {
      specialQty = 0;
      specialTotalPrice = 0;
    }

    return {
      ...it,
      variantKey,
      unitCount,
      deposit: round2(depositEach),
      specialQty,
      specialTotalPrice,
    };
  });
}

// =========================
// zone 解析（可选，给派单/路线用）
// =========================
async function resolveZoneFromPayload(payload, shipping) {
  const zoneId = String(payload?.zoneId || payload?.zoneKey || shipping?.zoneId || shipping?.address?.zoneId || "").trim();
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
// 0) ping
// =========================
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "pay_stripe", ts: new Date().toISOString() });
});

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

    // 幂等：已支付直接返回
    if (doc.status === "paid" || doc.payment?.status === "paid") {
      return res.json({ success: true, message: "already paid", orderNo: doc.orderNo });
    }

    const total = Number(doc.totalAmount || 0);
    const walletPaid = Number(doc.payment?.wallet?.paid || 0);
    const stripePaid = Number(doc.payment?.stripe?.paid || 0);
    const remaining = round2(total - walletPaid - stripePaid);

    if (!Number.isFinite(remaining) || remaining <= 0) {
      return res.status(400).json({ success: false, message: `无需 Stripe（remaining=${remaining}）` });
    }

    // Stripe 最低 $0.50
    if (remaining < 0.5) {
      return res.status(400).json({ success: false, message: "Stripe 最低 $0.50，请改用纯钱包或增加金额" });
    }

    // ✅ 幂等：如果已有 intentId，直接复用
    const existingIntentId = String(doc.payment?.stripe?.intentId || "").trim();
    if (existingIntentId) {
      let clientSecret = "";
      try {
        const pi = await stripe.paymentIntents.retrieve(existingIntentId);
        clientSecret = String(pi?.client_secret || "");
      } catch (e) {
        console.warn("⚠️ retrieve existing PI failed:", existingIntentId, e?.message);
      }

      if (!clientSecret) {
        return res.status(500).json({
          success: false,
          message: "已存在 PaymentIntent，但 clientSecret 读取失败",
          paymentIntentId: existingIntentId,
          reused: true,
          remaining,
        });
      }

      return res.json({
        success: true,
        reused: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        paymentIntentId: existingIntentId,
        clientSecret,
        remaining,
      });
    }

    const cents = moneyToCents(remaining);

    // ✅ Stripe 幂等键：同订单同金额复用
    const rawIdem = `fb_exist_order_${String(doc._id)}__${cents}`;
    const idemKey = normalizeIdempotencyKey(rawIdem);

    const intent = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          orderId: String(doc._id),
          orderNo: String(doc.orderNo),
          userId: String(doc.userId || ""),
          intentKey: String(doc.payment?.intentKey || doc.payment?.idempotencyKey || ""),
          amountCents: String(cents),
          source: "intent-for-order",
        },
      },
      { idempotencyKey: idemKey }
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
        message:
          "钱包/混合支付请先调用 /api/orders/checkout，然后用 /api/pay/stripe/intent-for-order 创建剩余款的 Stripe intent",
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
    // ✅ 订单备注统一入口
    const orderNote = String(payload?.remark ?? payload?.note ?? s?.remark ?? s?.note ?? "").trim();

    if (!s.firstName || !s.lastName || !s.phone || !s.street1 || !s.city || !s.state || !s.zip) {
      return res.status(400).json({ success: false, message: "收货信息不完整" });
    }
    if (typeof s.lat !== "number" || typeof s.lng !== "number") {
      return res.status(400).json({ success: false, message: "缺少坐标（请从 Places 下拉选择地址）" });
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return res.status(400).json({ success: false, message: "items 不能为空" });

    // ✅ Stripe 计算前补齐押金/整箱倍数/特价
    payload.items = await hydrateItemsWithDeposit(items);

    const mode = String(payload.mode || payload.deliveryMode || "normal").trim();

    const hasNonDeal = (payload.items || []).some((it) => !isDealLike(it));
    if (mode === "dealsDay" && hasNonDeal) {
      return res.status(400).json({ success: false, message: "爆品日订单只能包含爆品商品" });
    }

    // ✅ items 统一成 computeTotalsFromPayload 需要的口径
    const cleanItems = (payload.items || []).map((it) => {
      const qty = Math.max(1, Math.floor(safeNum(it.qty, 1)));
      const unitCount = Math.max(1, Math.floor(safeNum(it.unitCount ?? it.unitCount ?? 1, 1)));
      const depositEach = safeNum(it.deposit ?? it.bottleDeposit ?? it.crv ?? 0, 0);

      return {
        ...it,
        qty,
        unitCount,
        deposit: round2(depositEach),
        taxable: isTruthy(it.taxable) || isTruthy(it.hasTax),
        hasTax: isTruthy(it.taxable) || isTruthy(it.hasTax),

        // ✅ 保底：特价字段必须是 number
        specialQty: Math.max(0, Math.floor(safeNum(it.specialQty, 0))),
        specialTotalPrice: round2(safeNum(it.specialTotalPrice, 0)),
      };
    });

    const totals = computeTotalsFromPayload(
      {
        ...payload,
        items: cleanItems,
        shipping: s,
        mode,
      },
      {
        payChannel: "stripe",
        taxRateNY: NY_TAX_RATE,
        platformRate: 0.02,
        platformFixed: 0.5,
      }
    );

    if (!totals.totalAmount || totals.totalAmount <= 0) {
      return res.status(400).json({ success: false, message: "金额异常" });
    }
    if (totals.totalAmount < 0.5) {
      return res.status(400).json({ success: false, message: "信用卡支付最低 $0.50，请增加金额或改用钱包" });
    }

    // 最低消费（按你原规则）
    if ((mode === "groupDay" || mode === "normal") && totals.subtotal < 49.99) {
      return res.status(400).json({ success: false, message: "未满足最低消费 $49.99，无法下单" });
    }
    if (mode === "friendGroup" && totals.subtotal < 29) {
      return res.status(400).json({ success: false, message: "未满足好友拼单最低消费 $29，无法下单" });
    }

    // deliveryType / deliveryDate
    const deliveryType = String(payload.deliveryType || "home").trim();
    const deliveryDate = payload.deliveryDate ? startOfDay(new Date(payload.deliveryDate)) : null;
    if (!deliveryType || !deliveryDate || Number.isNaN(deliveryDate.getTime())) {
      return res.status(400).json({ success: false, message: "缺少 deliveryType / deliveryDate" });
    }

    // zone/fulfillment/dispatch
    const { zoneKey, zoneName } = await resolveZoneFromPayload(payload, s);
    const batchKey = zoneKey ? buildBatchKey(deliveryDate, zoneKey) : "";

    const fulfillment = zoneKey
      ? { groupType: "zone_group", zoneId: zoneKey, batchKey, batchName: zoneName || "" }
      : { groupType: "none", zoneId: "", batchKey: "", batchName: "" };

    const dispatch = zoneKey
      ? { zoneId: zoneKey, batchKey, batchName: zoneName || "" }
      : { zoneId: "", batchKey: "", batchName: "" };

    // ---------- 2.1 查找幂等订单（只复用未 paid 的） ----------
    let doc = await Order.findOne({
      userId: user._id,
      "payment.method": "stripe",
      "payment.idempotencyKey": intentKey,
      status: { $ne: "paid" },
    }).catch(() => null);

    // ✅ 如果已存在 intentId：返回 clientSecret（Payment Element 需要）
    if (doc?.payment?.stripe?.intentId) {
      const intentId = String(doc.payment.stripe.intentId || "").trim();

      let clientSecret = "";
      try {
        const pi = await stripe.paymentIntents.retrieve(intentId);
        clientSecret = String(pi?.client_secret || "");
      } catch (e) {
        console.warn("⚠️ retrieve existing PaymentIntent failed:", intentId, e?.message);
      }

      if (!clientSecret) {
        return res.status(500).json({
          success: false,
          message: "已存在 PaymentIntent，但 clientSecret 读取失败（请稍后重试或联系管理员）",
          paymentIntentId: intentId,
          reused: true,
        });
      }

      return res.json({
        success: true,
        orderId: String(doc._id),
        orderNo: doc.orderNo,
        clientSecret,
        paymentIntentId: intentId,
        reused: true,
      });
    }

    // ---------- 2.2 创建订单 ----------
    if (!doc) {
      doc = await Order.create({
        orderNo: genOrderNo(),
        userId: user._id,

        customerName: [s.firstName, s.lastName].filter(Boolean).join(" ").trim(),
        customerPhone: (loginPhone10 || normPhone(s.phone) || String(s.phone || "")).trim(),

        deliveryType,
        deliveryMode: mode,
        deliveryDate,

        fulfillment,
        dispatch,

        addressText: s.fullText || [s.street1, s.apt, s.city, s.state, s.zip].filter(Boolean).join(", "),
        note: orderNote,
        address: {
          fullText: s.fullText || "",
          zip: s.zip || "",
          zoneId: zoneKey || "",
          lat: s.lat,
          lng: s.lng,
        },

        // 金额（对齐 model）
        subtotal: totals.subtotal,
        deliveryFee: totals.shipping,
        taxableSubtotal: totals.taxableSubtotal,
        salesTaxRate: totals.taxRate,
        salesTax: totals.salesTax,
        depositTotal: totals.depositTotal,
        platformFee: totals.platformFee,
        tipFee: totals.tipFee,
        discount: 0,
        totalAmount: totals.totalAmount,

        // 支付块（对齐 model）
        payment: {
          status: "unpaid",
          method: "stripe",
          paidTotal: 0,
          idempotencyKey: intentKey,

          amountSubtotal: totals.subtotal,
          amountDeliveryFee: totals.shipping,
          amountTax: totals.salesTax,
          amountDeposit: totals.depositTotal,
          amountPlatformFee: totals.platformFee,
          amountTip: totals.tipFee,
          amountDiscount: 0,
          amountTotal: totals.totalAmount,

          stripe: { intentId: "", paid: 0 },
          wallet: { paid: 0 },
          zelle: { paid: 0 },
        },

        status: "pending",

        items: cleanItems.map((it) => ({
          // 只在是 ObjectId 时写 productId，否则留空，用 legacyProductId 存自定义 id
          productId: mongoose.Types.ObjectId.isValid(String(it.productId || "")) ? it.productId : undefined,
          legacyProductId: String(it.legacyProductId || it.id || it._id || it.productId || ""),
          name: it.name || "",
          sku: it.sku || "",
          price: safeNum(it.price, 0),
          qty: Math.max(1, safeNum(it.qty, 1)),

          unitCount: Math.max(1, safeNum(it.unitCount, 1)),
          deposit: round2(safeNum(it.deposit, 0)),

          // ✅✅✅ 特价字段落库（支持 specialQty=1）
          specialQty: Math.max(0, Math.floor(safeNum(it.specialQty, 0))),
          specialTotalPrice: round2(safeNum(it.specialTotalPrice, 0)),

          image: it.image || "",

          // ✅ lineTotal 按统一口径（checkout_pricing.js）
          lineTotal: calcSpecialLineTotal(it, Math.max(1, safeNum(it.qty, 1))),

          cost: safeNum(it.cost, 0),
          hasTax: isTruthy(it.taxable) || isTruthy(it.hasTax),
          taxable: isTruthy(it.taxable) || isTruthy(it.hasTax),
        })),
      });

      // ✅ 仅用于排查：确认单件特价能进统一结算（subtotal 应该=3.98 而不是 4.99）
      const totalsCheck = computeTotalsFromPayload(
        {
          items: Array.isArray(doc.items) ? doc.items : [],
          shipping: s,
          mode: doc.deliveryMode,
          pricing: { tip: Number(doc.tipFee || 0), taxRate: Number(doc.salesTaxRate || 0) },
        },
        { payChannel: "stripe", taxRateNY: NY_TAX_RATE, platformRate: 0.02, platformFixed: 0.5 }
      );

      console.log("🧾 totals check:", {
        orderId: String(doc._id),
        totalAmount: totalsCheck.totalAmount,
        depositTotal: totalsCheck.depositTotal,
        salesTax: totalsCheck.salesTax,
        shipping: totalsCheck.shipping,
        subtotal: totalsCheck.subtotal,
        items: (doc.items || []).map((it) => ({
          name: it.name,
          qty: it.qty,
          price: it.price,
          specialQty: it.specialQty,
          specialTotalPrice: it.specialTotalPrice,
          line: calcSpecialLineTotal(it, it.qty),
        })),
      });
    }

    // ---------- 2.3 创建 PaymentIntent ----------
    const cents = moneyToCents(totals.totalAmount);

    // ✅ Stripe 幂等键：只绑定“这张订单 + 这次金额”
    const rawIdem = `fb_pi_order_${String(doc._id)}__${cents}`;
    const idemKey = normalizeIdempotencyKey(rawIdem);

    const intent = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          orderId: String(doc._id),
          orderNo: String(doc.orderNo),
          userId: String(user._id),
          intentKey: String(intentKey),
          amountCents: String(cents),
          source: "order-intent",
        },
      },
      { idempotencyKey: idemKey }
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
// body: { orderId, paymentIntentId }
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

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!pi) return res.status(400).json({ success: false, message: "paymentIntent not found" });

    if (String(pi.status) !== "succeeded") {
      return res.status(400).json({ success: false, message: `payment not succeeded: ${pi.status}` });
    }

    const paid = centsToMoney(pi.amount_received || pi.amount || 0);

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
    doc.payment.stripePaymentIntentId = String(pi.id);

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
// ⚠️ 注意：此路由必须拿到 raw body
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
            $or: [{ "payment.stripe.intentId": String(pi.id) }, { "payment.idempotencyKey": intentKey }],
          };

      await Order.updateOne(q, {
        $set: {
          status: "paid",
          paidAt: new Date(),
          "payment.status": "paid",
          "payment.method": "stripe",
          "payment.paidTotal": round2(paid),
          "payment.stripe.intentId": String(pi.id),
          "payment.stripePaymentIntentId": String(pi.id),
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
            $or: [{ "payment.stripe.intentId": String(pi.id) }, { "payment.idempotencyKey": intentKey }],
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
