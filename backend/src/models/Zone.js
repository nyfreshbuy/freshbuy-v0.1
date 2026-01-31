// backend/src/routes/zones.js
import express from "express";
import Zone from "../models/Zone.js";

const router = express.Router();
router.use(express.json());

console.log("✅ zones.js LOADED:", import.meta.url);

// =========================
// 工具：ZIP 规范化（只取前 5 位）
// =========================
function normalizeZip(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{5})/);
  return m ? m[1] : "";
}

// =========================
// 工具：判断 zone 是否包含 zip
// （兼容 zipWhitelist / zips / zipWhiteList / zipList）
// =========================
function zoneHasZip(zone, zip) {
  const lists = []
    .concat(zone.zipWhitelist || [])
    .concat(zone.zips || [])
    .concat(zone.zipWhiteList || [])
    .concat(zone.zipList || []);

  const set = new Set(lists.map(normalizeZip).filter(Boolean));
  return set.has(zip);
}

// =========================
// 工具：把 Zone 转成前台需要的结构（并附带拼单进度）
// =========================
function toPublicZone(zone) {
  // ✅ 成团展示字段（真实 + 虚假）
  const needOrders = Number(zone.needOrders || 0);
  const fakeJoinedOrders = Number(zone.fakeJoinedOrders || 0);

  // 你当前 Zone model 里没有 joinedOrders 字段，这里兜底为 0
  const joinedOrders = Number(zone.joinedOrders || 0);

  const joinedTotal = joinedOrders + fakeJoinedOrders;
  const remainOrders = Math.max(0, needOrders - joinedTotal);

  // serviceMode：尽量保持你前台已有字段
  // - 如果你库里有 serviceMode，就用
  // - 否则优先看 deliveryModes 是否包含 groupDay
  // - 再不行看 groupDay.enabled
  let serviceMode = zone.serviceMode;
  if (!serviceMode) {
    const modes = zone.deliveryModes || [];
    if (Array.isArray(modes) && modes.includes("groupDay")) serviceMode = "groupDay";
    else if (zone.groupDay?.enabled) serviceMode = "groupDay";
    else serviceMode = "normal";
  }

  return {
    id: String(zone._id),
    name: zone.name || zone.zoneName || "",
    note: zone.note || zone.zoneNote || "",

    // 你 Console 里能看到的字段（保持一致）
    cutoffTime: zone.cutoffTime || "",
    deliveryDays: Array.isArray(zone.deliveryDays) ? zone.deliveryDays : [],
    deliveryModes: Array.isArray(zone.deliveryModes) ? zone.deliveryModes : [],
    serviceMode,

    // ✅ 前台“已拼/还差”相关字段（新增）
    needOrders,
    fakeJoinedOrders,
    joinedOrders,
    joinedTotal,
    remainOrders,
  };
}

// =========================
// ping
// =========================
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "zones", time: new Date().toISOString() });
});

// =========================
// GET /api/zones/by-zip?zip=11360
// - 给前台首页用：通过 zip 找到对应 zone
// - 返回：{success, supported, zip, zone:{...}}
// =========================
router.get("/by-zip", async (req, res) => {
  try {
    const zip = normalizeZip(req.query.zip);

    // ✅ 防缓存（避免你“更新了虚假订单但前台不变”）
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    if (!zip) {
      return res.json({
        success: true,
        supported: false,
        zip: "",
        zone: null,
        message: "zip missing",
      });
    }

    // 只拿启用的 zones
    const zones = await Zone.find({ enabled: true }).lean();

    // 找到命中 zip 的 zone
    const hit = zones.find((z) => zoneHasZip(z, zip));

    if (!hit) {
      return res.json({
        success: true,
        supported: false,
        zip,
        zone: null,
      });
    }

    // lean 出来的是 plain object，没有 _id->String？我们自己处理
    // 这里复用 toPublicZone，但 toPublicZone 期望 zone._id 存在
    // lean 的 _id 也存在（ObjectId），String() OK
    return res.json({
      success: true,
      supported: true,
      zip,
      zone: toPublicZone(hit),
    });
  } catch (err) {
    console.error("❌ zones/by-zip error:", err);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

// =========================
// （可选）公开列表：方便你调试
// GET /api/zones/list
// =========================
router.get("/list", async (req, res) => {
  try {
    const zones = await Zone.find({ enabled: true }).sort({ updatedAt: -1 }).lean();
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      zones: zones.map((z) => toPublicZone(z)),
    });
  } catch (err) {
    console.error("❌ zones/list error:", err);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

export default router;
