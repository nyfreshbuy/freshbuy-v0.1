// backend/src/routes/orders.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js";
import User from "../models/user.js";
import Zone from "../models/Zone.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🚀 orders.js (MongoDB版, MODEL-ALIGNED) 已加载");

// =========================
// ping
// =========================
router.get("/ping", (req, res) => res.json({ ok: true, name: "orders" }));

router.get("/checkout/ping", (req, res) => {
  res.json({ ok: true, from: "orders.js", hasCheckout: true, time: new Date().toISOString() });
});

// =========================
// ✅ NY 税率（可用环境变量覆盖）
// =========================
const NY_TAX_RATE = Number(process.env.NY_TAX_RATE || 0.08875);

// =========================
// 工具
// =========================
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

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function safeNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function genOrderNo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `FB${y}${m}${day}-${rand}`;
}

function toYMD(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setDate(x.getDate() + n);
  return x;
}

function buildBatchKey(deliveryDate, zoneKey) {
  const ymd = toYMD(deliveryDate);
  return `${ymd}|zone:${String(zoneKey || "").trim()}`;
}

// ===== 工具：爆品判断 =====
function isSpecialItem(it) {
  if (!it) return false;
  if (it.isSpecial || it.isDeal) return true;

  const tag = String(it.tag || "").trim();
  const type = String(it.type || "").toLowerCase();
  const name = String(it.name || "");

  if (tag.includes("爆品")) return true;
  if (type === "hot") return true;
  if (name.includes("爆品")) return true;
  return false;
}

// ✅ 后端 geocode（需要 GOOGLE_MAPS_SERVER_KEY）
// Node 18+ 有 fetch；如果你低版本需要自己引入 node-fetch
async function geocodeIfNeeded(addressText) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(addressText) +
    "&key=" +
    encodeURIComponent(key);

  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status !== "OK" || !data.results?.[0]) return null;

  const first = data.results[0];
  const loc = first.geometry?.location;

  return {
    fullText: first.formatted_address || addressText,
    lat: Number(loc?.lat),
    lng: Number(loc?.lng),
  };
}

/**
 * ✅ 统一解析 “mode / deliveryMode”
 */
function pickMode(body) {
  const raw = body?.mode ?? body?.deliveryMode ?? body?.delivery_mode ?? "";
  return String(raw || "").trim();
}

/**
 * ✅ deliveryDate 统一计算
 */
function resolveDeliveryDate(mode, deliveryDate) {
  const input = deliveryDate ? startOfDay(deliveryDate) : null;

  if (mode === "groupDay") {
    if (!input) {
      const e = new Error("groupDay 必须传 deliveryDate（区域团固定配送日）");
      e.status = 400;
      throw e;
    }
    return input;
  }

  if (input) return input;
  const tomorrow = addDays(new Date(), 1);
  return startOfDay(tomorrow);
}

/**
 * ✅ 统一解析 zone
 */
async function resolveZoneFromPayload({ zoneId, ship, zip }) {
  const z0 = String(zoneId || ship?.zoneId || ship?.address?.zoneId || ship?.zone || "").trim();
  if (z0) return { zoneKey: z0, zoneName: "" };

  const z = String(zip || "").trim();
  if (!z) return { zoneKey: "", zoneName: "" };

  const doc =
    (await Zone.findOne({ zips: z }).select("key name zoneId code").lean()) ||
    (await Zone.findOne({ zipWhitelist: z }).select("key name zoneId code").lean());

  if (!doc) return { zoneKey: "", zoneName: "" };

  const zoneKey = String(doc.key || doc.code || doc.zoneId || "").trim();
  const zoneName = String(doc.name || "").trim();
  return { zoneKey, zoneName };
}

/**
 * ✅ 构建订单（与 Order Model 对齐）
 * - payment.status 只能是 unpaid/paid/refunded
 * - payment.method 只能是 stripe/wallet/zelle（可不填）
 */
