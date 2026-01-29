// backend/src/routes/orders.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js";
import User from "../models/user.js";
import Zone from "../models/Zone.js";
import Product from "../models/product.js";
import { requireLogin } from "../middlewares/auth.js";
import Wallet from "../models/Wallet.js";
import { computeTotalsFromPayload } from "../utils/checkout_pricing.js";

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
      label:
        String(found.label || "").trim() ||
        (Number(found.unitCount || 1) > 1 ? `整箱(${found.unitCount}个)` : "单个"),
      unitCount: Math.max(1, Math.floor(Number(found.unitCount || 1))),
      price: found.price != null ? Number(found.price) : null,

      // ✅ 关键：把 variant 上可能存在的促销字段带出来（兼容多种命名）
      specialQty: found.specialQty ?? found.specialN ?? found.dealQty ?? found.dealN ?? 0,
      specialTotalPrice:
        found.specialTotalPrice ??
        found.specialTotal ??
        found.dealTotalPrice ??
        found.dealTotal ??
        found.dealPrice ??
        0,
    };
  }
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

// ✅ 如果订单当初没走 checkout 预扣库存（stockReserve 为空），在支付确认时补扣
async function reserveStockForExistingOrder(orderDoc, session) {
  if (!orderDoc || !Array.isArray(orderDoc.items) || orderDoc.items.length === 0) return [];

  // 已有 reserve 就不重复扣
  if (Array.isArray(orderDoc.stockReserve) && orderDoc.stockReserve.length > 0) {
    return orderDoc.stockReserve;
  }

  const reserve = [];

  for (const it of orderDoc.items) {
    const sku = String(it?.sku || "");
    const skuVariantKey = sku.includes("::") ? sku.split("::").pop() : "";
    const variantKey = String(it?.variantKey || it?.variant || skuVariantKey || "single").trim() || "single";

    const pid = it?.productId;
    if (!pid) continue;

    const pdoc = await Product.findById(pid)
      .select("name stock allowZeroStock variants")
      .session(session);

    if (!pdoc) {
      const e = new Error(`商品不存在（productId=${pid}）`);
      e.status = 400;
      throw e;
    }

    const v = getVariantFromProduct(pdoc, variantKey);
    const unitCount = Math.max(1, Math.floor(Number(v.unitCount || 1)));

    const qty = Math.max(1, Math.floor(Number(it?.qty || 1)));
    const needUnits = qty * unitCount;

    const allowZero = pdoc.allowZeroStock === true;

    const upd = await Product.updateOne(
      allowZero ? { _id: pdoc._id } : { _id: pdoc._id, stock: { $gte: needUnits } },
      { $inc: { stock: -needUnits } },
      { session }
    );

    if (upd.modifiedCount !== 1) {
      const e = new Error(`库存不足：${pdoc.name}（需要 ${needUnits}）`);
      e.status = 400;
      throw e;
    }

    reserve.push({
      productId: pdoc._id,
      variantKey: v.key || "single",
      unitCount,
      qty,
      needUnits,
    });
  }

  return reserve;
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

  // ✅ 订单备注统一入口
  const orderNote = String(body?.remark ?? body?.note ?? ship?.remark ?? ship?.note ?? "").trim();

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
    String(ship.address || ship.fullText || ship.formattedAddress || ship.address1 || ship.addressLine || "").trim() ||
    [ship.street1, ship.apt, ship.city, ship.state, ship.zip].filter(Boolean).join(", ").trim();

  if (!contactName || !contactPhone || !addressText) {
    const e = new Error("收货信息不完整（姓名/电话/地址）");
    e.status = 400;
    throw e;
  }

  // 坐标：优先前端，否则后台 geocode（可选）
  let lat = typeof ship.lat === "number" ? ship.lat : Number.isFinite(Number(ship.lat)) ? Number(ship.lat) : null;
  let lng = typeof ship.lng === "number" ? ship.lng : Number.isFinite(Number(ship.lng)) ? Number(ship.lng) : null;
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

    // 尝试解析 productId（兼容 "productId::variantKey"）
    let productId;

    // 先拿原始
    let maybeMongoId = String(it.productId || it._id || "").trim();

    // ✅ 兼容： "6970...a268::single"
    let inferredVariantKey = "";
    if (maybeMongoId.includes("::")) {
      const parts = maybeMongoId.split("::");
      maybeMongoId = String(parts[0] || "").trim();
      inferredVariantKey = String(parts[1] || "").trim();
    }

    if (maybeMongoId && mongoose.Types.ObjectId.isValid(maybeMongoId)) {
      productId = new mongoose.Types.ObjectId(maybeMongoId);
    }

    const legacyId = String(it.legacyProductId || it.id || it._id || "").trim();

    // ✅ variantKey：优先用显式字段，其次用从 productId:: 推断的
    const variantKey = String(it.variantKey || it.variant || inferredVariantKey || "").trim();

    // 默认使用前端价格（兼容旧逻辑）
    let price = Number(it.priceNum ?? it.price ?? 0);
    if (!Number.isFinite(price) || price < 0) price = 0;

    let finalName = String(it.name || "");
    let finalSku = it.sku ? String(it.sku) : "";
    let finalImage = it.image ? String(it.image) : "";
    let cost = Number(it.cost || 0) || 0;
    let hasTax = !!it.hasTax;

    // ✅ variants + deposit（全部用 deposit）
    let finalVariantKey = variantKey || "single";
    let finalUnitCount = 1;
    let depositEach = 0; // 每个“单个单位”的押金（来自 DB）

    // ✅ 特价字段：先用前端兜底
    let specialQty = safeNumber(it.specialQty ?? it.specialN ?? it.dealQty ?? it.dealN ?? 0, 0);
    let specialTotalPrice = safeNumber(
      it.specialTotalPrice ?? it.specialTotal ?? it.dealTotalPrice ?? it.dealPrice ?? 0,
      0
    );

    if (productId) {
      const q = Product.findById(productId).select(
        "name sku price cost taxable deposit image images stock allowZeroStock variants specialQty specialTotalPrice specialN specialTotal dealQty dealTotalPrice dealPrice"
      );
      const pdoc = session ? await q.session(session) : await q;

      if (!pdoc) {
        const e = new Error(`商品不存在（productId=${productId}）`);
        e.status = 400;
        throw e;
      }

      // 解析规格（单个/整箱）
      const v = getVariantFromProduct(pdoc, variantKey);
      const unitCount = Math.max(1, Math.floor(Number(v.unitCount || 1)));
      finalVariantKey = v.key || "single";
      finalUnitCount = unitCount;

      // ✅ 全部用 deposit（没有就按 0）
      depositEach = safeNumber(
  pdoc.deposit ?? pdoc.bottleDeposit ?? pdoc.containerDeposit ?? pdoc.crv ?? 0,
  0
);
      // 用后端价格：variant.price 优先，否则 product.price
      const backendPrice = v.price != null ? Number(v.price) : Number(pdoc.price || 0);
      if (Number.isFinite(backendPrice) && backendPrice >= 0) price = round2(backendPrice);

      // 名称/sku 增强
      const vLabel = String(v.label || "").trim();
      finalName = vLabel ? `${pdoc.name} - ${vLabel}` : String(pdoc.name || finalName);
      const baseSku = String(pdoc.sku || finalSku || legacyId || productId.toString());
      finalSku = `${baseSku}::${v.key || "single"}`;

      finalImage =
        String(pdoc.image || "").trim() ||
        (Array.isArray(pdoc.images) && pdoc.images[0] ? String(pdoc.images[0]) : finalImage);

      cost = Number(pdoc.cost || 0) || cost;
      hasTax = !!pdoc.taxable;

      // ✅ DB 覆盖特价字段（防止前端乱传）
      specialQty = safeNumber(pdoc.specialQty ?? pdoc.specialN ?? pdoc.dealQty ?? specialQty, specialQty);
      specialTotalPrice = safeNumber(
        pdoc.specialTotalPrice ?? pdoc.specialTotal ?? pdoc.dealTotalPrice ?? pdoc.dealPrice ?? specialTotalPrice,
        specialTotalPrice
      );
           // ✅ 再用 variant 覆盖一次（很多商品把 2for/3for 存在 variants.single 上）
      specialQty = safeNumber(v.specialQty ?? specialQty, specialQty);
      specialTotalPrice = safeNumber(v.specialTotalPrice ?? specialTotalPrice, specialTotalPrice);
      const needUnits = qty * unitCount;
      const allowZero = pdoc.allowZeroStock === true;
      const curStock = Number(pdoc.stock || 0);

      // ✅ 不管是不是 checkout，都禁止“下单数量 > 库存”
      if (!allowZero && curStock < needUnits) {
        const e = new Error(`库存不足：${pdoc.name}（需要 ${needUnits}，当前 ${curStock}）`);
        e.status = 400;
        throw e;
      }

      // ✅ 只有 checkout（传 session）才真正扣库存 + 写 stockReserve
      if (session) {
        const upd = await Product.updateOne(
          allowZero ? { _id: pdoc._id } : { _id: pdoc._id, stock: { $gte: needUnits } },
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
    // ✅ 兜底：如果 productId 有，但 depositEach 还是 0，说明 DB 里没填押金（或查不到商品）
// 这里绝对不要用前端 it.deposit 来覆盖（防止被前端 0 污染）
if (productId && !Number.isFinite(depositEach)) depositEach = 0;
if (productId && depositEach < 0) depositEach = 0;
    // ✅ cleanItems：保留 specialQty/specialTotalPrice/deposit/taxable 等字段，给 computeTotalsFromPayload 统一结算
    cleanItems.push({
      productId,
      legacyProductId: legacyId || "",
      name: finalName,
      sku: finalSku,

      price: round2(price),
      qty,
      variantKey: finalVariantKey,
      unitCount: finalUnitCount,

      // ✅ 特价字段保留给统一结算用（与前端一致）
      specialQty: Number(specialQty || 0),
      specialTotalPrice: Number(specialTotalPrice || 0),

      // ✅ 税字段统一：hasTax / taxable 都带
      hasTax: !!hasTax,
      taxable: !!hasTax,

      // ✅ 押金
      deposit: round2(depositEach),

      image: finalImage,
      cost,
    });
  }
  // -------------------------
  // 规则校验（保留你原来的）
  // -------------------------
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

  // -------------------------
// tip（先算出来）
// ✅ 兼容：顶层 tip/tipAmount + pricing.tip/tipAmount
// -------------------------
const pricingIn = body?.pricing || {};
const tipRaw =
  pricingIn.tipAmount ??
  pricingIn.tip ??
  tipAmount ??
  tip ??
  ship.tip ??
  0;

const tipFee = round2(Math.max(0, safeNumber(tipRaw, 0)));
  // -------------------------
  // ✅ 统一结算：buildOrderPayload 阶段用 “wallet口径”(平台费=0)
  // checkout 阶段如需 Stripe，会用 stripe口径重算（平台费=0.5+2%）
  // -------------------------
  const totalsWallet = computeTotalsFromPayload(
  {
    items: cleanItems,
    shipping: ship,
    mode,
    pricing: { tip: tipFee },
  },
  { payChannel: "wallet", taxRateNY: NY_TAX_RATE }
);
const subtotalForRule = round2(totalsWallet.subtotal);

if (mode === "normal" && subtotalForRule < 49.99) {
  const e = new Error("未满足 $49.99 最低消费");
  e.status = 400;
  throw e;
}

if (mode === "friendGroup" && subtotalForRule < 29) {
  const e = new Error("未满足 $29 最低消费");
  e.status = 400;
  throw e;
}
  // ✅ 用统一结算覆盖所有金额字段
  const deliveryFee = round2(totalsWallet.shipping);
  const taxableSubtotal = round2(totalsWallet.taxableSubtotal);
  const taxRate = round2(totalsWallet.taxRate);
  const salesTax = round2(totalsWallet.salesTax);
  // ✅ 押金：优先使用前端传来的 pricing.bottleDeposit（因为 DB 没 deposit 字段）
// ✅ 统一用 computeTotalsFromPayload 的结果（口径一致）
const depositTotal = round2(totalsWallet.depositTotal);
const baseTotalAmount = round2(totalsWallet.totalAmount);
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
    amountSubtotal: Number(round2(totalsWallet.subtotal) || 0),
    amountDeliveryFee: Number(deliveryFee || 0),
    amountTax: Number(salesTax || 0),
    amountDeposit: Number(depositTotal || 0),
    amountPlatformFee: 0,
    amountTip: Number(tipFee || 0),
    amountDiscount: 0,
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
    subtotal: round2(totalsWallet.subtotal),
    deliveryFee,
    discount,
    totalAmount: Number(baseTotalAmount || 0),

    taxableSubtotal,
    salesTax,
    depositTotal,
    platformFee,
    tipFee,
    salesTaxRate: Number(taxRate || 0),

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
        { $and: [{ $or: [{ userId: { $exists: false } }, { userId: null }] }, { $or: phoneOr }] },
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
        depositTotal: o.depositTotal,
        platformFee: o.platformFee,
        tipFee: o.tipFee,
        taxableSubtotal: o.taxableSubtotal,
        payment: o.payment,
        note: o.note || "",
        remark: o.remark || o.note || "",
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

      // ✅ 明细
      salesTax: round2(doc.salesTax ?? 0),
      depositTotal: round2(doc.depositTotal ?? 0),
      taxableSubtotal: round2(doc.taxableSubtotal ?? 0),
      salesTaxRate: round2(doc.salesTaxRate ?? 0),
      platformFee: round2(doc.platformFee ?? 0),
      tipFee: round2(doc.tipFee ?? 0),

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

    // ✅ 幂等：同一次提交不要重复生成订单
    if (idemKey) {
      const existed = await Order.findOne({ "payment.idempotencyKey": idemKey })
        .select("_id orderNo status payment totalAmount")
        .lean();
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
      const { orderDoc } = await buildOrderPayload(req, session);

      // ✅ 先按“钱包口径”总额（平台费=0）
      const ship = req.body?.shipping || req.body?.receiver || {};
const totalsWallet = computeTotalsFromPayload(
  {
    items: orderDoc.items,
    shipping: ship,
    mode: orderDoc.deliveryMode,
    pricing: { tip: orderDoc.tipFee || 0 },
  },
  { payChannel: "wallet", taxRateNY: NY_TAX_RATE }
);
      finalTotal = round2(totalsWallet.totalAmount);
      platformFee = 0;

      // 1) 钱包余额
      const w0 = await Wallet.findOne({ userId }).session(session);
      const balance0 = Number(w0?.balance || 0);

      // 2) 先按钱包口径试算
      walletUsed = round2(Math.min(balance0, finalTotal));
      remaining = round2(finalTotal - walletUsed);

      // 3) 如果需要 Stripe：按 Stripe 口径重算（平台费=0.5 + 2%）
      if (remaining > 0) {
        const totalsStripe = computeTotalsFromPayload(
  {
    items: orderDoc.items,
    shipping: ship,
    mode: orderDoc.deliveryMode,
    pricing: {
      tip: orderDoc.tipFee || 0,
      bottleDeposit: orderDoc.depositTotal || 0,
      depositTotal: orderDoc.depositTotal || 0,
      deposit: orderDoc.depositTotal || 0,
    },
  },
  { payChannel: "stripe", taxRateNY: NY_TAX_RATE, platformRate: 0.02, platformFixed: 0.5 }
);
        platformFee = round2(totalsStripe.platformFee);
finalTotal = round2(totalsStripe.totalAmount);

// ✅ 同步 Stripe 口径的明细（一次性解决对账问题）
orderDoc.subtotal = round2(totalsStripe.subtotal);
orderDoc.deliveryFee = round2(totalsStripe.shipping);
orderDoc.taxableSubtotal = round2(totalsStripe.taxableSubtotal);
orderDoc.salesTax = round2(totalsStripe.salesTax);
orderDoc.depositTotal = round2(totalsStripe.depositTotal);
orderDoc.tipFee = round2(totalsStripe.tipFee);
        walletUsed = round2(Math.min(balance0, finalTotal));
        remaining = round2(finalTotal - walletUsed);
      }

      // ✅ 如果前端选择钱包支付（wallet），但余额不足 => 直接 400
      const clientPayMethod = String(
        req.body?.payMethod || req.body?.paymentMethod || req.body?.payment?.method || ""
      )
        .trim()
        .toLowerCase();

      if (clientPayMethod === "wallet" && remaining > 0) {
        const e = new Error(`钱包余额不足：需要 $${finalTotal.toFixed(2)}，当前 $${balance0.toFixed(2)}`);
        e.status = 400;
        throw e;
      }

      // 4) 创建订单（创建时一律 unpaid）
      const docToCreate = {
        ...orderDoc,
        platformFee,
        totalAmount: finalTotal,
        status: "pending",
        paidAt: null,
        payment: {
          ...(orderDoc.payment || {}),
          idempotencyKey: idemKey || "",
          amountPlatformFee: Number(platformFee || 0),
          amountTotal: Number(finalTotal || 0),
          status: "unpaid",
          method: remaining > 0 ? "stripe" : "wallet",
          paidTotal: 0,
          wallet: { paid: 0 },
          stripe: { intentId: "", paid: 0 },
        },
      };

      created = await Order.create([docToCreate], { session });
      created = created?.[0] || null;
      if (!created) throw new Error("创建订单失败");

      // 5) 钱包扣款（只有钱包要用时）—— ✅扣 wallets 集合
      if (walletUsed > 0) {
        const w1 = await Wallet.findOneAndUpdate(
          { userId, balance: { $gte: walletUsed } },
          { $inc: { balance: -walletUsed } },
          { new: true, session }
        );

        if (w1) {
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

      const w2 = await Wallet.findOne({ userId }).session(session);
      newBalance = round2(Number(w2?.balance || 0));

      // ✅ 保护：如果理论上应为纯钱包，但钱包没扣成功 => 回滚
      if (remaining <= 0 && walletUsed > 0 && walletDeducted !== true) {
        const e = new Error("钱包扣款失败（未实际扣款），请重试");
        e.status = 400;
        throw e;
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
        "payment status totalAmount orderNo deliveryMode fulfillment subtotal deliveryFee discount salesTax depositTotal salesTaxRate platformFee tipFee taxableSubtotal deliveryDate stockReserve"
      )
      .lean();

    return res.json({
      success: true,
      orderId: created._id.toString(),
      orderNo: created.orderNo,
      totalAmount: round2(fresh?.totalAmount ?? finalTotal),
      salesTax: round2(fresh?.salesTax ?? 0),
      depositTotal: round2(fresh?.depositTotal ?? 0),
      taxableSubtotal: round2(fresh?.taxableSubtotal ?? 0),
      salesTaxRate: round2(fresh?.salesTaxRate ?? 0),
      platformFee: round2(fresh?.platformFee ?? 0),
      tipFee: round2(fresh?.tipFee ?? 0),

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
  const session = await mongoose.startSession();
  try {
    const orderId = req.params.id;
    const intentId = String(req.body?.intentId || req.body?.stripePaymentIntentId || "").trim();
    const stripePaid = Number(req.body?.paid ?? req.body?.stripePaid ?? 0);

    if (!intentId) return res.status(400).json({ success: false, message: "intentId required" });
    if (!Number.isFinite(stripePaid) || stripePaid <= 0) {
      return res.status(400).json({ success: false, message: "paid must be > 0" });
    }

    const uid = toObjectIdMaybe(req.user?.id || req.user?._id);
    let outDoc = null;

    await session.withTransaction(async () => {
      const doc = await Order.findById(orderId).session(session);
      if (!doc) {
        const e = new Error("订单不存在");
        e.status = 404;
        throw e;
      }

      // ✅ 绑定 userId / phone
      if (uid && !doc.userId) {
        doc.userId = uid;

        let loginPhoneRaw = String(req.user?.phone || "").trim();
        if (!loginPhoneRaw) {
          const u = await User.findById(uid).select("phone").lean();
          loginPhoneRaw = String(u?.phone || "").trim();
        }
        const p10 = normPhone(loginPhoneRaw);
        if (p10) doc.customerPhone = p10;
      }

      // 权限检查
      if (uid && doc.userId && String(doc.userId) !== String(uid) && req.user.role !== "admin") {
        const e = new Error("无权限");
        e.status = 403;
        throw e;
      }

      // 幂等：已 paid 直接返回
      if (doc.payment?.status === "paid" || doc.status === "paid") {
        outDoc = doc;
        return;
      }

      // ✅ 如果当初没走 checkout（stockReserve 为空），这里补扣库存
      const reserved = await reserveStockForExistingOrder(doc, session);
      if (reserved.length > 0 && (!doc.stockReserve || doc.stockReserve.length === 0)) {
        doc.stockReserve = reserved;
      }

      const total = Number(doc.totalAmount || 0);
      const walletPaid = Number(doc.payment?.wallet?.paid || 0);

      const prevStripePaid = Number(doc.payment?.stripe?.paid || 0);
      const newStripePaid = round2(prevStripePaid + stripePaid);
      const paidTotal = round2(walletPaid + newStripePaid);

      if (paidTotal + 0.01 < total) {
        const e = new Error(`stripePaid 不足以覆盖剩余金额（paidTotal=${paidTotal}, total=${total}）`);
        e.status = 400;
        throw e;
      }

      const now = new Date();
      doc.status = "paid";
      doc.paidAt = now;

      doc.payment = {
        ...(doc.payment || {}),
        status: "paid",
        method: "stripe",
        paidTotal: round2(Math.min(paidTotal, total)),
        stripe: { intentId, paid: round2(Math.min(newStripePaid, total)) },
        wallet: { paid: round2(Math.min(walletPaid, total)) },
      };

      await doc.save({ session });
      outDoc = doc;
    });

    if (outDoc?.payment?.status === "paid" || outDoc?.status === "paid") {
      return res.json({
        success: true,
        message: "paid",
        orderId: outDoc._id.toString(),
        orderNo: outDoc.orderNo,
        totalAmount: outDoc.totalAmount,
        payment: outDoc.payment,
        stockReserve: outDoc.stockReserve || [],
      });
    }

    return res.status(500).json({ success: false, message: "confirm stripe failed" });
  } catch (err) {
    console.error("POST /api/orders/:id/confirm-stripe error:", err);
    return res.status(err?.status || 500).json({ success: false, message: err?.message || "confirm stripe failed" });
  } finally {
    session.endSession();
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
        depositTotal: o.depositTotal,
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
        depositTotal: doc.depositTotal,
        salesTaxRate: doc.salesTaxRate,
        platformFee: doc.platformFee,
        tipFee: doc.tipFee,
        addressText: doc.addressText,
        note: doc.note,
        address: doc.address,
        items: doc.items,
        stockReserve: doc.stockReserve || [],
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
// PATCH /api/orders/admin/:id/status
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
    console.error("PATCH /api/orders/admin/:id/status error:", err);
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
