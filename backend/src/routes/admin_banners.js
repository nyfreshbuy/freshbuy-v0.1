// backend/src/routes/admin_banners.js
import express from "express";
import Banner from "../models/Banner.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());
router.use(requireLogin);

// ✅ 你项目里通常用 req.user.role === "admin"
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "需要管理员权限" });
  next();
}

router.use(requireAdmin);

// ✅ 列表：GET /api/admin/banners
router.get("/", async (req, res) => {
  try {
    const list = await Banner.find({})
      .sort({ sort: 1, updatedAt: -1 })
      .select("key enabled title subtitle sort updatedAt createdAt")
      .lean();

    return res.json({ success: true, list: list || [] });
  } catch (e) {
    console.error("GET /api/admin/banners error:", e);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

// ✅ 读取：GET /api/admin/banners/:key
router.get("/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ success: false, message: "missing key" });

    const banner = await Banner.findOne({ key }).lean();
    return res.json({ success: true, banner: banner || null });
  } catch (e) {
    console.error("GET /api/admin/banners/:key error:", e);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

// ✅ 新建：POST /api/admin/banners
router.post("/", async (req, res) => {
  try {
    const key = String(req.body.key || "").trim();
    if (!key) return res.status(400).json({ success: false, message: "key required" });

    const exists = await Banner.findOne({ key }).lean();
    if (exists) return res.status(409).json({ success: false, message: "key already exists" });

    const doc = await Banner.create({
      key,
      enabled: true,
      title: "",
      subtitle: "",
      bgColor: "#22c55e",
      imageUrl: "",
      buttons: [],
      slides: [],
      sort: 0,
    });

    return res.json({ success: true, banner: doc });
  } catch (e) {
    console.error("POST /api/admin/banners error:", e);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

// ✅ 保存/更新：PUT /api/admin/banners/:key
router.put("/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ success: false, message: "missing key" });

    const payload = req.body || {};

    // ✅ 只允许这些字段（避免乱写）
    const update = {
      enabled: payload.enabled !== false,
      title: String(payload.title || ""),
      subtitle: String(payload.subtitle || ""),
      bgColor: String(payload.bgColor || "#22c55e"),
      imageUrl: String(payload.imageUrl || ""),
      sort: Number(payload.sort || 0),
      buttons: Array.isArray(payload.buttons) ? payload.buttons : [],
      slides: Array.isArray(payload.slides) ? payload.slides : [],
    };

    const doc = await Banner.findOneAndUpdate(
      { key },
      { $set: update },
      { new: true, upsert: true } // 没有就创建
    ).lean();

    return res.json({ success: true, banner: doc });
  } catch (e) {
    console.error("PUT /api/admin/banners/:key error:", e);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

// ✅ 删除：DELETE /api/admin/banners/:key
router.delete("/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ success: false, message: "missing key" });

    await Banner.deleteOne({ key });
    return res.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/admin/banners/:key error:", e);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

export default router;
