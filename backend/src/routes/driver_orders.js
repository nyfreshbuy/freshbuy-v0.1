// backend/src/routes/driver_orders.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🚚 driver_orders.js loaded");

// =====================
// 权限：司机
// =====================
function requireDriver(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "driver" && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "需要司机权限" });
  }
  next();
}

// =====================
// 工具：YYYY-MM-DD -> 当天范围
// =====================
function parseYMDToRange(dateStr) {
  const s = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const start = new Date(s + "T00:00:00.000");
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function toYMD(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// =====================
// 兼容派单：batchKey / routeIndex 读取
// =====================
function getBatchKeyFromOrder(o) {
  return String(o?.dispatch?.batchKey || o?.fulfillment?.batchKey || o?.batchKey || "").trim();
}

function getRouteIndexFromOrder(o) {
  // ✅ 优先使用后台派单写入的 routeIndex
  const v =
    o?.dispatch?.routeIndex ??
    o?.fulfillment?.routeIndex ??
    o?.routeIndex ??
    o?.route_index ??
    null;

  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// =====================
// 简易路线排序（兜底）
// - 先按 lng，再按 lat
// =====================
function sortForRouteFallback(orders) {
  return [...orders].sort((a, b) => {
    const alng = Number(a?.address?.lng ?? 0);
    const blng = Number(b?.address?.lng ?? 0);
    if (alng !== blng) return alng - blng;

    const alat = Number(a?.address?.lat ?? 0);
    const blat = Number(b?.address?.lat ?? 0);
    return alat - blat;
  });
}

// ✅ 对齐派单：如果有 routeIndex 就按 routeIndex 排；否则 fallback
function sortForRoute(orders) {
  const withIdx = orders.map((o) => ({ o, idx: getRouteIndexFromOrder(o) }));
  const hasAnyIdx = withIdx.some((x) => x.idx != null);

  if (hasAnyIdx) {
    return withIdx
      .sort((a, b) => {
        const ai = a.idx ?? 999999;
        const bi = b.idx ?? 999999;
        if (ai !== bi) return ai - bi;
        // 同 routeIndex 再按创建时间稳定排序
        const at = new Date(a.o?.createdAt || 0).getTime();
        const bt = new Date(b.o?.createdAt || 0).getTime();
        return at - bt;
      })
      .map((x) => x.o);
  }

  return sortForRouteFallback(orders);
}

function getDriverObjectId(req) {
  const uid = String(req.user?.id || req.user?._id || "").trim();
  if (!mongoose.Types.ObjectId.isValid(uid)) return null;
  return new mongoose.Types.ObjectId(uid);
}
function buildDriverMatch(req) {
  const uid = String(req.user?.id || req.user?._id || "").trim();
  const phone = String(req.user?.phone || req.user?.mobile || "").trim();

  const or = [];

  // 1) driverId 可能是 ObjectId
  if (mongoose.Types.ObjectId.isValid(uid)) {
    or.push({ driverId: new mongoose.Types.ObjectId(uid) });
    or.push({ "dispatch.driverId": new mongoose.Types.ObjectId(uid) });
    or.push({ "fulfillment.driverId": new mongoose.Types.ObjectId(uid) });
  }

  // 2) driverId 可能是字符串（比如存的就是 "65xx..." 或者手机号）
  if (uid) {
    or.push({ driverId: uid });
    or.push({ "dispatch.driverId": uid });
    or.push({ "fulfillment.driverId": uid });
  }

  // 3) 有些系统存 driverPhone
  if (phone) {
    or.push({ driverPhone: phone });
    or.push({ "dispatch.driverPhone": phone });
    or.push({ "fulfillment.driverPhone": phone });
  }

  return or.length ? { $or: or } : null;
}
function normalizeOrderOut(o, routeIndexComputed = null) {
  const storedRouteIndex = getRouteIndexFromOrder(o);
  return {
    id: String(o._id),
    orderNo: o.orderNo,
    status: o.status,
    deliveryStatus: o.deliveryStatus,

    deliveryMode: o.deliveryMode,
    fulfillment: o.fulfillment,
    dispatch: o.dispatch,
    deliveryDate: o.deliveryDate,

    customerName: o.customerName,
    customerPhone: o.customerPhone,

    address: o.address,
    addressText: o.addressText,
    note: o.note,

    totalAmount: o.totalAmount,

    // ✅ 最终对外 routeIndex：优先派单写入；否则用计算出来的
    routeIndex: storedRouteIndex ?? routeIndexComputed,
  };
}

/**
 * =====================================================
 * ✅ 新增：司机端批次列表（当天）
 * GET /api/driver/orders/batches?date=YYYY-MM-DD&status=...
 * 返回：[{ batchKey, count }]
 * =====================================================
 */
router.get("/batches", requireLogin, requireDriver, async (req, res) => {
  try {
    const date = String(req.query.date || "").trim() || toYMD(new Date());
    const range = parseYMDToRange(date);
    if (!range) return res.status(400).json({ success: false, message: "date 必须是 YYYY-MM-DD" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const rows = await Order.aggregate([
      {
        $match: {
          ...driverMatch,
          deliveryDate: { $gte: range.start, $lt: range.end },
          status: { $in: statusList },
        },
      },
      {
        $project: {
          batchKey: { $ifNull: ["$dispatch.batchKey", "$fulfillment.batchKey"] },
        },
      },
      { $match: { batchKey: { $type: "string", $ne: "" } } },
      { $group: { _id: "$batchKey", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const batches = rows.map((r) => ({ batchKey: String(r._id), count: Number(r.count || 0) }));
    return res.json({ success: true, date, total: batches.length, batches });
  } catch (err) {
    console.error("GET /api/driver/orders/batches error:", err);
    return res.status(500).json({ success: false, message: "获取批次失败" });
  }
});
/**
 * =====================================================
 * ✅ 新增：司机端按批次拉单（对齐派单 routeIndex）
 * GET /api/driver/orders/batch/orders?batchKey=...&status=...
 * =====================================================
 */
router.get("/batch/orders", requireLogin, requireDriver, async (req, res) => {
  try {
    const batchKey = String(req.query.batchKey || "").trim();
    if (!batchKey) return res.status(400).json({ success: false, message: "batchKey 必填" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const orders = await Order.find({
      ...driverMatch,
      status: { $in: statusList },
      $or: [{ "fulfillment.batchKey": batchKey }, { "dispatch.batchKey": batchKey }],
    })
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders);
    const hasAnyIdx = sorted.some((o) => getRouteIndexFromOrder(o) != null);

    return res.json({
      success: true,
      batchKey,
      total: sorted.length,
      orders: sorted.map((o, i) => normalizeOrderOut(o, hasAnyIdx ? null : i + 1)),
    });
  } catch (err) {
    console.error("GET /api/driver/orders/batch/orders error:", err);
    return res.status(500).json({ success: false, message: "按批次获取失败" });
  }
});
/**
 * =====================================================
 * ✅ 司机端：我的任务列表（按天）
 * GET /api/driver/orders?date=YYYY-MM-DD&status=paid,packing,shipping
 * =====================================================
 */
router.get("/", requireLogin, requireDriver, async (req, res) => {
  try {
   const driverMatch = buildDriverMatch(req);
if (!driverMatch)
  return res.status(401).json({ success: false, message: "用户信息异常" });

const orders = await Order.find({
  ...driverMatch,
  deliveryDate: { $gte: range.start, $lt: range.end },
  status: { $in: statusList },
})
  .sort({ createdAt: 1 })
  .lean();
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders);
    const hasAnyIdx = sorted.some((o) => getRouteIndexFromOrder(o) != null);

    return res.json({
      success: true,
      date,
      total: sorted.length,
      orders: sorted.map((o, i) => normalizeOrderOut(o, hasAnyIdx ? null : i + 1)),
    });
  } catch (err) {
    console.error("GET /api/driver/orders error:", err);
    return res.status(500).json({ success: false, message: "获取司机任务失败" });
  }
});

/**
 * =====================================================
 * ✅ 兼容旧接口：今日任务
 * GET /api/driver/orders/today
 * =====================================================
 */
router.get("/today", requireLogin, requireDriver, async (req, res) => {
  try {
    const driverId = getDriverObjectId(req);
    if (!driverId) return res.status(401).json({ success: false, message: "用户信息异常" });

    const date = toYMD(new Date());
    const range = parseYMDToRange(date);

    const orders = await Order.find({
      driverId,
      deliveryDate: { $gte: range.start, $lt: range.end },
      status: { $in: ["paid", "packing", "shipping"] },
    })
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders);
    const hasAnyIdx = sorted.some((o) => getRouteIndexFromOrder(o) != null);

    return res.json({
      success: true,
      origin: {
        lat: 40.758531,
        lng: -73.829252,
        address: "Freshbuy 仓库",
      },
      orders: sorted.map((o, i) => normalizeOrderOut(o, hasAnyIdx ? null : i + 1)),
    });
  } catch (err) {
    console.error("GET /api/driver/orders/today error:", err);
    return res.status(500).json({ success: false, message: "获取今日任务失败" });
  }
});

/**
 * =====================================================
 * ✅ 保留：旧接口按批次（但内部也改为对齐派单 routeIndex）
 * GET /api/driver/orders/by-batch?batchKey=...&status=...
 * =====================================================
 */
router.get("/by-batch", requireLogin, requireDriver, async (req, res) => {
  try {
    const driverId = getDriverObjectId(req);
    if (!driverId) return res.status(401).json({ success: false, message: "用户信息异常" });

    const batchKey = String(req.query.batchKey || "").trim();
    if (!batchKey) return res.status(400).json({ success: false, message: "batchKey 必填" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping"];

    const orders = await Order.find({
      driverId,
      status: { $in: statusList },
      $or: [{ "fulfillment.batchKey": batchKey }, { "dispatch.batchKey": batchKey }],
    })
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders);
    const hasAnyIdx = sorted.some((o) => getRouteIndexFromOrder(o) != null);

    return res.json({
      success: true,
      batchKey,
      total: sorted.length,
      orders: sorted.map((o, i) => normalizeOrderOut(o, hasAnyIdx ? null : i + 1)),
    });
  } catch (err) {
    console.error("GET /api/driver/orders/by-batch error:", err);
    return res.status(500).json({ success: false, message: "按批次获取失败" });
  }
});

/**
 * =====================================================
 * ✅ 一键开始配送（兼容旧接口）
 * PATCH /api/driver/orders/start-all
 * =====================================================
 */
router.patch("/start-all", requireLogin, requireDriver, async (req, res) => {
  try {
    const driverId = getDriverObjectId(req);
    if (!driverId) return res.status(401).json({ success: false, message: "用户信息异常" });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const result = await Order.updateMany(
      {
        driverId,
        createdAt: { $lt: startOfToday },
        deliveryStatus: { $ne: "delivered" },
        status: { $ne: "completed" },
      },
      {
        $set: {
          status: "shipping",
          deliveryStatus: "delivering",
          startedAt: now,
        },
      }
    );

    return res.json({
      success: true,
      message: "已将【今天之前创建】且未送达的订单标记为配送中",
      matched: result.matchedCount ?? result.n ?? 0,
      modified: result.modifiedCount ?? result.nModified ?? 0,
      cutoff: startOfToday.toISOString(),
    });
  } catch (err) {
    console.error("PATCH /api/driver/orders/start-all error:", err);
    return res.status(500).json({ success: false, message: "一键开始配送失败" });
  }
});

/**
 * =====================================================
 * ✅ 开始配送
 * PATCH /api/driver/orders/:id/start
 * =====================================================
 */
router.patch("/:id([0-9a-fA-F]{24})/start", requireLogin, requireDriver, async (req, res) => {
  try {
    const driverId = getDriverObjectId(req);
    if (!driverId) return res.status(401).json({ success: false, message: "用户信息异常" });

    const id = req.params.id;

    const doc = await Order.findOneAndUpdate(
      { _id: id, driverId },
      {
        $set: {
          status: "shipping",
          deliveryStatus: "delivering",
          startedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!doc) return res.status(404).json({ success: false, message: "订单不存在或不属于你" });

    return res.json({
      success: true,
      data: { id: String(doc._id), status: doc.status, deliveryStatus: doc.deliveryStatus, startedAt: doc.startedAt },
    });
  } catch (err) {
    console.error("PATCH /api/driver/orders/:id/start error:", err);
    return res.status(500).json({ success: false, message: "开始配送失败" });
  }
});

/**
 * =====================================================
 * ✅ 标记送达（你原来已有）
 * PATCH /api/driver/orders/:id/delivered
 * =====================================================
 */
router.patch("/:id([0-9a-fA-F]{24})/delivered", requireLogin, requireDriver, async (req, res) => {
  try {
    const driverId = getDriverObjectId(req);
    if (!driverId) return res.status(401).json({ success: false, message: "用户信息异常" });

    const id = req.params.id;
    const deliveryPhotoUrl = String(req.body?.deliveryPhotoUrl || "").trim();
    const deliveryNote = String(req.body?.deliveryNote || "").trim();

    const patch = {
      status: "done",
      deliveryStatus: "delivered",
      deliveredAt: new Date(),
    };
    if (deliveryPhotoUrl) patch.deliveryPhotoUrl = deliveryPhotoUrl;
    if (deliveryNote) patch.deliveryNote = deliveryNote;

    const doc = await Order.findOneAndUpdate({ _id: id, driverId }, { $set: patch }, { new: true });

    if (!doc) return res.status(404).json({ success: false, message: "订单不存在或不属于你" });

    return res.json({
      success: true,
      data: {
        id: String(doc._id),
        status: doc.status,
        deliveryStatus: doc.deliveryStatus,
        deliveredAt: doc.deliveredAt,
        deliveryPhotoUrl: doc.deliveryPhotoUrl,
        deliveryNote: doc.deliveryNote,
      },
    });
  } catch (err) {
    console.error("PATCH /api/driver/orders/:id/delivered error:", err);
    return res.status(500).json({ success: false, message: "标记送达失败" });
  }
});

/**
 * =====================================================
 * ✅ 兼容旧接口：完成配送
 * PATCH /api/driver/orders/:id/complete
 * =====================================================
 */
router.patch("/:id([0-9a-fA-F]{24})/complete", requireLogin, requireDriver, async (req, res) => {
  try {
    const driverId = getDriverObjectId(req);
    if (!driverId) return res.status(401).json({ success: false, message: "用户信息异常" });

    const id = req.params.id;
    const deliveryPhotoUrl = String(req.body?.deliveryPhotoUrl || "").trim();
    const deliveryNote = String(req.body?.deliveryNote || "").trim();

    const patch = {
      status: "completed",
      deliveryStatus: "delivered",
      deliveredAt: new Date(),
    };
    if (deliveryPhotoUrl) patch.deliveryPhotoUrl = deliveryPhotoUrl;
    if (deliveryNote) patch.deliveryNote = deliveryNote;

    const doc = await Order.findOneAndUpdate({ _id: id, driverId }, { $set: patch }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "订单不存在或不属于你" });

    return res.json({
      success: true,
      data: {
        id: String(doc._id),
        status: doc.status,
        deliveryStatus: doc.deliveryStatus,
        deliveredAt: doc.deliveredAt,
        deliveryPhotoUrl: doc.deliveryPhotoUrl,
        deliveryNote: doc.deliveryNote,
      },
    });
  } catch (err) {
    console.error("PATCH /api/driver/orders/:id/complete error:", err);
    return res.status(500).json({ success: false, message: "完成配送失败" });
  }
});

export default router;
