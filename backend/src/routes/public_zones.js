// backend/src/routes/public_zones.js
import express from "express";
import Zone from "../models/Zone.js";
import Order from "../models/order.js"; // ✅ 新增：用于统计真实订单（如报错改成 ../models/Order.js）

console.log("🚀public_zones.js 已加载");

const router = express.Router();
router.use(express.json());

// =======================================================
// 小工具：统一 zone 的 zip 字段兼容
// ✅ 只取“非空数组”，避免 zips:[] 覆盖 zipWhitelist
// =======================================================
function pickZips(z) {
  const candidates = [z.zips, z.zipWhitelist, z.zipWhiteList, z.zipList];
  for (const arr of candidates) {
    if (Array.isArray(arr) && arr.length > 0) return arr.map(String);
  }
  return [];
}

// ✅ 小工具：deliveryDays 归一化（只保留 0..6）
function pickDeliveryDays(z) {
  const arr = Array.isArray(z.deliveryDays) ? z.deliveryDays : [];
  const days = arr
    .map((d) => Number(d))
    .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
  return Array.from(new Set(days)); // 去重
}

function normalizeZone(z) {
  const zips = pickZips(z);
  const deliveryDays = pickDeliveryDays(z);

  return {
    _id: String(z._id),
    id: String(z._id),
    name: z.name || z.zoneName || "",
    note: z.note || z.zoneNote || "",
    zips: Array.isArray(zips) ? zips.map(String) : [],
    polygon: z.polygon || z.polygonPaths || null,
    isActive: typeof z.isActive === "boolean" ? z.isActive : true,
    serviceMode: z.serviceMode || z.deliveryMode || "groupDay",
    updatedAt: z.updatedAt || null,

    // ✅ 带给前台：配送字段
    deliveryDays,
    cutoffTime: String(z.cutoffTime || "").trim(),
    deliveryModes: Array.isArray(z.deliveryModes) ? z.deliveryModes.map(String) : [],

    // ✅ 可选：拼团假数据 / 目标单（如果你 Zone 里有这些字段就会生效）
    fakeJoinedOrders: Number(z.fakeJoinedOrders ?? z.fakeBoost ?? 0) || 0,
    needOrders: Number(z.needOrders ?? z.groupNeedOrders ?? 50) || 50,
  };
}

// GET /api/public/zones/ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "public_zones", time: new Date().toISOString() });
});

