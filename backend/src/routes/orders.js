// backend/src/routes/orders.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js";
import User from "../models/user.js";
import Zone from "../models/Zone.js";
import Product from "../models/product.js"; // ✅ NEW：为了 variants + 共用库存扣减
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🚀 orders.js (MongoDB版, MODEL-ALIGNED + STOCK_RESERVE) 已加载");

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

// ✅ 规格解析：从 product.variants 找 variantKey
function getVariantFromProduct(productDoc, variantKey) {
  const key = String(variantKey || "").trim();
  const list = Array.isArray(productDoc?.variants) ? productDoc.variants : [];
  const found = list.find((v) => String(v?.key || "").trim() === key && v?.enabled !== false);
  if (found) {
    return {
      key: String(found.key || key || "single"),
      label: String(found.label || "").trim() || (Number(found.unitCount || 1) > 1 ? `整箱(${found.unitCount}个)` : "单个"),
      unitCount: Math.max(1, Math.floor(Number(found.unitCount || 1))),
      price: found.price != null ? Number(found.price) : null,
    };
  }
  // 没配 variants 或没传 variantKey：默认单个
  return { key: "single", label: "单个", unitCount: 1, price: null };
}

// ✅ 后端 geocode（需要 GOOGLE_MAPS_SERVER_KEY）
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
 * ✅ 支持 variants：items 可传 variantKey（single/box12）
 *
 * @param {object} req
 * @param {mongoose.ClientSession|null} session - 只有在 checkout 里才传，用于扣库存 + 写 stockReserve
 */
