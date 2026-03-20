// backend/src/routes/public_zones.js
import express from "express";
import Zone from "../models/Zone.js";
import Order from "../models/order.js";
import PickupPoint from "../models/PickupPoint.js";

console.log("🚀public_zones.js 已加载");

const router = express.Router();
router.use(express.json());

// =======================================================
// 小工具：统一 zone 的 zip 字段兼容
// =======================================================
function pickZips(z) {
  const candidates = [z.zips, z.zipWhitelist, z.zipWhiteList, z.zipList];
  for (const arr of candidates) {
    if (Array.isArray(arr) && arr.length > 0) return arr.map(String);
  }
  return [];
}

// ✅ 小工具：deliveryDays 归一化
function pickDeliveryDays(z) {
  const arr = Array.isArray(z.deliveryDays) ? z.deliveryDays : [];
  const days = arr
    .map((d) => Number(d))
    .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
  return Array.from(new Set(days));
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

    deliveryDays,
    cutoffTime: String(z.cutoffTime || "").trim(),
    deliveryModes: Array.isArray(z.deliveryModes) ? z.deliveryModes.map(String) : [],

    fakeJoinedOrders: Number(z.fakeJoinedOrders ?? z.fakeBoost ?? 0) || 0,
    needOrders: Number(z.needOrders ?? z.groupNeedOrders ?? 50) || 50,
  };
}

function normalizePickupPoint(p) {
  return {
    id: String(p._id),
    name: String(p.name || "").trim(),
    leaderName: String(p.leaderName || "").trim(),
    leaderPhone: String(p.leaderPhone || "").trim(),

    addressLine1: String(p.addressLine1 || "").trim(),
    city: String(p.city || "").trim(),
    state: String(p.state || "").trim(),
    zip: String(p.zip || "").trim(),

    displayArea: String(p.displayArea || "").trim(),
    maskedAddress: String(p.maskedAddress || "").trim(),
    pickupTimeText: String(p.pickupTimeText || "").trim(),

    lat: Number.isFinite(Number(p.lat)) ? Number(p.lat) : null,
    lng: Number.isFinite(Number(p.lng)) ? Number(p.lng) : null,

    enabled: p.enabled !== false,
  };
}

// GET /api/public/zones/ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "public_zones", time: new Date().toISOString() });
});

// =======================================================
// GET /api/public/zones/by-zip?zip=11357
// 返回：zone 基本信息 + 配送字段 + 拼团统计 + 自提点
// =======================================================
router.get("/by-zip", async (req, res) => {
  const zip = String(req.query.zip || "").trim();
  if (!zip) return res.status(400).json({ success: false, message: "Missing zip" });

  try {
    const docs = await Zone.find({}).sort({ updatedAt: -1 }).lean();
    const zones = docs.map(normalizeZone);

    const hit = zones.find((z) => z.isActive !== false && z.zips.includes(zip));

    // ✅ 查询可用自提点
    const pickupDocs = await PickupPoint.find({
      enabled: true,
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    let pickupPoints = pickupDocs.map(normalizePickupPoint);

    // ✅ 优先显示同 ZIP 的点；如果没有同 ZIP，就返回全部点
    const sameZipPickupPoints = pickupPoints.filter((p) => String(p.zip) === zip);
    if (sameZipPickupPoints.length > 0) {
      pickupPoints = sameZipPickupPoints;
    }

    if (!hit) {
      return res.json({
        success: true,
        supported: false,
        zip,
        zone: null,
        pickupPoints,
      });
    }

    const zoneId = String(hit.id);

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
        deliveryDays: hit.deliveryDays || [],
        cutoffTime: hit.cutoffTime || "",
        deliveryModes: hit.deliveryModes || [],
        realJoinedOrders: realJoined,
        fakeJoinedOrders: fakeJoined,
        needOrders,
        joinedTotal,
        remainOrders,
      },
      pickupPoints,
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
// GET /api/public/zones/group-stats?zip=11365
// =======================================================
router.get("/group-stats", async (req, res) => {
  const zip = String(req.query.zip || "").trim();
  if (!zip) return res.status(400).json({ success: false, message: "Missing zip" });

  try {
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

    const realJoined = await Order.countDocuments({
      $and: [
        {
          $or: [
            { "address.zip": zip },
            { "address.postalCode": zip },
            { addressZip: zip },
            { addressText: { $regex: zip } },
          ],
        },
        { deliveryMode: "groupDay" },
        { status: { $in: ["paid", "packing", "shipping", "delivered"] } },
      ],
    });

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