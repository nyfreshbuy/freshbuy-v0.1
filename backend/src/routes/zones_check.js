// backend/src/routes/zones_check.js
import express from "express";
import Zone from "../models/Zone.js";

console.log("✅ zones_check.js 已加载");

const router = express.Router();
router.use(express.json());

function normZip(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{5})/);
  return m ? m[1] : "";
}

// GET /api/zones/check/ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "zones_check", time: new Date().toISOString() });
});

// GET /api/zones/check?zip=11365
router.get("/", async (req, res) => {
  try {
    const zip = normZip(req.query.zip);
    if (!zip) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid zip. Example: /api/zones/check?zip=11365",
      });
    }

    const docs = await Zone.find({}).lean();

    let hit = null;
    for (const z of docs) {
      const zips =
        z.zips ||
        z.zipWhitelist ||
        z.zipWhiteList ||
        z.zipList ||
        [];

      if (Array.isArray(zips) && zips.map(String).includes(zip)) {
        hit = z;
        break;
      }
    }

    if (!hit) {
      return res.json({
        success: true,
        zip,
        deliverable: false,
        zone: null,
      });
    }

    res.json({
      success: true,
      zip,
      deliverable: true,
      zone: {
        _id: String(hit._id),
        id: String(hit._id),
        name: hit.name || hit.zoneName || "",
        note: hit.note || hit.zoneNote || "",
      },
    });
  } catch (err) {
    console.error("❌ zones_check error:", err?.message || err);
    res.status(500).json({
      success: false,
      message: "Failed to check zip",
      error: err?.message || String(err),
    });
  }
});

export default router;
