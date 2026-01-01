// backend/src/routes/public_zones.js
import express from "express";
import Zone from "../models/Zone.js";

console.log("🚀public_zones.js 已加载");

const router = express.Router();
router.use(express.json());

// 小工具：统一 zone 的 zip 字段兼容
function pickZips(z) {
  return (
    z.zips ||
    z.zipWhitelist ||
    z.zipWhiteList ||
    z.zipList ||
    []
  );
}
function normalizeZone(z) {
  const zips = pickZips(z);
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
  };
}

// GET /api/public/zones/ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "public_zones", time: new Date().toISOString() });
});

// ✅ 新增：GET /api/public/zones/by-zip?zip=11357
router.get("/by-zip", async (req, res) => {
  const zip = String(req.query.zip || "").trim();
  if (!zip) {
    return res.status(400).json({
      success: false,
      message: "Missing zip",
    });
  }

  try {
    // 取出所有 zone（数量通常不大），在内存里用兼容字段匹配
    const docs = await Zone.find({}).sort({ updatedAt: -1 }).lean();
    const zones = docs.map(normalizeZone);

    // 你也可以加上：只匹配 isActive=true 的 zone
    const hit = zones.find((z) => z.isActive !== false && z.zips.includes(zip));

    if (!hit) {
      return res.json({
        success: true,
        supported: false,
        zip,
        zone: null,
      });
    }

    return res.json({
      success: true,
      supported: true,
      zip,
      zone: {
        id: hit.id,
        name: hit.name,
        note: hit.note,
        serviceMode: hit.serviceMode,
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
