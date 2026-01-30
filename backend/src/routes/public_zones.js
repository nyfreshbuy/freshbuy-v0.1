// backend/src/routes/public_zones.js
import express from "express";
import Zone from "../models/Zone.js";

console.log("🚀public_zones.js 已加载");

const router = express.Router();
router.use(express.json());

// 小工具：统一 zone 的 zip 字段兼容（✅ 只取“非空数组”，避免 zips:[] 覆盖 zipWhitelist）
function pickZips(z) {
  const candidates = [z.zips, z.zipWhitelist, z.zipWhiteList, z.zipList];

  for (const arr of candidates) {
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map(String);
    }
  }
  return [];
}

// ✅ 小工具：deliveryDays 归一化（只保留 0..6）
function pickDeliveryDays(z) {
  const arr = Array.isArray(z.deliveryDays) ? z.deliveryDays : [];
  const days = arr
    .map((d) => Number(d))
    .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
  // 去重
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

    // ✅ 新增：把配送字段带给前台
    deliveryDays,
    cutoffTime: String(z.cutoffTime || "").trim(),
    deliveryModes: Array.isArray(z.deliveryModes) ? z.deliveryModes.map(String) : [],
  };
}

// GET /api/public/zones/ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "public_zones", time: new Date().toISOString() });
});

// ✅ GET /api/public/zones/by-zip?zip=11357
router.get("/by-zip", async (req, res) => {
  const zip = String(req.query.zip || "").trim();
  if (!zip) {
    return res.status(400).json({ success: false, message: "Missing zip" });
  }

  try {
    // 取出所有 zone（数量通常不大），在内存里用兼容字段匹配
    const docs = await Zone.find({}).sort({ updatedAt: -1 }).lean();
    const zones = docs.map(normalizeZone);

    // 只匹配 isActive != false 的 zone
    const hit = zones.find((z) => z.isActive !== false && z.zips.includes(zip));

    if (!hit) {
      return res.json({
        success: true,
        supported: false,
        zip,
        zone: null,
      });
    }

    // ✅ 关键：把 deliveryDays/cutoffTime 也返回给前台
    return res.json({
      success: true,
      supported: true,
      zip,
      zone: {
        id: hit.id,
        name: hit.name,
        note: hit.note,
        serviceMode: hit.serviceMode,

        // ✅ 新增字段
        deliveryDays: hit.deliveryDays || [],
        cutoffTime: hit.cutoffTime || "",
        deliveryModes: hit.deliveryModes || [],
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

// GET /api/public/zones
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