async function buildOrderPayload(req, session = null) {
  const body = req.body || {};
  const mode = pickMode(body);

  const { items, receiver, shipping, zoneId, deliveryDate, tip, tipAmount } = body;
  const ship = shipping || receiver || {};
    // ✅ 订单备注统一入口：支持 顶层 remark/note + shipping.note（用于后台订单/贴纸）
  const orderNote = String(
    body?.remark ??
      body?.note ??
      ship?.remark ??
      ship?.note ??
      ""
  ).trim();
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
      ship.address || ship.fullText || ship.formattedAddress || ship.address1 || ship.addressLine || ""
    ).trim() || [ship.street1, ship.apt, ship.city, ship.state, ship.zip].filter(Boolean).join(", ").trim();

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

  // =========================
  // ✅ items 整理 +（checkout时）预扣库存 + stockReserve
  // =========================
  let subtotal = 0;
  const cleanItems = [];
  const stockReserve = [];

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx] || {};

    const qtyRaw = Number(it.qty || 1);
    const qty = Number.isFinite(qtyRaw) ? Math.floor(qtyRaw) : 1;
    if (!it.name || !Number.isFinite(qty) || qty < 1) {
      const e = new Error(`第 ${idx + 1} 个商品数据不合法`);
      e.status = 400;
      throw e;
    }

    // 尝试解析 productId
    let productId;
    const maybeMongoId = String(it.productId || it._id || "").trim();
    if (maybeMongoId && mongoose.Types.ObjectId.isValid(maybeMongoId)) {
      productId = new mongoose.Types.ObjectId(maybeMongoId);
    }

    const legacyId = String(it.legacyProductId || it.id || it._id || "").trim();
    const variantKey = String(it.variantKey || it.variant || "").trim(); // ✅ 前端可传

    // 默认使用前端价格（兼容旧逻辑）
    let price = Number(it.priceNum ?? it.price ?? 0);
    if (!Number.isFinite(price) || price < 0) price = 0;

    let finalName = String(it.name || "");
    let finalSku = it.sku ? String(it.sku) : "";
    let finalImage = it.image ? String(it.image) : "";
    let cost = Number(it.cost || 0) || 0;
    let hasTax = !!it.hasTax;

    // ✅ 如果有 productId：优先用后端 Product 里的价格/税/图片（防止前端乱传）
    if (productId) {
      const q = Product.findById(productId).select("name sku price cost taxable image images stock allowZeroStock variants");
      const pdoc = session ? await q.session(session) : await q;
      if (!pdoc) {
        const e = new Error(`商品不存在（productId=${productId}）`);
        e.status = 400;
        throw e;
      }

      // 解析规格（单个/整箱）
      const v = getVariantFromProduct(pdoc, variantKey);
      const unitCount = Math.max(1, Math.floor(Number(v.unitCount || 1)));

      // 用后端价格：variant.price 优先，否则 product.price
      const backendPrice = v.price != null ? Number(v.price) : Number(pdoc.price || 0);
      if (Number.isFinite(backendPrice) && backendPrice >= 0) price = round2(backendPrice);

      // 名称/sku 增强（不改 order item schema 也能看出来是整箱）
      const vLabel = String(v.label || "").trim();
      finalName = vLabel ? `${pdoc.name} - ${vLabel}` : String(pdoc.name || finalName);
      const baseSku = String(pdoc.sku || finalSku || legacyId || productId.toString());
      finalSku = `${baseSku}::${v.key || "single"}`;

      finalImage =
        String(pdoc.image || "").trim() ||
        (Array.isArray(pdoc.images) && pdoc.images[0] ? String(pdoc.images[0]) : finalImage);

      cost = Number(pdoc.cost || 0) || cost;
      hasTax = !!pdoc.taxable;

      const needUnits = qty * unitCount;
const allowZero = pdoc.allowZeroStock === true;
const curStock = Number(pdoc.stock || 0);

// ✅ 关键：不管是不是 checkout，都禁止“下单数量 > 库存”
if (!allowZero && curStock < needUnits) {
  const e = new Error(`库存不足：${pdoc.name}（需要 ${needUnits}，当前 ${curStock}）`);
  e.status = 400;
  throw e;
}

// ✅ 只有 checkout（传 session）才真正扣库存 + 写 stockReserve
if (session) {
  // ✅ 改为原子扣减：避免并发超卖
  const upd = await Product.updateOne(
    allowZero
      ? { _id: pdoc._id }
      : { _id: pdoc._id, stock: { $gte: needUnits } },
    { $inc: { stock: -needUnits } },
    { session }
  );

  if (upd.modifiedCount !== 1) {
    const e = new Error(`库存不足：${pdoc.name}（需要 ${needUnits}）`);
    e.status = 400;
    throw e;
  }

  stockReserve.push({
    productId: pdoc._id,
    variantKey: v.key || "single",
    unitCount,
    qty,
    needUnits,
  });
}
    }
    const lineTotal = round2(price * qty);
    subtotal += lineTotal;

    cleanItems.push({
      productId,
      legacyProductId: legacyId || "",
      name: finalName,
      sku: finalSku,
      price: round2(price),
      qty,
      image: finalImage,
      lineTotal,
      cost,
      hasTax,
    });
  }

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

  // taxableSubtotal（按 hasTax）
  const taxableSubtotal = round2(
    cleanItems.filter((x) => x.hasTax === true).reduce((sum, x) => sum + Number(x.lineTotal || 0), 0)
  );

  // tax
  const salesTax = round2(taxableSubtotal * NY_TAX_RATE);

  const discount = 0;

  // ✅ 平台费：只在需要 Stripe 时（checkout 决定）
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
    dispatch: z ? { zoneId: z, batchKey, batchName: zoneName || "" } : { zoneId: "", batchKey: "", batchName: "" },

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
    note: orderNote,
    address: { fullText, zip, zoneId: z, lat, lng },

    items: cleanItems,

    // ✅ NEW：库存预扣快照（只有 checkout 才会有值）
    stockReserve: Array.isArray(stockReserve) ? stockReserve : [],
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
          $and: [{ $or: [{ userId: { $exists: false } }, { userId: null }] }, { $or: phoneOr }],
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
                note: o.note || "",
        remark: o.remark || o.note || "", // ✅ 如果你 model 做了 virtual remark，这里也能拿到
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
// ✅ 这里不扣库存（避免 pending 占库存）
// =====================================================
router.post("/", requireLogin, async (req, res) => {
  try {
    const { orderDoc } = await buildOrderPayload(req, null);
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
    return res.status(err?.status || 500).json({ success: false, message: err?.message || "创建订单失败" });
  }
});

