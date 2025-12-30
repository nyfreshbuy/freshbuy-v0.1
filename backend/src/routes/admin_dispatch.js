// backend/src/routes/admin_dispatch.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js"; // ✅ 你目前模型文件叫 order.js，就这样写；并且变量统一叫 Order
import User from "../models/User.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ admin_dispatch.js loaded:", import.meta.url);

// =====================
// 权限：管理员
// =====================
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "需要管理员权限" });
  }
  next();
}

// =====================
// 工具：YYYY-MM-DD -> 当天 00:00:00 ~ 次日 00:00:00
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

// =====================
// 简易路线排序（第一阶段够用）
// - 先按 lng，再按 lat
// =====================
function sortForRoute(orders) {
  return [...orders].sort((a, b) => {
    const alng = Number(a?.address?.lng ?? 0);
    const blng = Number(b?.address?.lng ?? 0);
    if (alng !== blng) return alng - blng;

    const alat = Number(a?.address?.lat ?? 0);
    const blat = Number(b?.address?.lat ?? 0);
    return alat - blat;
  });
}

// =====================
// ✅ 统一 batchKey / zoneId 读取（dispatch 优先，兼容旧 fulfillment）
// =====================
function getBatchKey(o) {
  return String(o?.dispatch?.batchKey || o?.fulfillment?.batchKey || "").trim();
}
function getZoneId(o) {
  return String(o?.dispatch?.zoneId || o?.fulfillment?.zoneId || o?.address?.zoneId || "").trim();
}

/**
 * ==========================================
 * ✅ 0) 司机列表（给前端 dispatch.html 用）
 * GET /api/admin/dispatch/drivers
 * ==========================================
 */
