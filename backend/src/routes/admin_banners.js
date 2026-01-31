// backend/src/routes/admin_banners.js
import express from "express";
import Banner from "../models/Banner.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ admin_banners.js loaded ✅");

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "需要管理员权限" });
  next();
}

// 所有接口都要求登录 + 管理员
router.use(requireLogin, requireAdmin);

// GET /api/admin/banners/list
router.get("/list", async (req, res) => {
  const list = await Banner.find({}).sort({ sort: 1, updatedAt: -1 }).lean();
  res.json({ success: true, list });
});

// GET /api/admin/banners/:key
router.get("/:key", async (req, res) => {
  const key = String(req.params.key || "").trim();
  const doc = await Banner.findOne({ key }).lean();
  res.json({ success: true, banner: doc || null });
});

// POST /api/admin/banners/upsert
router.post("/upsert", async (req, res) => {
  const payload = req.body || {};
  const key = String(payload.key || "").trim();
  if (!key) return res.status(400).json({ success: false, message: "key 必填" });

  const cleanButtons = Array.isArray(payload.buttons)
    ? payload.buttons
        .map((b) => ({
          label: String(b?.label || "").trim(),
          link: String(b?.link || "").trim(),
        }))
        .filter((b) => b.label)
    : [];

  const update = {
    key,
    enabled: payload.enabled !== false,
    title: String(payload.title || ""),
    subtitle: String(payload.subtitle || ""),
    bgColor: String(payload.bgColor || "#22c55e"),
    imageUrl: String(payload.imageUrl || ""),
    buttons: cleanButtons,
    sort: Number(payload.sort || 0),
  };

  const doc = await Banner.findOneAndUpdate({ key }, update, { upsert: true, new: true });
  res.json({ success: true, banner: doc });
});

// POST /api/admin/banners/delete
router.post("/delete", async (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (!key) return res.status(400).json({ success: false, message: "key 必填" });
  await Banner.deleteOne({ key });
  res.json({ success: true });
});

export default router;
