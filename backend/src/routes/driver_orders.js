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
// 兼容派单：routeIndex 读取
// =====================
function getRouteIndexFromOrder(o) {
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
        const at = new Date(a.o?.createdAt || 0).getTime();
        const bt = new Date(b.o?.createdAt || 0).getTime();
        return at - bt;
      })
      .map((x) => x.o);
  }
  return sortForRouteFallback(orders);
}

// =====================
// ✅ driver 匹配（兼容你数据库里 driverId/phone/name 存法不一致）
// =====================
function buildDriverMatch(req) {
  const uid = String(req.user?.id || req.user?._id || "").trim();
  const phone = String(req.user?.phone || req.user?.mobile || "").trim();
  const name = String(req.user?.name || req.user?.nickname || req.user?.nick || "").trim();

  const or = [];

  // 1) driverId 可能是 ObjectId
  if (mongoose.Types.ObjectId.isValid(uid)) {
    const oid = new mongoose.Types.ObjectId(uid);
    or.push({ driverId: oid });
    or.push({ "dispatch.driverId": oid });
    or.push({ "fulfillment.driverId": oid });
  }

  // 2) driverId 可能是字符串
  if (uid) {
    or.push({ driverId: uid });
    or.push({ "dispatch.driverId": uid });
    or.push({ "fulfillment.driverId": uid });
  }

  // 3) driverPhone
  if (phone) {
    or.push({ driverPhone: phone });
    or.push({ "dispatch.driverPhone": phone });
    or.push({ "fulfillment.driverPhone": phone });
  }

  // 4) driverName（很多后台只存名字）
  if (name) {
    or.push({ driverName: name });
    or.push({ "dispatch.driverName": name });
    or.push({ "fulfillment.driverName": name });
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
    routeIndex: storedRouteIndex ?? routeIndexComputed,
  };
}

/**
 * =====================================================
 * ✅ 司机端批次列表（当天）
 * GET /api/driver/batches?date=YYYY-MM-DD&status=...
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
      : ["paid", "packing", "shipping", "delivering", "配送中", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const rows = await Order.aggregate([
      {
        $match: {
          ...driverMatch,
          status: { $in: statusList },
          // ✅ 有 deliveryDate 用 deliveryDate；没有就用 createdAt 兜底
          $or: [
            { deliveryDate: { $gte: range.start, $lt: range.end } },
            { deliveryDate: { $exists: false }, createdAt: { $gte: range.start, $lt: range.end } },
            { deliveryDate: null, createdAt: { $gte: range.start, $lt: range.end } },
          ],
        },
      },
      {
        $project: {
          batchKey: {
            $ifNull: [
              "$batchId", // ✅ 后台批次：PK20260110-6SYD
              { $ifNull: ["$dispatch.batchKey", "$fulfillment.batchKey"] },
            ],
          },
        },
      },
      { $match: { batchKey: { $type: "string", $ne: "" } } },
      { $group: { _id: "$batchKey", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const batches = rows.map((r) => ({ batchKey: String(r._id), count: Number(r.count || 0) }));
    return res.json({ success: true, date, total: batches.length, batches });
  } catch (err) {
    console.error("GET /api/driver/batches error:", err);
    return res.status(500).json({ success: false, message: "获取批次失败" });
  }
});

/**
 * =====================================================
 * ✅ 司机端按批次拉单
 * GET /api/driver/batch/orders?batchKey=...&status=...
 * =====================================================
 */
router.get("/batch/orders", requireLogin, requireDriver, async (req, res) => {
  try {
    const batchKey = String(req.query.batchKey || "").trim();
    if (!batchKey) return res.status(400).json({ success: false, message: "batchKey 必填" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping", "delivering", "配送中", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const orders = await Order.find({
      ...driverMatch,
      status: { $in: statusList },
      $or: [
        { batchId: batchKey }, // ✅ 兼容后台 batchId=PK...
        { "dispatch.batchKey": batchKey },
        { "fulfillment.batchKey": batchKey },
      ],
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
    console.error("GET /api/driver/batch/orders error:", err);
    return res.status(500).json({ success: false, message: "按批次获取失败" });
  }
});

/**
 * =====================================================
 * ✅ 司机端：按天任务列表
 * GET /api/driver/orders?date=YYYY-MM-DD&status=...
 * （如果你 mount 在 /api/driver，则此路由为 /api/driver?date=...）
 * =====================================================
 */
router.get("/", requireLogin, requireDriver, async (req, res) => {
  try {
    const date = String(req.query.date || "").trim() || toYMD(new Date());
    const range = parseYMDToRange(date);
    if (!range) return res.status(400).json({ success: false, message: "date 必须是 YYYY-MM-DD" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping", "delivering", "配送中", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const orders = await Order.find({
      ...driverMatch,
      status: { $in: statusList },
      // ✅ deliveryDate 没有就用 createdAt
      $or: [
        { deliveryDate: { $gte: range.start, $lt: range.end } },
        { deliveryDate: { $exists: false }, createdAt: { $gte: range.start, $lt: range.end } },
        { deliveryDate: null, createdAt: { $gte: range.start, $lt: range.end } },
      ],
    })
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

export default router;
