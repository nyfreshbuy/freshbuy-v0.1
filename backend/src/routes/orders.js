// backend/src/routes/orders.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js";
import User from "../models/user.js";
import Zone from "../models/Zone.js"; // ✅ 用于 zip -> zone 自动归类
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🚀 orders.js (MongoDB版) 已加载");

// =========================
// ✅ NY 税率（可用环境变量覆盖）
// 默认 8.875%（NYC 常用）
// 你可在 .env 里设置：NY_TAX_RATE=0.08875
// =========================
const NY_TAX_RATE = Number(process.env.NY_TAX_RATE || 0.08875);

// ✅ 0) ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "orders" });
});

// =========================
// 工具：手机号归一化（美国常用）
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
  return Math.round(Number(n) * 100) / 100;
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
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setDate(x.getDate() + n);
  return x;
}

function buildBatchKey(deliveryDate, zoneKey) {
  const ymd = toYMD(deliveryDate);
  return `${ymd}|zone:${String(zoneKey || "").trim()}`;
}

// ===== 工具：爆品判断（与 cart.html 一致）=====
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
 * 兼容前端传：
 * - mode
 * - deliveryMode
 */
function pickMode(body) {
  const raw = body?.mode ?? body?.deliveryMode ?? body?.delivery_mode ?? "";
  return String(raw || "").trim();
}

/**
 * ✅ deliveryDate 统一计算（这是你路线/派单的根）
 *
 * 规则（你要的混合筛选靠这个）：
 * - groupDay：必须传 deliveryDate（因为区域团固定配送日）
 * - normal / friendGroup / dealsDay：没传就默认“次日送”
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

  // normal / friendGroup / dealsDay：默认次日
  if (input) return input;
  const tomorrow = addDays(new Date(), 1);
  return startOfDay(tomorrow);
}

/**
 * ✅ 统一解析 zone（优先：body.zoneId / shipping.zoneId / address.zoneId）
 * 如果都没有，就用 zip 去 Zone 表自动匹配
 *
 * 返回：
 * { zoneKey: string, zoneName: string }
 */