// =====================================================
// ✅ checkout：钱包优先，剩余走 Stripe（平台费只在需要 Stripe 时加）
// POST /api/orders/checkout
//
// ✅ 在事务里：扣库存（共用 stock） + 写 stockReserve
// =====================================================
router.post("/checkout", requireLogin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
        const idemKey = String(req.body?.checkoutKey || req.body?.intentKey || "").trim();
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    let created = null;
    let walletUsed = 0;
    let remaining = 0;
    let newBalance = 0;

    let finalTotal = 0;
    let platformFee = 0;
    let walletDeducted = false;
    if (idemKey) {
      const existed = await Order.findOne({ "payment.idempotencyKey": idemKey }).select("_id orderNo status payment totalAmount").lean();
      if (existed) {
        return res.json({
          success: true,
          reused: true,
          orderId: String(existed._id),
          orderNo: existed.orderNo,
          status: existed.status,
          payment: existed.payment,
          totalAmount: existed.totalAmount,
        });
      }
    }
    
    await session.withTransaction(async () => {
      // ✅ 先在事务里构建订单 + 预扣库存 + 写 stockReserve
      const { orderDoc, baseTotalAmount } = await buildOrderPayload(req, session);

      const baseTotal = Number(baseTotalAmount || 0);
      if (!Number.isFinite(baseTotal) || baseTotal <= 0) {
        const e = new Error("订单金额不合法");
        e.status = 400;
        throw e;
      }

      finalTotal = round2(baseTotal);

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

      console.log("💰 [checkout] wallet calc", {
  userId: String(userId),
  balance0,
  baseTotal,
  platformFee,
  finalTotal,
  walletUsed,
  remaining,
});
      // ✅ 结算页：如果前端选择的是钱包支付，则必须钱包全额覆盖
      // （你现在的前端 wallet 流程不支持“剩余走 Stripe”，所以必须拦住）
      const clientPayMethod = String(req.body?.payMethod || req.body?.paymentMethod || req.body?.payment?.method || "").trim();
      if (clientPayMethod === "wallet" && remaining > 0) {
        const e = new Error(`钱包余额不足：需要 $${finalTotal.toFixed(2)}，当前 $${balance0.toFixed(2)}`);
        e.status = 400;
        throw e; // ✅ 直接回滚：不会创建 pending，更不会扣库存
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
            idempotencyKey: idemKey || "",
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
  console.log("💰 [checkout] before wallet deduct", {
    userId: String(userId),
    walletUsed,
  });

  const upd = await User.updateOne(
    { _id: userId, walletBalance: { $gte: walletUsed } },
    { $inc: { walletBalance: -walletUsed } },
    { session }
  );

  console.log("💰 [checkout] wallet updateOne result", upd);

  if (upd.modifiedCount === 1) {
    walletDeducted = true;

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

    console.log("💰 [checkout] wallet deducted OK", { walletUsed });
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

    console.log("💰 [checkout] wallet deduct FAILED -> fallback stripe", {
      finalTotal,
      remaining,
    });
  }
}
      const u1 = await User.findById(userId).select("walletBalance").session(session);
      newBalance = Number(u1?.walletBalance || 0);
      console.log("💰 [checkout] wallet after", { newBalance });
      // ✅ 保护：如果理论上应为“纯钱包支付”(remaining<=0)，但钱包没扣成功，直接报错回滚
if (remaining <= 0 && walletUsed > 0 && walletDeducted !== true) {
  const e = new Error("钱包扣款失败（未实际扣款），请重试");
  e.status = 400;
  throw e; // 会触发事务回滚：库存也会回滚
}
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
        "payment status totalAmount orderNo deliveryMode fulfillment subtotal deliveryFee discount salesTax platformFee tipFee taxableSubtotal deliveryDate stockReserve"
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
      stockReserve: fresh?.stockReserve || [],
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
      $or: [{ customerPhone: phone }, { customerPhone: phone10 }, { customerPhone: { $regex: phone10 + "$" } }],
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
        stockReserve: doc.stockReserve || [], // ✅ NEW
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
    const allowed = ["pending", "paid", "packing", "shipping", "delivering", "delivered", "done", "completed", "cancel", "cancelled"];
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
router.patch("/admin/:id/status", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "需要管理员权限" });
    }

    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "订单ID不合法" });
    }

    const status = String(req.body?.status || "").trim().toLowerCase();
    const allowed = ["pending", "paid", "packing", "shipping", "delivering", "delivered", "done", "completed", "cancel", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "status 不合法" });
    }

    const patch = { status };

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
    if (deliveryDate !== undefined) patch.deliveryDate = deliveryDate ? startOfDay(new Date(deliveryDate)) : null;

    const doc = await Order.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    return res.json({
      success: true,
      data: { id: doc._id.toString(), driverId: doc.driverId, leaderId: doc.leaderId, deliveryDate: doc.deliveryDate },
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
    const doc = await Order.findByIdAndUpdate(req.params.id, { status: "done", deliveredAt: new Date() }, { new: true });
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