async function buildOrderPayload(req) {
  const body = req.body || {};
  const mode = pickMode(body);

  const { items, receiver, shipping, zoneId, deliveryDate, tip, tipAmount } = body;
  const ship = shipping || receiver || {};

  if (!["dealsDay", "groupDay", "normal", "friendGroup"].includes(mode)) {
    const e = new Error("mode 不合法（请传 mode 或 deliveryMode）");
    e.status = 400;
    throw e;
  }

  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("items 不能为空");
    e.status = 400;
    throw e;
  }

  // 收货信息字段兼容
  const contactName =
    (ship.name || ship.fullName || ship.contactName || "").trim() ||
    [ship.firstName, ship.lastName].filter(Boolean).join(" ").trim();

  const contactPhone = String(ship.contactPhone || ship.phone || "").trim();

  const addressText =
    String(
      ship.address ||
        ship.fullText ||
        ship.formattedAddress ||
        ship.address1 ||
        ship.addressLine ||
        ""
    ).trim() ||
    [ship.street1, ship.apt, ship.city, ship.state, ship.zip].filter(Boolean).join(", ").trim();

  if (!contactName || !contactPhone || !addressText) {
    const e = new Error("收货信息不完整（姓名/电话/地址）");
    e.status = 400;
    throw e;
  }

  // 坐标：优先前端，否则后台 geocode（可选）
  let lat =
    typeof ship.lat === "number"
      ? ship.lat
      : Number.isFinite(Number(ship.lat))
      ? Number(ship.lat)
      : null;
  let lng =
    typeof ship.lng === "number"
      ? ship.lng
      : Number.isFinite(Number(ship.lng))
      ? Number(ship.lng)
      : null;
  let fullText = String(ship.fullText || ship.formattedAddress || addressText).trim();

  if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
    const g = await geocodeIfNeeded(addressText);
    if (!g) {
      const e = new Error("地址无法解析（无法生成坐标），请检查地址是否正确");
      e.status = 400;
      throw e;
    }
    lat = g.lat;
    lng = g.lng;
    fullText = g.fullText;
  }

  // ✅ userId 强制存在
  const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
  if (!userId) {
    const e = new Error("未登录或用户信息异常（无法解析 userId）");
    e.status = 401;
    throw e;
  }

  // ✅ 登录手机号补齐（避免 token 没 phone）
  let loginPhoneRaw = String(req.user?.phone || "").trim();
  if (!loginPhoneRaw) {
    const u = await User.findById(userId).select("phone").lean();
    loginPhoneRaw = String(u?.phone || "").trim();
  }
  const loginPhone10 = normPhone(loginPhoneRaw);
  const shipPhone10 = normPhone(contactPhone);

  // 整理 items + 计算 subtotal
  let subtotal = 0;
  const cleanItems = items.map((it, idx) => {
    const qty = Number(it.qty || 1);
    const price = Number(it.priceNum ?? it.price ?? 0);

    if (!it.name || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty < 1) {
      const e = new Error(`第 ${idx + 1} 个商品数据不合法`);
      e.status = 400;
      throw e;
    }

    const legacyId = String(it.legacyProductId || it.id || it._id || "").trim();

    let productId;
    const maybeMongoId = String(it.productId || it._id || "").trim();
    if (maybeMongoId && mongoose.Types.ObjectId.isValid(maybeMongoId)) {
      productId = new mongoose.Types.ObjectId(maybeMongoId);
    }

    const lineTotal = round2(price * qty);
    subtotal += lineTotal;

    return {
      productId,
      legacyProductId: legacyId || "",
      name: String(it.name || ""),
      sku: it.sku ? String(it.sku) : "",
      price: round2(price),
      qty: Math.floor(qty),
      image: it.image ? String(it.image) : "",
      lineTotal,
      cost: Number(it.cost || 0) || 0,
      hasTax: !!it.hasTax,
    };
  });

  subtotal = round2(subtotal);

  // 规则校验（保持你原规则）
  const hasSpecial = items.some((it) => isSpecialItem(it));
  const hasNonSpecial = items.some((it) => !isSpecialItem(it));

  if (mode === "dealsDay" && (hasNonSpecial || !hasSpecial)) {
    const e = new Error("dealsDay 只能包含爆品");
    e.status = 400;
    throw e;
  }

  if (mode === "groupDay" && hasSpecial && !hasNonSpecial) {
    const e = new Error("groupDay 不允许纯爆品订单（纯爆品请用 dealsDay）");
    e.status = 400;
    throw e;
  }

  if ((mode === "normal" || mode === "friendGroup") && hasSpecial) {
    const e = new Error(`${mode} 不应包含爆品`);
    e.status = 400;
    throw e;
  }

  if (mode === "normal" && subtotal < 49.99) {
    const e = new Error("未满足 $49.99 最低消费");
    e.status = 400;
    throw e;
  }
  if (mode === "friendGroup" && subtotal < 29) {
    const e = new Error("未满足 $29 最低消费");
    e.status = 400;
    throw e;
  }

  // 运费
  let deliveryFee = 0;
  if (mode === "dealsDay") deliveryFee = 0;
  else if (mode === "groupDay") deliveryFee = subtotal >= 49.99 ? 0 : 4.99;
  else if (mode === "friendGroup") deliveryFee = 4.99;
  else deliveryFee = 4.99;
  deliveryFee = round2(deliveryFee);

  // tip
  const tipRaw = tipAmount ?? tip ?? ship.tip ?? 0;
  const tipFee = round2(Math.max(0, safeNumber(tipRaw, 0)));

  // taxableSubtotal
  const taxableSubtotal = round2(
    cleanItems
      .filter((x) => x.hasTax === true)
      .reduce((sum, x) => sum + Number(x.lineTotal || 0), 0)
  );

  // tax
  const salesTax = round2(taxableSubtotal * NY_TAX_RATE);

  const discount = 0;

  // ✅ 平台费：只在需要 Stripe 时（后面 checkout 决定）
  const platformFee = 0;

  // ✅ 基础总额（不含平台费）
  const baseTotalAmount = round2(subtotal + deliveryFee + salesTax + tipFee - discount);

  // zone
  const zip = String(ship.zip || ship.postalCode || "").trim();
  const { zoneKey, zoneName } = await resolveZoneFromPayload({ zoneId, ship, zip });
  const z = String(zoneKey || "").trim();

  // deliveryDate + batch
  const finalDeliveryDate = resolveDeliveryDate(mode, deliveryDate);
  const batchKey = z ? buildBatchKey(finalDeliveryDate, z) : "";
  const fulfillment = z
    ? { groupType: "zone_group", zoneId: z, batchKey, batchName: zoneName || "" }
    : { groupType: "none", zoneId: "", batchKey: "", batchName: "" };

  // ✅ payment 快照（严格匹配 model）
  const paymentSnap = {
    status: "unpaid",
    // method 先不填（model enum 不允许 none）
    amountTotal: Number(baseTotalAmount || 0),
    paidTotal: 0,
    stripe: { intentId: "", paid: 0 },
    wallet: { paid: 0 },
    zelle: { paid: 0 },
    idempotencyKey: "",
    amountSubtotal: Number(subtotal || 0),
    amountDeliveryFee: Number(deliveryFee || 0),
    amountTax: Number(salesTax || 0),
    amountPlatformFee: 0,
    amountTip: Number(tipFee || 0),
    amountDiscount: Number(discount || 0),
  };

  const orderDoc = {
    orderNo: genOrderNo(),
    userId,

    // ✅ 归属手机号：优先登录手机号（关键）
    customerPhone: (loginPhone10 || shipPhone10 || String(contactPhone)).trim(),
    customerName: String(contactName).trim(),

    deliveryType: "home",
    deliveryMode: mode,
    deliveryDate: finalDeliveryDate,

    fulfillment,
    dispatch: z
      ? { zoneId: z, batchKey, batchName: zoneName || "" }
      : { zoneId: "", batchKey: "", batchName: "" },

    status: "pending",
    subtotal,
    deliveryFee,
    discount,
    totalAmount: Number(baseTotalAmount || 0),

    taxableSubtotal,
    salesTax,
    platformFee,
    tipFee,
    salesTaxRate: Number(NY_TAX_RATE || 0),

    payment: paymentSnap,

    addressText: String(addressText).trim(),
    note: ship.note ? String(ship.note).trim() : "",

    address: { fullText, zip, zoneId: z, lat, lng },

    items: cleanItems,
  };

  return { orderDoc, baseTotalAmount };
}