async function resolveZoneFromPayload({ zoneId, ship, zip }) {
  const z0 = String(zoneId || ship?.zoneId || ship?.address?.zoneId || ship?.zone || "").trim();
  if (z0) {
    return { zoneKey: z0, zoneName: "" };
  }

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
 * ✅ 统一构建订单：校验/金额/地理解析/配送日/区域批次
 * 返回：{ orderDoc, totalAmount, baseTotalAmount }
 *
 * ✅ 关键修改点（为“混合筛选 + 路线”服务）：
 * 1) deliveryDate：不再默认 today，而是：
 *    - normal/friendGroup/dealsDay 默认次日
 *    - groupDay 必须指定
 * 2) fulfillment：只要有 zoneKey，就全部归入 zone_group（包括 normal/friendGroup）
 *    这样你筛选某天某区：一把抓三种模式混在一起做路线
 * 3) batchKey 永远用 deliveryDate 的 ymd，而不是 createdAt 或 today
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

  // =====================================================
  // ✅ 收货信息字段兼容
  // =====================================================
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
    [ship.street1, ship.apt, ship.city, ship.state, ship.zip]
      .filter(Boolean)
      .join(", ")
      .trim();

  if (!contactName || !contactPhone || !addressText) {
    const e = new Error("收货信息不完整（姓名/电话/地址）");
    e.status = 400;
    throw e;
  }

  // ✅ 坐标优先用前端传的，否则后台 geocode
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

  // 1) 后端重算金额 + 整理 items
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
      legacyProductId: legacyId || undefined,
      name: String(it.name),
      sku: it.sku ? String(it.sku) : undefined,
      price: round2(price),
      qty: Math.floor(qty),
      image: it.image ? String(it.image) : undefined,
      lineTotal,

      // 兼容：留着，不影响 Order.model
      tag: it.tag ? String(it.tag) : "",
      type: it.type ? String(it.type) : "",
      isDeal: !!it.isDeal,
      isSpecial: !!it.isSpecial,

      // ✅ 是否应税
      hasTax: !!it.hasTax,
    };
  });

  subtotal = round2(subtotal);

  // 2) 规则校验（保持你原规则）
  const hasSpecial = items.some((it) => isSpecialItem(it));
  const hasNonSpecial = items.some((it) => !isSpecialItem(it));

  if (mode === "dealsDay" && (hasNonSpecial || !hasSpecial)) {
    const e = new Error("dealsDay 只能包含爆品");
    e.status = 400;
    throw e;
  }
  if (mode === "groupDay" && !(hasSpecial && hasNonSpecial)) {
    const e = new Error("groupDay 需包含爆品+普通商品");
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

  // 3) 运费
  let deliveryFee = 0;
  if (mode === "dealsDay") deliveryFee = 0;
  else if (mode === "groupDay") deliveryFee = subtotal >= 49.99 ? 0 : 4.99;
  else if (mode === "friendGroup") deliveryFee = 4.99;
  else deliveryFee = 4.99;

  deliveryFee = round2(deliveryFee);

  // ✅ 小费（可选）
  const tipRaw = tipAmount ?? tip ?? ship.tip ?? 0;
  const tipFee = round2(Math.max(0, safeNumber(tipRaw, 0)));

  // ✅ 应税小计
  const taxableSubtotal = round2(
    cleanItems
      .filter((x) => x.hasTax === true)
      .reduce((sum, x) => sum + Number(x.lineTotal || 0), 0)
  );

  // ✅ 纽约销售税
  const salesTax = round2(taxableSubtotal * NY_TAX_RATE);

  const discount = 0;

  // ⚠️ 平台费先占位（checkout 决定是否收）
  const platformFee = 0;

  // ✅ 基础总额（不含平台费）
  const baseTotalAmount = round2(subtotal + deliveryFee + salesTax + tipFee - discount);

  // 先临时给 totalAmount=baseTotalAmount（checkout 可能加平台费）
  const totalAmount = baseTotalAmount;

  // 4) mode -> orderType（保留）
  const orderType =
    mode === "groupDay" ? "area_group" : mode === "friendGroup" ? "friend_group" : "normal";

  // 5) user + phone
  const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
  const loginPhone10 = normPhone(req.user?.phone);
  const shipPhone10 = normPhone(contactPhone);

  // ✅ 初始支付快照（unpaid）
  const paymentSnap = {
    status: "unpaid",
    method: "none",
    currency: "USD",

    amountSubtotal: Number(subtotal || 0),
    amountDeliveryFee: Number(deliveryFee || 0),
    amountTax: Number(salesTax || 0),
    amountPlatformFee: 0,
    amountTip: Number(tipFee || 0),
    amountDiscount: Number(discount || 0),
    amountTotal: Number(totalAmount || 0),

    paidTotal: 0,
    walletPaid: 0,
    stripePaid: 0,

    stripePaymentIntentId: "",
    stripeChargeId: "",
    idempotencyKey: "",
    paidAt: null,
    lastError: "",
    refundedTotal: 0,
  };

  // ✅ zone：允许不传，自动用 zip 匹配 Zone
  const zip = String(ship.zip || ship.postalCode || "").trim();
  const { zoneKey, zoneName } = await resolveZoneFromPayload({ zoneId, ship, zip });
  const z = String(zoneKey || "").trim();

  // ✅ deliveryDate：统一按规则计算（解决你“前一天/多天订单混在一起”的根本）
  const finalDeliveryDate = resolveDeliveryDate(mode, deliveryDate);
  const batchKey = z ? buildBatchKey(finalDeliveryDate, z) : "";

  // =====================================================
  // ✅ 履约归类（路线/派单用）
  // 改动：只要有 zone，就全部归入 zone_group（包含 normal/friendGroup）
  // =====================================================
  const fulfillment = z
    ? {
        groupType: "zone_group",
        zoneId: z,
        batchKey,
        batchName: zoneName || "",
      }
    : {
        groupType: "none",
        zoneId: "",
        batchKey: "",
        batchName: "",
      };

  const orderDoc = {
    orderNo: genOrderNo(),

    userId: userId || undefined,
    customerPhone: (loginPhone10 || shipPhone10 || String(contactPhone)).trim(),
    customerName: String(contactName).trim(),

    deliveryType: "home",
    status: "pending",
    orderType,

    // ✅ 配送方式
    deliveryMode: mode,

    // ✅ 真正配送日（路线筛选就靠它）
    deliveryDate: finalDeliveryDate,

    // ✅ 履约归类（后台按批次/路线筛选用）
    fulfillment,

    // ✅ 金额
    subtotal,
    deliveryFee,
    discount,
    totalAmount,

    // ✅ 明细字段
    taxableSubtotal,
    salesTax,
    platformFee,
    tipFee,

    payment: paymentSnap,

    // ✅ 旧字段
    addressText: String(addressText).trim(),
    note: ship.note ? String(ship.note).trim() : "",

    // ✅ 新结构化地址
    address: {
      fullText,
      zip,
      zoneId: z, // ✅ 同步到 address.zoneId（你 schema 有索引）
      lat,
      lng,
    },

    items: cleanItems,
  };

  return { orderDoc, totalAmount, baseTotalAmount };
}

