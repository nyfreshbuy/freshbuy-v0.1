// backend/src/routes/zones_public_list.js
import express from "express";
import Zone from "../models/Zone.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🚀 zones_public_list.js 已加载（提供 /api/zones/list）");

// ✅ 统一：把 Zone doc 映射为 picklist.js 期望的结构
function toPicklistZone(z) {
  const whitelist = Array.isArray(z.zipWhitelist) ? z.zipWhitelist : [];
  const legacy = Array.isArray(z.zips) ? z.zips : [];
  const zips = whitelist.length ? whitelist : legacy;

  // zoneKey：优先 zoneId / slug，否则用 _id
  const zoneKey = String(z.zoneId || z.slug || z._id || "");
  const zoneName = String(z.name || zoneKey || "未命名区域");

  return {
    zoneKey,
    zoneName,
    zips,
  };
}

// --------------------------
// ✅ 供后台 picklist 用的 zones list
// GET /api/zones/list
// 返回：{ success:true, zones:[{zoneKey, zoneName, zips:[]}, ...] }
// --------------------------
router.get("/list", requireLogin, async (req, res) => {
  try {
    // ✅ 只给 admin 用（因为你的前端会带 admin token）
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, success: false, message: "forbidden" });
    }

    const docs = await Zone.find({})
      .sort({ createdAt: -1 })
      .select("_id name zipWhitelist zips zoneId slug createdAt updatedAt");

    const zones = docs.map(toPicklistZone);

    return res.json({ ok: true, success: true, zones });
  } catch (err) {
    console.error("❌ GET /api/zones/list error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "server error",
      detail: err?.message || String(err),
    });
  }
});

export default router;
