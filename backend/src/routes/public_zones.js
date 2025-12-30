// backend/src/routes/public_zones.js
import express from "express";
import Zone from "../models/Zone.js";

const router = express.Router();

console.log("🚀public_zones.js 已加载");

// GET /api/zones/by-zip?zip=11365
router.get("/by-zip", async (req, res) => {
  try {
    const zip = String(req.query.zip || "").trim();

    if (!/^\d{5}$/.test(zip)) {
      return res.status(400).json({ ok: false, message: "invalid zip" });
    }

    const zone = await Zone.findOne({ zipWhitelist: zip }).select(
      "_id name zipWhitelist deliveryModes cutoffTime deliveryDays note"
    );

    // ✅ 不支持配送：返回 ok:true，但 deliverable:false（这不是“接口失败”）
    if (!zone) {
      return res.json({
        ok: true,
        deliverable: false,
        zip,
        reason: "该邮编暂不支持配送",
      });
    }

    return res.json({
      ok: true,
      deliverable: true,
      zip,
      zone: {
        id: zone._id.toString(),
        name: zone.name,
        zipWhitelist: zone.zipWhitelist || [],
        deliveryModes: zone.deliveryModes || [],
        cutoffTime: zone.cutoffTime || "",
        deliveryDays: zone.deliveryDays || [],
        note: zone.note || "",
      },
    });
  } catch (err) {
    console.error("GET /api/zones/by-zip error:", err);
    res.status(500).json({ ok: false, message: "server error" });
  }
});

export default router;
