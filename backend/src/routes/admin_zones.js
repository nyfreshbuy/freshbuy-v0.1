// backend/src/routes/admin_zones.js
import express from "express";
import Zone from "../models/Zone.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🚀 admin_zones.js (MongoDB版) 已加载");

// --------------------------
// 工具：Zip 归一化
// - 支持 textarea：空格/换行/逗号/分号
// - 去重
// - 只保留 5 位数字
// --------------------------
function normalizeZipList(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || "").split(/[\s,;]+/);

  const out = [];
  const seen = new Set();

  for (const item of raw) {
    const z = String(item || "").trim();
    if (!z) continue;
    if (!/^\d{5}$/.test(z)) continue;
    if (seen.has(z)) continue;
    seen.add(z);
    out.push(z);
  }
  return out;
}

// ✅ 兼容：新字段 zipWhitelist / 旧字段 zips
function pickZipWhitelist(body) {
  if (body?.zipWhitelist !== undefined) return normalizeZipList(body.zipWhitelist);
  if (body?.zips !== undefined) return normalizeZipList(body.zips);
  return [];
}

// ✅ 统一错误返回（关键：把 detail 带出去）
function sendErr(res, err, where = "") {
  console.error(`❌ ${where} error:`, err);

  // Mongo duplicate key
  if (err?.code === 11000) {
    return res.status(409).json({
      ok: false,
      success: false,
      message: "duplicate key",
      detail: err?.keyValue || err?.message,
    });
  }

  // Mongoose validation error
  if (err?.name === "ValidationError") {
    return res.status(400).json({
      ok: false,
      success: false,
      message: "validation error",
      detail: err?.message,
    });
  }

  return res.status(500).json({
    ok: false,
    success: false,
    message: "server error",
    detail: err?.message || String(err),
  });
}

// --------------------------
// ✅ 后台：列表
// GET /api/admin/zones
// --------------------------
router.get("/", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, success: false, message: "forbidden" });
    }

    const docs = await Zone.find({})
      .sort({ createdAt: -1 })
      .select("_id name zipWhitelist zips note deliveryModes cutoffTime deliveryDays polygon createdAt updatedAt zoneId slug");

    const zones = docs.map((z) => {
      const whitelist = Array.isArray(z.zipWhitelist) ? z.zipWhitelist : [];
      const legacy = Array.isArray(z.zips) ? z.zips : [];
      return {
        _id: z._id.toString(),
        id: z._id.toString(),
        name: z.name,
        zipWhitelist: whitelist.length ? whitelist : legacy,
        zips: whitelist.length ? whitelist : legacy, // 兼容旧前端
        note: z.note || "",
        deliveryModes: z.deliveryModes || [],
        cutoffTime: z.cutoffTime || "",
        deliveryDays: z.deliveryDays || [],
        polygon: z.polygon || null,
        zoneId: z.zoneId || "",
        slug: z.slug || "",
        createdAt: z.createdAt,
        updatedAt: z.updatedAt,
      };
    });

    return res.json({ ok: true, success: true, zones });
  } catch (err) {
    return sendErr(res, err, "GET /api/admin/zones");
  }
});

// --------------------------
// ✅ 后台：获取单个
// GET /api/admin/zones/:id
// --------------------------
router.get("/:id", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, success: false, message: "forbidden" });
    }

    const doc = await Zone.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, success: false, message: "not found" });

    const whitelist = Array.isArray(doc.zipWhitelist) ? doc.zipWhitelist : [];
    const legacy = Array.isArray(doc.zips) ? doc.zips : [];

    return res.json({
      ok: true,
      success: true,
      zone: {
        _id: doc._id.toString(),
        id: doc._id.toString(),
        name: doc.name,
        zipWhitelist: whitelist.length ? whitelist : legacy,
        zips: whitelist.length ? whitelist : legacy,
        note: doc.note || "",
        deliveryModes: doc.deliveryModes || [],
        cutoffTime: doc.cutoffTime || "",
        deliveryDays: doc.deliveryDays || [],
        polygon: doc.polygon || null,
        zoneId: doc.zoneId || "",
        slug: doc.slug || "",
      },
    });
  } catch (err) {
    return sendErr(res, err, "GET /api/admin/zones/:id");
  }
});

// --------------------------
// ✅ 后台：新建
// POST /api/admin/zones
// body: { name, zipWhitelist|zips, note, polygon, ... }
// --------------------------
router.post("/", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, success: false, message: "forbidden" });
    }

    const { name, note, deliveryModes, cutoffTime, deliveryDays, polygon } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ ok: false, success: false, message: "name required" });
    }

    const zipWhitelist = pickZipWhitelist(req.body);

    // ✅ 如果你的 Zone 模型还要求 zoneId/slug（旧版），这里也兼容写入
    const zoneId = String(req.body?.zoneId || "").trim();
    const slug = String(req.body?.slug || "").trim();

    const doc = await Zone.create({
      name: name.trim(),
      zipWhitelist,
      // 旧字段兼容（即使模型没有也不会出错）
      zips: zipWhitelist,
      zoneId: zoneId || undefined,
      slug: slug || undefined,

      note: String(note || ""),
      deliveryModes: Array.isArray(deliveryModes) ? deliveryModes : [],
      cutoffTime: String(cutoffTime || ""),
      deliveryDays: Array.isArray(deliveryDays) ? deliveryDays : [],
      polygon: polygon || null,
    });

    return res.json({ ok: true, success: true, id: doc._id.toString() });
  } catch (err) {
    return sendErr(res, err, "POST /api/admin/zones");
  }
});

// --------------------------
// ✅ 后台：更新
// PATCH /api/admin/zones/:id
// --------------------------
router.patch("/:id", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, success: false, message: "forbidden" });
    }

    const { name, note, deliveryModes, cutoffTime, deliveryDays, polygon } = req.body || {};

    const update = {};
    if (typeof name === "string" && name.trim()) update.name = name.trim();
    if (note !== undefined) update.note = String(note || "");
    if (deliveryModes !== undefined) update.deliveryModes = Array.isArray(deliveryModes) ? deliveryModes : [];
    if (cutoffTime !== undefined) update.cutoffTime = String(cutoffTime || "");
    if (deliveryDays !== undefined) update.deliveryDays = Array.isArray(deliveryDays) ? deliveryDays : [];
    if (polygon !== undefined) update.polygon = polygon || null;

    // ✅ zipWhitelist 兼容写入
    if (req.body?.zipWhitelist !== undefined || req.body?.zips !== undefined) {
      const wl = pickZipWhitelist(req.body);
      update.zipWhitelist = wl;
      update.zips = wl; // 旧字段兼容
    }

    // ✅ 旧字段兼容（如果你的模型有 zoneId/slug unique）
    if (req.body?.zoneId !== undefined) update.zoneId = String(req.body.zoneId || "").trim();
    if (req.body?.slug !== undefined) update.slug = String(req.body.slug || "").trim();

    const doc = await Zone.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ ok: false, success: false, message: "not found" });

    return res.json({ ok: true, success: true });
  } catch (err) {
    return sendErr(res, err, "PATCH /api/admin/zones/:id");
  }
});

// --------------------------
// ✅ 后台：删除
// DELETE /api/admin/zones/:id
// --------------------------
router.delete("/:id", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, success: false, message: "forbidden" });
    }

    const doc = await Zone.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, success: false, message: "not found" });

    return res.json({ ok: true, success: true });
  } catch (err) {
    return sendErr(res, err, "DELETE /api/admin/zones/:id");
  }
});

export default router;