// =====================================================
// ✅ 我的订单（关键：自动认领包含 userId:null）
// GET /api/orders/my?limit=20&days=30&status=paid
// =====================================================
router.get("/my", requireLogin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const daysRaw = String(req.query.days || "30");
    const status = String(req.query.status || "").trim();

    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    // ✅ 补齐登录手机号
    let rawPhone = String(req.user?.phone || "").trim();
    if (!rawPhone) {
      const u = await User.findById(userId).select("phone").lean();
      rawPhone = String(u?.phone || "").trim();
    }
    const phone10 = normPhone(rawPhone);

    const phoneOr = [];
    if (rawPhone) phoneOr.push({ customerPhone: rawPhone });
    if (phone10) {
      phoneOr.push({ customerPhone: phone10 });
      phoneOr.push({ customerPhone: "1" + phone10 });
      phoneOr.push({ customerPhone: "+1" + phone10 });
      phoneOr.push({ customerPhone: { $regex: phone10 + "$" } });
    }

    // ✅ 自动认领：同时认领 userId 不存在 或 null
    if (phoneOr.length) {
      await Order.updateMany(
        {
          $and: [
            { $or: [{ userId: { $exists: false } }, { userId: null }] },
            { $or: phoneOr },
          ],
        },
        { $set: { userId } }
      );
    }

    // ✅ 查询：userId 为主，手机号为兼容兜底
    const q = { $or: [{ userId }] };
    if (phoneOr.length) q.$or.push(...phoneOr);

    if (status) q.status = status;

    if (daysRaw && daysRaw !== "all") {
      const days = Number(daysRaw);
      if (Number.isFinite(days) && days > 0) {
        q.createdAt = { $gte: new Date(Date.now() - days * 86400000) };
      }
    }

    const orders = await Order.find(q).sort({ createdAt: -1 }).limit(limit);

    return res.json({
      success: true,
      total: orders.length,
      orders: orders.map((o) => ({
        id: o._id.toString(),
        _id: o._id,
        orderNo: o.orderNo,
        status: o.status,
        deliveryType: o.deliveryType,

        deliveryMode: o.deliveryMode,
        fulfillment: o.fulfillment,

        totalAmount: o.totalAmount,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        salesTax: o.salesTax,
        platformFee: o.platformFee,
        tipFee: o.tipFee,
        taxableSubtotal: o.taxableSubtotal,

        payment: o.payment,
        deliveryDate: o.deliveryDate,

        createdAt: o.createdAt,
        itemsCount: Array.isArray(o.items) ? o.items.length : 0,
      })),
    });
  } catch (err) {
    console.error("GET /api/orders/my error:", err);
    return res.status(500).json({ success: false, message: "获取我的订单失败" });
  }
});