router.get("/drivers", requireLogin, requireAdmin, async (req, res) => {
  try {
    const list = await User.find({ role: "driver" })
      .select("_id nickname phone role")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      total: list.length,
      list: list.map((d) => ({
        id: String(d._id),
        nickname: d.nickname || "",
        phone: d.phone || "",
        role: d.role,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/dispatch/drivers error:", err);
    return res.status(500).json({ success: false, message: "获取司机列表失败" });
  }
});

/**
 * ==========================================
 * ✅ 1) 列出某天的所有批次（按 batchKey 聚合）
 * GET /api/admin/dispatch/batches?date=YYYY-MM-DD&status=paid,packing
 *
 * 规则：
 * - 以 deliveryDate 当天为准
 * - batchKey 优先 dispatch.batchKey，兼容 fulfillment.batchKey
 * ==========================================
 */
router.get("/batches", requireLogin, requireAdmin, async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    const statusRaw = String(req.query.status || "").trim();
    const range = parseYMDToRange(date);
    if (!range) return res.status(400).json({ success: false, message: "date 必须是 YYYY-MM-DD" });

    const statusList = statusRaw
      ? statusRaw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : ["paid", "packing", "shipping", "pending"];

    const match = {
      deliveryDate: { $gte: range.start, $lt: range.end },
      status: { $in: statusList },
    };

    const rows = await Order.aggregate([
      { $match: match },
      {
        $addFields: {
          resolvedBatchKey: {
            $cond: [
              { $and: [{ $ne: ["$dispatch.batchKey", null] }, { $ne: ["$dispatch.batchKey", ""] }] },
              "$dispatch.batchKey",
              "$fulfillment.batchKey",
            ],
          },
          resolvedZoneId: {
            $cond: [
              { $and: [{ $ne: ["$dispatch.zoneId", null] }, { $ne: ["$dispatch.zoneId", ""] }] },
              "$dispatch.zoneId",
              "$fulfillment.zoneId",
            ],
          },
        },
      },
      { $match: { resolvedBatchKey: { $ne: "" } } },
      {
        $group: {
          _id: "$resolvedBatchKey",
          batchKey: { $first: "$resolvedBatchKey" },
          zoneId: { $first: "$resolvedZoneId" },

          count: { $sum: 1 },

          totalAmount: { $sum: "$totalAmount" },
          subtotal: { $sum: "$subtotal" },
          deliveryFee: { $sum: "$deliveryFee" },
          salesTax: { $sum: "$salesTax" },
          platformFee: { $sum: "$platformFee" },
          tipFee: { $sum: "$tipFee" },

          drivers: { $addToSet: "$driverId" },
          assignedCount: {
            $sum: {
              $cond: [{ $ifNull: ["$driverId", false] }, 1, 0],
            },
          },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const list = rows.map((x) => ({
      batchKey: x.batchKey,
      zoneId: x.zoneId || "",
      count: x.count || 0,
      assignedCount: x.assignedCount || 0,
      driverCount: (x.drivers || []).filter(Boolean).length,
      totals: {
        totalAmount: Number(x.totalAmount || 0),
        subtotal: Number(x.subtotal || 0),
        deliveryFee: Number(x.deliveryFee || 0),
        salesTax: Number(x.salesTax || 0),
        platformFee: Number(x.platformFee || 0),
        tipFee: Number(x.tipFee || 0),
      },
    }));

    return res.json({ success: true, date, totalBatches: list.length, list });
  } catch (err) {
    console.error("GET /api/admin/dispatch/batches error:", err);
    return res.status(500).json({ success: false, message: "获取批次失败" });
  }
});

/**
 * ==========================================
 * ✅ 2) 查看某批次订单 + 自动路线排序
 * GET /api/admin/dispatch/batch/orders?batchKey=...
 * 可选：&status=paid,packing,shipping
 * ==========================================
 */
router.get("/batch/orders", requireLogin, requireAdmin, async (req, res) => {
  try {
    const batchKey = String(req.query.batchKey || "").trim();
    if (!batchKey) return res.status(400).json({ success: false, message: "batchKey 必填" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : ["paid", "packing", "shipping", "pending"];

    const orders = await Order.find({
      status: { $in: statusList },
      $or: [{ "dispatch.batchKey": batchKey }, { "fulfillment.batchKey": batchKey }],
    })
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders).map((o, idx) => ({
      ...o,
      routeIndex: idx + 1,
    }));

    return res.json({
      success: true,
      batchKey,
      count: sorted.length,
      orders: sorted.map((o) => ({
        id: String(o._id),
        orderNo: o.orderNo,
        status: o.status,
        deliveryMode: o.deliveryMode,
        deliveryDate: o.deliveryDate,

        fulfillment: o.fulfillment,
        dispatch: o.dispatch,

        customerName: o.customerName,
        customerPhone: o.customerPhone,

        address: o.address,
        addressText: o.addressText,

        totalAmount: o.totalAmount,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        salesTax: o.salesTax,
        platformFee: o.platformFee,
        tipFee: o.tipFee,

        driverId: o.driverId || null,
        routeIndex: o.routeIndex,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/dispatch/batch/orders error:", err);
    return res.status(500).json({ success: false, message: "获取批次订单失败" });
  }
});

/**
 * ==========================================
 * ✅ 3) 一键分配批次给司机（支持多个司机自动分摊）
 * POST /api/admin/dispatch/batch/assign
 * body:
 * {
 *   batchKey: "2026-01-08|zone:FM",
 *   driverIds: ["...","..."],
 *   status: ["paid","packing"]
 * }
 * ==========================================
 */
router.post("/batch/assign", requireLogin, requireAdmin, async (req, res) => {
  try {
    const batchKey = String(req.body?.batchKey || "").trim();
    const driverIds = Array.isArray(req.body?.driverIds) ? req.body.driverIds : [];
    const statusList =
      Array.isArray(req.body?.status) && req.body.status.length
        ? req.body.status
        : ["paid", "packing", "shipping", "pending"];

    if (!batchKey) return res.status(400).json({ success: false, message: "batchKey 必填" });
    if (!driverIds.length) return res.status(400).json({ success: false, message: "driverIds 至少 1 个" });

    const validDriverObjectIds = driverIds
      .map((id) => String(id).trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!validDriverObjectIds.length) {
      return res.status(400).json({ success: false, message: "driverIds 不合法" });
    }

    const drivers = await User.find({ _id: { $in: validDriverObjectIds }, role: "driver" })
      .select("_id role nickname phone")
      .lean();

    if (!drivers.length) {
      return res.status(400).json({ success: false, message: "未找到有效 driver 用户" });
    }

    const orders = await Order.find({
      status: { $in: statusList },
      $or: [{ "dispatch.batchKey": batchKey }, { "fulfillment.batchKey": batchKey }],
    }).lean();

    if (!orders.length) {
      return res.status(404).json({ success: false, message: "该批次没有可分配的订单" });
    }

    const sorted = sortForRoute(orders);
    const k = drivers.length;

    const assignments = [];
    for (let i = 0; i < sorted.length; i++) {
      const driver = drivers[i % k];
      assignments.push({ orderId: sorted[i]._id, driverId: driver._id });
    }

    const bulk = Order.collection.initializeUnorderedBulkOp();
    for (const a of assignments) {
      bulk.find({ _id: a.orderId }).updateOne({ $set: { driverId: a.driverId } });
    }
    const r = await bulk.execute();

    return res.json({
      success: true,
      batchKey,
      totalOrders: sorted.length,
      totalDrivers: drivers.length,
      modified: r?.nModified ?? r?.modifiedCount ?? 0,
      drivers: drivers.map((d) => ({
        id: String(d._id),
        nickname: d.nickname || "",
        phone: d.phone || "",
      })),
    });
  } catch (err) {
    console.error("POST /api/admin/dispatch/batch/assign error:", err);
    return res.status(500).json({ success: false, message: err?.message || "批次分配失败" });
  }
});

export default router;