// =====================================================
// ✅ 0.1) 我的订单
// GET /api/orders/my?limit=5&days=30&status=pending
// =====================================================
router.get("/my", requireLogin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const daysRaw = String(req.query.days || "30");
    const status = String(req.query.status || "").trim();

    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    const rawPhone = String(req.user?.phone || "").trim();
    const phone10 = normPhone(rawPhone);

    const q = { $or: [] };

    if (userId) q.$or.push({ userId });

    if (rawPhone) q.$or.push({ customerPhone: rawPhone });
    if (phone10) {
      q.$or.push({ customerPhone: phone10 });
      q.$or.push({ customerPhone: "1" + phone10 });
      q.$or.push({ customerPhone: "+1" + phone10 });
      q.$or.push({ customerPhone: { $regex: phone10 + "$" } });
    }

    if (!q.$or.length) {
      return res.status(400).json({ success: false, message: "用户信息缺失（id/phone）" });
    }

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
        orderType: o.orderType,
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
// ✅ 1.1) 结算一键（支持钱包+后续 Stripe）：
// POST /api/orders/checkout
//
// ✅ 关键修复：
// - 钱包全额支付 => platformFee=0
// - 需要 Stripe(remaining>0) => platformFee=2%*subtotal
// =====================================================
router.post("/checkout", requireLogin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    const { orderDoc, baseTotalAmount } = await buildOrderPayload(req);

    const totalBase = Number(baseTotalAmount || 0);
    if (!Number.isFinite(totalBase) || totalBase <= 0) {
      return res.status(400).json({ success: false, message: "订单金额不合法" });
    }

    let created = null;
    let walletUsed = 0;
    let remaining = 0;
    let newBalance = 0;

    // 最终订单总额（可能包含平台费）
    let finalTotal = round2(totalBase);
    let platformFee = 0;

    await session.withTransaction(async () => {
      // 1) 读取钱包余额（事务内）
      const u0 = await User.findById(userId).select("walletBalance").session(session);
      const balance0 = Number(u0?.walletBalance || 0);

      // ✅ 阶段1：按“基础总额”试算
      walletUsed = round2(Math.min(balance0, finalTotal));
      remaining = round2(finalTotal - walletUsed);

      // ✅ 阶段2：如果需要走 Stripe（remaining>0），才收平台服务费 2%
      if (remaining > 0) {
        platformFee = round2(Number(orderDoc.subtotal || 0) * 0.02);
        finalTotal = round2(finalTotal + platformFee);

        // 重新按“含平台费总额”计算钱包/剩余
        walletUsed = round2(Math.min(balance0, finalTotal));
        remaining = round2(finalTotal - walletUsed);
      }

      // 2) 创建订单（pending）
      const docToCreate = {
        ...orderDoc,

        // ✅ 写入平台费 + 最终总额
        platformFee,
        totalAmount: finalTotal,

        status: "pending",
        paidAt: null,
        payment: {
          ...(orderDoc.payment || {}),

          // ✅ 同步快照
          amountPlatformFee: Number(platformFee || 0),
          amountTotal: Number(finalTotal || 0),

          status: remaining > 0 ? (walletUsed > 0 ? "requires_action" : "unpaid") : "paid",
          method: remaining > 0 ? (walletUsed > 0 ? "wallet" : "none") : "wallet",

          paidTotal: Number(walletUsed || 0),
          walletPaid: Number(walletUsed || 0),
          stripePaid: 0,

          paidAt: remaining <= 0 ? new Date() : null,
        },
      };

      created = await Order.create([docToCreate], { session });
      created = created?.[0] || null;
      if (!created) throw new Error("创建订单失败");

      // 3) 钱包尽可能扣（扣 0 也允许）
      if (walletUsed > 0) {
        const upd = await User.updateOne(
          { _id: userId, walletBalance: { $gte: walletUsed } },
          { $inc: { walletBalance: -walletUsed } },
          { session }
        );

        // 并发极端情况：扣失败，当作钱包不扣，全部走 Stripe
        if (upd.modifiedCount !== 1) {
          walletUsed = 0;
          remaining = round2(finalTotal);

          await Order.updateOne(
            { _id: created._id },
            {
              $set: {
                "payment.status": "unpaid",
                "payment.method": "none",
                "payment.paidTotal": 0,
                "payment.walletPaid": 0,
                "payment.paidAt": null,
              },
            },
            { session }
          );
        }
      }

      const u1 = await User.findById(userId).select("walletBalance").session(session);
      newBalance = Number(u1?.walletBalance || 0);

      // 4) remaining==0：直接标记 paid
      if (remaining <= 0) {
        const now = new Date();
        await Order.updateOne(
          { _id: created._id },
          {
            $set: {
              status: "paid",
              paidAt: now,
              "payment.status": "paid",
              "payment.method": "wallet",
              "payment.paidAt": now,
              "payment.paidTotal": finalTotal,
              "payment.walletPaid": finalTotal,
              "payment.stripePaid": 0,
            },
          },
          { session }
        );
      }
    });

    // 重新读一次最新 payment
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
      paid: remaining <= 0,
      walletBalance: round2(newBalance),

      payment: fresh?.payment || created.payment,
      status: fresh?.status || created.status,

      deliveryMode: fresh?.deliveryMode || created.deliveryMode,
      fulfillment: fresh?.fulfillment || created.fulfillment,
      deliveryDate: fresh?.deliveryDate || created.deliveryDate,

      breakdown: {
        subtotal: round2(fresh?.subtotal || 0),
        deliveryFee: round2(fresh?.deliveryFee || 0),
        salesTax: round2(fresh?.salesTax || 0),
        platformFee: round2(fresh?.platformFee || 0),
        tipFee: round2(fresh?.tipFee || 0),
        discount: round2(fresh?.discount || 0),
        totalAmount: round2(fresh?.totalAmount ?? finalTotal),
        taxableSubtotal: round2(fresh?.taxableSubtotal || 0),
      },
    });
  } catch (err) {
    console.error("POST /api/orders/checkout error:", err);
    return res.status(err?.status || 400).json({ success: false, message: err?.message || "checkout failed" });
  } finally {
    session.endSession();
  }
});