// =====================================================
// 1) 创建订单（不支付）
// POST /api/orders
// =====================================================
router.post("/", requireLogin, async (req, res) => {
  try {
    const { orderDoc } = await buildOrderPayload(req);
    const doc = await Order.create(orderDoc);

    return res.json({
      success: true,
      orderId: doc._id.toString(),
      orderNo: doc.orderNo,
      totalAmount: doc.totalAmount,
      payment: doc.payment,
      deliveryMode: doc.deliveryMode,
      fulfillment: doc.fulfillment,
      deliveryDate: doc.deliveryDate,
    });
  } catch (err) {
    console.error("POST /api/orders error:", err);
    return res
      .status(err?.status || 500)
      .json({ success: false, message: err?.message || "创建订单失败" });
  }
});

// =====================================================
// ✅ checkout：钱包优先，剩余走 Stripe（平台费只在需要 Stripe 时加）
// POST /api/orders/checkout
//
// 返回：remaining>0 表示需要 Stripe
// =====================================================
router.post("/checkout", requireLogin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    const { orderDoc, baseTotalAmount } = await buildOrderPayload(req);

    const baseTotal = Number(baseTotalAmount || 0);
    if (!Number.isFinite(baseTotal) || baseTotal <= 0) {
      return res.status(400).json({ success: false, message: "订单金额不合法" });
    }

    let created = null;
    let walletUsed = 0;
    let remaining = 0;
    let newBalance = 0;

    let finalTotal = round2(baseTotal);
    let platformFee = 0;
    let walletDeducted = false;

    await session.withTransaction(async () => {
      // 1) 钱包余额
      const u0 = await User.findById(userId).select("walletBalance").session(session);
      const balance0 = Number(u0?.walletBalance || 0);

      // 2) 先按 baseTotal 试算
      walletUsed = round2(Math.min(balance0, finalTotal));
      remaining = round2(finalTotal - walletUsed);

      // 3) 如果需要 Stripe，才收平台费 2%（按 subtotal）
      if (remaining > 0) {
        platformFee = round2(Number(orderDoc.subtotal || 0) * 0.02);
        finalTotal = round2(finalTotal + platformFee);

        walletUsed = round2(Math.min(balance0, finalTotal));
        remaining = round2(finalTotal - walletUsed);
      }

      // 4) 创建订单（✅ 创建时一律 unpaid，避免“假paid/错归类”）
      const docToCreate = {
        ...orderDoc,
        platformFee,
        totalAmount: finalTotal,
        status: "pending",
        paidAt: null,
        payment: {
          ...(orderDoc.payment || {}),

          // 金额快照
          amountPlatformFee: Number(platformFee || 0),
          amountTotal: Number(finalTotal || 0),

          // ✅ 创建时永远 unpaid（扣款成功后再更新）
          status: "unpaid",
          method: remaining > 0 ? "stripe" : "wallet",

          // ✅ 创建时不提前写已付
          paidTotal: 0,
          wallet: { paid: 0 },
          stripe: { intentId: "", paid: 0 },
        },
      };

      created = await Order.create([docToCreate], { session });
      created = created?.[0] || null;
      if (!created) throw new Error("创建订单失败");

      // 5) 钱包扣款（✅ 判断必须是 modifiedCount===1 才算成功）
      if (walletUsed > 0) {
        const upd = await User.updateOne(
          { _id: userId, walletBalance: { $gte: walletUsed } },
          { $inc: { walletBalance: -walletUsed } },
          { session }
        );

        if (upd.modifiedCount === 1) {
          walletDeducted = true;

          // ✅ 写回订单：钱包已付金额
          await Order.updateOne(
            { _id: created._id },
            {
              $set: {
                "payment.wallet.paid": Number(walletUsed || 0),
                "payment.paidTotal": Number(walletUsed || 0),
              },
            },
            { session }
          );
        } else {
          // 扣款失败：不扣钱包，全部走 Stripe
          walletDeducted = false;
          walletUsed = 0;
          remaining = round2(finalTotal);

          await Order.updateOne(
            { _id: created._id },
            {
              $set: {
                "payment.status": "unpaid",
                "payment.method": "stripe",
                "payment.paidTotal": 0,
                "payment.wallet.paid": 0,
              },
            },
            { session }
          );
        }
      }

      const u1 = await User.findById(userId).select("walletBalance").session(session);
      newBalance = Number(u1?.walletBalance || 0);

      // 6) 如果 remaining==0 且 钱包确实扣成功 => 标记已支付
      if (remaining <= 0 && walletDeducted === true) {
        const now = new Date();
        await Order.updateOne(
          { _id: created._id },
          {
            $set: {
              status: "paid",
              paidAt: now,
              "payment.status": "paid",
              "payment.method": "wallet",
              "payment.paidTotal": Number(walletUsed || 0),
              "payment.wallet.paid": Number(walletUsed || 0),
            },
          },
          { session }
        );
      }
    });

    const fresh = await Order.findById(created._id)
      .select(
        "payment status totalAmount orderNo deliveryMode fulfillment subtotal deliveryFee discount salesTax platformFee tipFee taxableSubtotal deliveryDate"
      )
      .lean();

    return res.json({
      success: true,
      orderId: created._id.toString(),
      orderNo: created.orderNo,
      totalAmount: round2(fresh?.totalAmount ?? finalTotal),
      walletUsed: round2(walletUsed),
      remaining: round2(remaining),
      paid: remaining <= 0 && (fresh?.status === "paid" || fresh?.payment?.status === "paid"),
      walletBalance: round2(newBalance),
      payment: fresh?.payment || created.payment,
      status: fresh?.status || created.status,
      deliveryMode: fresh?.deliveryMode || created.deliveryMode,
      fulfillment: fresh?.fulfillment || created.fulfillment,
      deliveryDate: fresh?.deliveryDate || created.deliveryDate,
    });
  } catch (err) {
    console.error("POST /api/orders/checkout error:", err);
    return res.status(err?.status || 400).json({ success: false, message: err?.message || "checkout failed" });
  } finally {
    session.endSession();
  }
});

