// backend/src/routes/banners.js
import express from "express";
import Banner from "../models/Banner.js";

const router = express.Router();
router.use(express.json());

console.log("✅ banners.js LOADED:", import.meta.url);

// GET /api/banners/:key  (公开)
router.get("/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    const doc = await Banner.findOne({ key }).lean();

    // 没有配置就返回 success=false，让前端用默认
    if (!doc || doc.enabled === false) {
      return res.json({ success: false, banner: null });
    }
    return res.json({ success: true, banner: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "server error" });
  }
});

export default router;