// =======================================================
// ✅ GET /api/public/zones/by-zip?zip=11357
// 返回 zone 基本信息 + deliveryDays/cutoffTime/deliveryModes
// =======================================================
// =======================================================
// ✅ GET /api/public/zones/by-zip?zip=11357
// 返回：zone 基本信息 + 配送字段 + 拼团统计（真实+虚假）
// =======================================================
router.get("/by-zip", async (req, res) => {
  const zip = String(req.query.zip || "").trim();
  if (!zip) return res.status(400).json({ success: false, message: "Missing zip" });

  try {
    const docs = await Zone.find({}).sort({ updatedAt: -1 }).lean();
    const zones = docs.map(normalizeZone);

    // 只匹配 isActive != false 的 zone
    const hit = zones.find((z) => z.isActive !== false && z.zips.includes(zip));

    if (!hit) {
      return res.json({ success: true, supported: false, zip, zone: null });
    }

    const zoneId = String(hit.id);

    // ✅ 统计真实订单数（区域团 + 已支付/有效订单）
    const realJoined = await Order.countDocuments({
      $and: [
        {
          $or: [
            { "zone.id": zoneId },
            { "zone._id": zoneId },
            { zoneId: zoneId },
            { zone: zoneId },
          ],
        },
        {
          $or: [
            { mode: "groupDay" },
            { deliveryMode: "groupDay" },
            { serviceMode: "groupDay" },
          ],
        },
        {
          $or: [
            { paid: true },
            { isPaid: true },
            { status: { $in: ["paid", "packing", "shipping", "delivered"] } },
          ],
        },
      ],
    });

    // ✅ 虚假加成 & 目标单
    const fakeJoined = Math.max(0, Math.floor(Number(hit.fakeJoinedOrders || 0) || 0));
    const needOrders = Math.max(1, Math.floor(Number(hit.needOrders || 50) || 50));

    const joinedTotal = realJoined + fakeJoined;
    const remainOrders = Math.max(0, needOrders - joinedTotal);

    return res.json({
      success: true,
      supported: true,
      zip,
      zone: {
        id: hit.id,
        name: hit.name,
        note: hit.note,
        serviceMode: hit.serviceMode,

        // 配送字段
        deliveryDays: hit.deliveryDays || [],
        cutoffTime: hit.cutoffTime || "",
        deliveryModes: hit.deliveryModes || [],

        // ✅ 拼团字段（首页直接展示用这些）
        realJoinedOrders: realJoined,
        fakeJoinedOrders: fakeJoined,
        needOrders,
        joinedTotal,
        remainOrders,
      },
    });
  } catch (err) {
    console.error("❌ public_zones by-zip error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Failed to resolve zone by zip",
      error: err?.message || String(err),
    });
  }
});
// =======================================================
// ✅ 新增：GET /api/public/zones/group-stats?zip=11365
// 返回：真实订单数 + 虚假加成 + 目标单数 + 还差多少
// =======================================================
router.get("/group-stats", async (req, res) => {
  const zip = String(req.query.zip || "").trim();
  if (!zip) return res.status(400).json({ success: false, message: "Missing zip" });

  try {
    // 1) 先定位 zone（复用 normalize）
    const docs = await Zone.find({}).sort({ updatedAt: -1 }).lean();
    const zones = docs.map(normalizeZone);

    const hit = zones.find((z) => z.isActive !== false && z.zips.includes(zip));
    if (!hit) {
      return res.json({
        success: true,
        supported: false,
        zip,
        zone: null,
        stats: {
          realJoined: 0,
          fakeJoined: 0,
          joinedOrders: 0,
          needOrders: 50,
          remain: 50,
        },
      });
    }

    const zoneId = String(hit.id);

    // 2) 统计真实订单数（尽量兼容你 Order 里 zone 字段各种写法）
    //    条件：区域团(groupDay) + 已支付/已付款（你也可以按你的状态体系再收紧）
    // ✅ 按 ZIP 统计真实已拼（因为订单里没有 zoneId）
const realJoined = await Order.countDocuments({
  $and: [
    // 订单属于这个 ZIP（优先用结构化字段，其次用 addressText）
    {
      $or: [
        { "address.zip": zip },
        { "address.postalCode": zip },
        { addressZip: zip },
        { addressText: { $regex: zip } }, // 兜底
      ],
    },

    // 只算区域团
    { deliveryMode: "groupDay" },

    // 只算已支付/有效
    { status: { $in: ["paid", "packing", "shipping", "delivered"] } },
  ],
});

    // 3) 虚假加成 & 目标单（从 Zone 取，如果没字段就默认）
    const fakeJoined = Math.max(0, Math.floor(Number(hit.fakeJoinedOrders || 0) || 0));
    const needOrders = Math.max(1, Math.floor(Number(hit.needOrders || 50) || 50));

    const joinedOrders = realJoined + fakeJoined;
    const remain = Math.max(0, needOrders - joinedOrders);

    return res.json({
      success: true,
      supported: true,
      zip,
      zone: {
        id: hit.id,
        name: hit.name,
        note: hit.note,
        serviceMode: hit.serviceMode,

        // ✅ 也顺便带回去，方便前台不用再调 by-zip
        deliveryDays: hit.deliveryDays || [],
        cutoffTime: hit.cutoffTime || "",
        deliveryModes: hit.deliveryModes || [],
      },
      stats: {
        realJoined,
        fakeJoined,
        joinedOrders,
        needOrders,
        remain,
      },
    });
  } catch (err) {
    console.error("❌ public_zones group-stats error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Failed to load group stats",
      error: err?.message || String(err),
    });
  }
});

// =======================================================
// GET /api/public/zones
// =======================================================
router.get("/", async (req, res) => {
  try {
    const docs = await Zone.find({}).sort({ updatedAt: -1 }).lean();
    const zones = docs.map(normalizeZone);
    res.json({ success: true, zones });
  } catch (err) {
    console.error("❌ public_zones error:", err?.message || err);
    res.status(500).json({
      success: false,
      message: "Failed to load zones",
      error: err?.message || String(err),
    });
  }
});

export default router;
