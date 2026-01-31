// backend/src/routes/banners.js
import express from "express";
import Banner from "../models/Banner.js";

const router = express.Router();

// ✅ GET /api/banners/:key
// - 前台取 banner 用
// - 默认只返回 enabled=true 的 banner
// - slides 会按 enabled + sort 排序
router.get("/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ success: false, message: "missing key" });

    const banner = await Banner.findOne({ key }).lean();
    if (!banner) return res.json({ success: true, banner: null });

    // 如果 banner 没启用，前台当作没有
    if (banner.enabled === false) return res.json({ success: true, banner: null });

    // slides：过滤 enabled + 排序（前台更省事）
    const slides = Array.isArray(banner.slides) ? banner.slides : [];
    const filteredSlides = slides
      .filter((s) => s && s.enabled !== false)
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));

    const out = {
      ...banner,
      slides: filteredSlides,
    };

    // ✅ 禁止缓存（你现在就是“改了不生效”最常见原因之一）
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.json({ success: true, banner: out });
  } catch (e) {
    console.error("GET /api/banners/:key error:", e);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

export default router;
