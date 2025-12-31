// backend/src/routes/public_zones.js
import express from "express";
import Zone from "../models/Zone.js";

console.log("🚀public_zones.js 已加载");

const router = express.Router();
router.use(express.json());

// GET /api/public/zones/ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "public_zones", time: new Date().toISOString() });
});

// GET /api/public/zones
router.get("/", async (req, res) => {
  try {
    const docs = await Zone.find({}).sort({ updatedAt: -1 }).lean();

    const zones = docs.map((z) => {
      const zips =
        z.zips ||
        z.zipWhitelist ||
        z.zipWhiteList ||
        z.zipList ||
        [];

      return {
        _id: String(z._id),
        id: String(z._id),
        name: z.name || z.zoneName || "",
        note: z.note || z.zoneNote || "",
        zips: Array.isArray(zips) ? zips.map(String) : [],
        polygon: z.polygon || z.polygonPaths || null,
        updatedAt: z.updatedAt || null,
      };
    });

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