// =====================================================
// ✅ Stripe 支付成功后确认（落库为 paid + 绑定 userId/phone）
// POST /api/orders/:id/confirm-stripe
// body: { intentId, paid }
// =====================================================
router.post("/:id([0-9a-fA-F]{24})/confirm-stripe", requireLogin, async (req, res) => {
  try {
    const orderId = req.params.id;
    const intentId = String(req.body?.intentId || req.body?.stripePaymentIntentId || "").trim();
    const stripePaid = Number(req.body?.paid ?? req.body?.stripePaid ?? 0);

    if (!intentId) return res.status(400).json({ success: false, message: "intentId required" });
    if (!Number.isFinite(stripePaid) || stripePaid <= 0) {
      return res.status(400).json({ success: false, message: "paid must be > 0" });
    }

    const doc = await Order.findById(orderId);
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    const uid = toObjectIdMaybe(req.user?.id || req.user?._id);

    // ✅ 绑定 userId（修复：信用卡单可能缺 userId）
    if (uid && !doc.userId) {
      doc.userId = uid;

      // 同步归属手机号为登录手机号
      let loginPhoneRaw = String(req.user?.phone || "").trim();
      if (!loginPhoneRaw) {
        const u = await User.findById(uid).select("phone").lean();
        loginPhoneRaw = String(u?.phone || "").trim();
      }
      const p10 = normPhone(loginPhoneRaw);
      if (p10) doc.customerPhone = p10;
    }

    // 权限检查（绑定后）
    if (uid && doc.userId && String(doc.userId) !== String(uid) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "无权限" });
    }

    // 幂等：已 paid 直接返回
    if (doc.payment?.status === "paid" || doc.status === "paid") {
      return res.json({ success: true, message: "already paid", orderNo: doc.orderNo });
    }

    const total = Number(doc.totalAmount || 0);
    const walletPaid = Number(doc.payment?.wallet?.paid || 0);

    const prevStripePaid = Number(doc.payment?.stripe?.paid || 0);
    const newStripePaid = round2(prevStripePaid + stripePaid);
    const paidTotal = round2(walletPaid + newStripePaid);

    if (paidTotal + 0.01 < total) {
      return res.status(400).json({
        success: false,
        message: `stripePaid 不足以覆盖剩余金额（paidTotal=${paidTotal}, total=${total}）`,
      });
    }

    const now = new Date();
    doc.status = "paid";
    doc.paidAt = now;

    doc.payment = {
      ...(doc.payment || {}),
      status: "paid",
      method: "stripe",
      paidTotal: round2(Math.min(paidTotal, total)),
      stripe: {
        intentId,
        paid: round2(Math.min(newStripePaid, total)),
      },
      wallet: {
        paid: round2(Math.min(walletPaid, total)),
      },
    };

    await doc.save();

    return res.json({
      success: true,
      message: "paid",
      orderId: doc._id.toString(),
      orderNo: doc.orderNo,
      totalAmount: doc.totalAmount,
      payment: doc.payment,
    });
  } catch (err) {
    console.error("POST /api/orders/:id/confirm-stripe error:", err);
    return res.status(500).json({ success: false, message: "confirm stripe failed" });
  }
});

