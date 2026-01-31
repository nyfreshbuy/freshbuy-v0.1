// backend/src/routes/banners.js
import express from "express";
import Banner from "../models/Banner.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ banners.js LOADED:", import.meta.url);

// =========================
// 工具：管理员校验（跟你项目其它 admin 路由一致）
// =========================
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "需要管理员权限" });
  next();
}

function toStr(v, def = "") {
  const s = String(v ?? "").trim();
  return s ? s : def;
}
function toBool(v, def = false) {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return def;
}
function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeButtons(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((x) => ({
      label: toStr(x?.label, ""),
      link: toStr(x?.link, ""),
    }))
    .filter((x) => x.label);
}

function normalizeSlides(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((x) => ({
      enabled: toBool(x?.enabled, true),
      sort: toNum(x?.sort, 0),
      imageUrl: toStr(x?.imageUrl, ""),
      link: toStr(x?.link, ""),
      title: toStr(x?.title, ""),
      subtitle: toStr(x?.subtitle, ""),
      bgColor: toStr(x?.bgColor, ""),
    }))
    // 允许图片为空（你可能想用纯色 + 文案），但至少要有 imageUrl 或 bgColor 或 title/subtitle 之一
    .filter((x) => x.imageUrl || x.bgColor || x.title || x.subtitle);
}

function presentBanner(doc) {
  if (!doc) return null;

  const slides = Array.isArray(doc.slides) ? doc.slides : [];
  const slidesSorted = slides
    .filter((s) => s && s.enabled !== false)
    .sort((a, b) => (Number(a.sort || 0) - Number(b.sort || 0)));

  return {
    ...doc,
    slides: slidesSorted,
  };
}

// =========================
// ✅ 公开：GET /api/banners/:key
// - 前台首页从这里读
// =========================
router.get("/:key", async (req, res) => {
  try {
    const key = toStr(req.params.key, "");
    if (!key) return res.json({ success: false, banner: null });

    const doc = await Banner.findOne({ key }).lean();

    // 没有配置 / 被禁用 => success=false，让前端用默认写死的
    if (!doc || doc.enabled === false) {
      return res.json({ success: false, banner: null });
    }

    return res.json({ success: true, banner: presentBanner(doc) });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "server error" });
  }
});

// =======================================================
// ✅✅✅ 后台：需要管理员
// 说明：为了不影响你现有路由，统一挂在 /api/banners/admin/*
// =======================================================

// 列表：后台用于“选择要编辑哪个 banner”
router.get("/admin/list", requireLogin, requireAdmin, async (req, res) => {
  try {
    const list = await Banner.find({})
      .sort({ sort: 1, updatedAt: -1 })
      .lean();

    return res.json({
      success: true,
      list: (list || []).map((x) => ({
        key: x.key,
        enabled: x.enabled !== false,
        title: x.title || "",
        subtitle: x.subtitle || "",
        sort: Number(x.sort || 0),
        updatedAt: x.updatedAt,
        slideCount: Array.isArray(x.slides) ? x.slides.length : 0,
      })),
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "server error" });
  }
});

// 读取某个 banner（后台编辑页加载用）
router.get("/admin/:key", requireLogin, requireAdmin, async (req, res) => {
  try {
    const key = toStr(req.params.key, "");
    if (!key) return res.status(400).json({ success: false, message: "missing key" });

    const doc = await Banner.findOne({ key }).lean();
    if (!doc) return res.json({ success: true, banner: null });

    return res.json({ success: true, banner: presentBanner(doc) });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "server error" });
  }
});

// 保存/更新（upsert）：后台编辑页点“保存”用这个
// body: { key, enabled, sort, title, subtitle, bgColor, imageUrl, buttons, slides }
router.post("/admin/upsert", requireLogin, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const key = toStr(body.key, "");
    if (!key) return res.status(400).json({ success: false, message: "key required" });

    const payload = {
      key,
      enabled: toBool(body.enabled, true),
      sort: toNum(body.sort, 0),

      // 兼容旧字段（单横幅）
      title: toStr(body.title, ""),
      subtitle: toStr(body.subtitle, ""),
      bgColor: toStr(body.bgColor, "#22c55e"),
      imageUrl: toStr(body.imageUrl, ""),
      buttons: normalizeButtons(body.buttons),

      // ✅ 新增：多轮播
      slides: normalizeSlides(body.slides),
    };

    const doc = await Banner.findOneAndUpdate(
      { key },
      { $set: payload },
      { new: true, upsert: true }
    ).lean();

    return res.json({ success: true, banner: presentBanner(doc) });
  } catch (e) {
    // unique key 冲突等
    return res.status(500).json({ success: false, message: e?.message || "server error" });
  }
});

export default router;