// =====================================================
// ✅ 1.2) Stripe 支付成功后的“落库确认”接口
// POST /api/orders/:id/confirm-stripe
// =====================================================
router.post("/:id([0-9a-fA-F]{24})/confirm-stripe", requireLogin, async (req, res) => {
  try {
    const orderId = req.params.id;
    const stripePaymentIntentId = String(req.body?.stripePaymentIntentId || "").trim();
    const stripePaid = Number(req.body?.stripePaid || 0);
    const stripeChargeId = String(req.body?.stripeChargeId || "").trim();

    if (!stripePaymentIntentId) {
      return res.status(400).json({ success: false, message: "stripePaymentIntentId required" });
    }
    if (!Number.isFinite(stripePaid) || stripePaid <= 0) {
      return res.status(400).json({ success: false, message: "stripePaid must be > 0" });
    }

    const doc = await Order.findById(orderId);
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    // ✅ 基本权限：只能确认自己的订单（或 admin）
    const uid = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (uid && doc.userId && String(doc.userId) !== String(uid) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "无权限" });
    }

    // 幂等：如果已经 paid 直接返回
    if (doc.payment?.status === "paid" || doc.status === "paid") {
      return res.json({ success: true, message: "already paid", orderNo: doc.orderNo });
    }

    const total = Number(doc.totalAmount || 0);
    const walletPaid = Number(doc.payment?.walletPaid || 0);

    const prevStripePaid = Number(doc.payment?.stripePaid || 0);
    const newStripePaid = round2(prevStripePaid + stripePaid);
    const paidTotal = round2(walletPaid + newStripePaid);

    // 防止明显不足（允许 1 cent 误差）
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
      stripePaymentIntentId,
      stripeChargeId: stripeChargeId || doc.payment?.stripeChargeId || "",
      stripePaid: round2(Math.min(newStripePaid, total)),
      paidTotal: round2(Math.min(paidTotal, total)),
      paidAt: now,
      lastError: "",
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
// 2) 用户端：按手机号查订单列表（没登录时用）
// GET /api/orders?phone=xxx
// =====================================================
router.get("/", async (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();
    if (!phone) {
      return res.status(400).json({ success: false, message: "phone 不能为空" });
    }

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
        orderType: o.orderType,

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
        orderType: doc.orderType,

        deliveryMode: doc.deliveryMode,
        fulfillment: doc.fulfillment,

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
        settlementSnapshot: doc.settlementSnapshot,

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
    const { status } = req.body || {};
    const allowed = ["pending", "paid", "packing", "shipping", "done", "cancel"];
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

// =====================================================
// 7) 结算锁
// PATCH /api/orders/:id/settlement-lock
// =====================================================
router.patch("/:id/settlement-lock", async (req, res) => {
  try {
    const { settlementGenerated, settlementId, settlementSnapshot } = req.body || {};

    const patch = {};
    if (settlementGenerated !== undefined) patch.settlementGenerated = !!settlementGenerated;
    if (settlementId !== undefined) patch.settlementId = toObjectIdMaybe(settlementId);
    if (settlementSnapshot !== undefined && typeof settlementSnapshot === "object") {
      patch.settlementSnapshot = {
        driverPay: Number(settlementSnapshot.driverPay || 0),
        leaderCommission: Number(settlementSnapshot.leaderCommission || 0),
        platformTake: Number(settlementSnapshot.platformTake || 0),
      };
    }

    const doc = await Order.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在" });

    return res.json({
      success: true,
      data: {
        id: doc._id.toString(),
        settlementGenerated: doc.settlementGenerated,
        settlementId: doc.settlementId,
        settlementSnapshot: doc.settlementSnapshot,
      },
    });
  } catch (err) {
    console.error("PATCH /api/orders/:id/settlement-lock error:", err);
    return res.status(500).json({ success: false, message: "更新结算锁失败" });
  }
});

export default router;