// =====================================================
// 2) 未登录按手机号查订单
// GET /api/orders?phone=xxx
// =====================================================
router.get("/", async (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();
    if (!phone) return res.status(400).json({ success: false, message: "phone 不能为空" });

    const phone10 = normPhone(phone);

    const list = await Order.find({
      $or: [
        { customerPhone: phone },
        { customerPhone: phone10 },
        { customerPhone: { $regex: phone10 + "$" } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({
      success: true,
      total: list.length,
      list: list.map((o) => ({
        id: o._id.toString(),
        orderNo: o.orderNo,
        status: o.status,
        deliveryMode: o.deliveryMode,
        fulfillment: o.fulfillment,
        deliveryDate: o.deliveryDate,
        totalAmount: o.totalAmount,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        salesTax: o.salesTax,
        platformFee: o.platformFee,
        tipFee: o.tipFee,
        taxableSubtotal: o.taxableSubtotal,
        payment: o.payment,
        createdAt: o.createdAt,
      })),
    });
  } catch (err) {
    console.error("GET /api/orders error:", err);
    return res.status(500).json({ success: false, message: "获取订单失败" });
  }
});

// =====================================================
// 3) 订单详情
// GET /api/orders/:id
// =====================================================
router.get("/:id([0-9a-fA-F]{24})", async (req, res) => {
  try {
    const doc = await Order.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    return res.json({
      success: true,
      data: {
        id: doc._id.toString(),
        orderNo: doc.orderNo,
        customerName: doc.customerName,
        customerPhone: doc.customerPhone,
        deliveryType: doc.deliveryType,
        status: doc.status,
        deliveryMode: doc.deliveryMode,
        fulfillment: doc.fulfillment,
        dispatch: doc.dispatch,
        payment: doc.payment,
        subtotal: doc.subtotal,
        deliveryFee: doc.deliveryFee,
        discount: doc.discount,
        totalAmount: doc.totalAmount,
        taxableSubtotal: doc.taxableSubtotal,
        salesTax: doc.salesTax,
        platformFee: doc.platformFee,
        tipFee: doc.tipFee,
        addressText: doc.addressText,
        note: doc.note,
        address: doc.address,
        items: doc.items,
        driverId: doc.driverId,
        leaderId: doc.leaderId,
        deliveryDate: doc.deliveryDate,
        deliveredAt: doc.deliveredAt,
        settlementGenerated: doc.settlementGenerated,
        settlementId: doc.settlementId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    console.error("GET /api/orders/:id error:", err);
    return res.status(500).json({ success: false, message: "获取订单详情失败" });
  }
});

// =====================================================
// 4) 更新订单状态
// PATCH /api/orders/:id/status
// =====================================================
router.patch("/:id/status", async (req, res) => {
  try {
    const status = String(req.body?.status || "").trim().toLowerCase();
    const allowed = [
  "pending",
  "paid",
  "packing",
  "shipping",
  "delivering",
  "delivered",
  "done",
  "completed",
  "cancel",
  "cancelled",
];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "status 不合法" });
    }

    const doc = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    return res.json({ success: true, data: { id: doc._id.toString(), status: doc.status } });
  } catch (err) {
    console.error("PATCH /api/orders/:id/status error:", err);
    return res.status(500).json({ success: false, message: "更新状态失败" });
  }
});
// =====================================================
// ✅ Admin 更新订单状态（后台订单管理用）
// PATCH /api/admin/orders/:id/status
// =====================================================
router.patch("/admin/orders/:id/status", requireLogin, async (req, res) => {
  try {
    // ✅ 管理员权限
    if (req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "需要管理员权限" });
    }

    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "订单ID不合法" });
    }

    const status = String(req.body?.status || "").trim().toLowerCase();
    const allowed = [
      "pending",
      "paid",
      "packing",
      "shipping",
      "delivering",
      "delivered",
      "done",
      "completed",
      "cancel",
      "cancelled",
    ];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "status 不合法" });
    }

    const patch = { status };

    // ✅ 如果是送达类状态，顺便写 deliveredAt（避免右上角判断混乱）
    if (["delivered", "done", "completed"].includes(status)) {
      patch.deliveredAt = new Date();
    }

    const doc = await Order.findByIdAndUpdate(id, patch, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    return res.json({
      success: true,
      data: { id: doc._id.toString(), status: doc.status, deliveredAt: doc.deliveredAt || null },
    });
  } catch (err) {
    console.error("PATCH /api/admin/orders/:id/status error:", err);
    return res.status(500).json({ success: false, message: "更新状态失败" });
  }
});
// =====================================================
// 5) 派单
// PATCH /api/orders/:id/assign
// =====================================================
router.patch("/:id/assign", async (req, res) => {
  try {
    const { driverId, leaderId, deliveryDate } = req.body || {};

    const patch = {};
    if (driverId !== undefined) patch.driverId = toObjectIdMaybe(driverId);
    if (leaderId !== undefined) patch.leaderId = toObjectIdMaybe(leaderId);
    if (deliveryDate !== undefined)
      patch.deliveryDate = deliveryDate ? startOfDay(new Date(deliveryDate)) : null;

    const doc = await Order.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    return res.json({
      success: true,
      data: {
        id: doc._id.toString(),
        driverId: doc.driverId,
        leaderId: doc.leaderId,
        deliveryDate: doc.deliveryDate,
      },
    });
  } catch (err) {
    console.error("PATCH /api/orders/:id/assign error:", err);
    return res.status(500).json({ success: false, message: "派单失败" });
  }
});

// =====================================================
// 6) 标记送达
// PATCH /api/orders/:id/mark-delivered
// =====================================================
router.patch("/:id/mark-delivered", async (req, res) => {
  try {
    const doc = await Order.findByIdAndUpdate(
      req.params.id,
      { status: "done", deliveredAt: new Date() },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    return res.json({
      success: true,
      data: { id: doc._id.toString(), status: doc.status, deliveredAt: doc.deliveredAt },
    });
  } catch (err) {
    console.error("PATCH /api/orders/:id/mark-delivered error:", err);
    return res.status(500).json({ success: false, message: "标记送达失败" });
  }
});

export default router;
