// backend/src/routes/driver_orders.js
import express from "express";
import mongoose from "mongoose";
import order from "../models/order.js";
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
// 简易路线排序（第一阶段）
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

/**
 * =====================================================
 * ✅ 司机端：我的任务列表（按天）
 * GET /api/driver/orders?date=YYYY-MM-DD&status=paid,packing,shipping
 *
 * - 默认 date=今天
 * - 只返回 driverId = 当前司机 的订单
 * - 返回带 routeIndex（司机按顺序送）
 * =====================================================
 */
router.get("/", requireLogin, requireDriver, async (req, res) => {
  try {
    const uid = String(req.user?.id || req.user?._id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(uid)) {
      return res.status(401).json({ success: false, message: "用户信息异常" });
    }
    const driverId = new mongoose.Types.ObjectId(uid);

    const date = String(req.query.date || "").trim() || toYMD(new Date());
    const range = parseYMDToRange(date);
    if (!range) return res.status(400).json({ success: false, message: "date 必须是 YYYY-MM-DD" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping"]; // 默认常用状态

    const orders = await order.find({
      driverId,
      deliveryDate: { $gte: range.start, $lt: range.end },
      status: { $in: statusList },
    })
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders).map((o, idx) => ({
      ...o,
      routeIndex: idx + 1,
    }));

    return res.json({
      success: true,
      date,
      total: sorted.length,
      orders: sorted.map((o) => ({
        id: String(o._id),
        orderNo: o.orderNo,
        status: o.status,
        deliveryStatus: o.deliveryStatus,

        deliveryMode: o.deliveryMode,
        fulfillment: o.fulfillment,
        deliveryDate: o.deliveryDate,

        customerName: o.customerName,
        customerPhone: o.customerPhone,

        address: o.address,
        addressText: o.addressText,
        note: o.note,

        totalAmount: o.totalAmount,

        routeIndex: o.routeIndex,
      })),
    });
  } catch (err) {
    console.error("GET /api/driver/orders error:", err);
    return res.status(500).json({ success: false, message: "获取司机任务失败" });
  }
});

/**
 * =====================================================
 * ✅ 司机端：按批次拉单（适合你“每批次一条路线”）
 * GET /api/driver/orders/by-batch?batchKey=YYYY-MM-DD|zone:FM&status=...
 *
 * - 只返回 driverId=当前司机
 * - routeIndex 同样返回
 * =====================================================
 */
router.get("/by-batch", requireLogin, requireDriver, async (req, res) => {
  try {
    const uid = String(req.user?.id || req.user?._id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(uid)) {
      return res.status(401).json({ success: false, message: "用户信息异常" });
    }
    const driverId = new mongoose.Types.ObjectId(uid);

    const batchKey = String(req.query.batchKey || "").trim();
    if (!batchKey) return res.status(400).json({ success: false, message: "batchKey 必填" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping"];

    const orders = await orderrder.find({
      driverId,
      "fulfillment.batchKey": batchKey,
      status: { $in: statusList },
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
      total: sorted.length,
      orders: sorted.map((o) => ({
        id: String(o._id),
        orderNo: o.orderNo,
        status: o.status,
        deliveryStatus: o.deliveryStatus,

        deliveryMode: o.deliveryMode,
        fulfillment: o.fulfillment,
        deliveryDate: o.deliveryDate,

        customerName: o.customerName,
        customerPhone: o.customerPhone,

        address: o.address,
        addressText: o.addressText,
        note: o.note,

        totalAmount: o.totalAmount,
        routeIndex: o.routeIndex,
      })),
    });
  } catch (err) {
    console.error("GET /api/driver/orders/by-batch error:", err);
    return res.status(500).json({ success: false, message: "按批次获取失败" });
  }
});

/**
 * =====================================================
 * ✅ 司机端：开始配送（把订单置为 shipping + deliveryStatus=delivering）
 * PATCH /api/driver/orders/:id/start
 * =====================================================
 */
router.patch("/:id([0-9a-fA-F]{24})/start", requireLogin, requireDriver, async (req, res) => {
  try {
    const uid = String(req.user?.id || req.user?._id || "").trim();
    const driverId = mongoose.Types.ObjectId.isValid(uid) ? new mongoose.Types.ObjectId(uid) : null;
    if (!driverId) return res.status(401).json({ success: false, message: "用户信息异常" });

    const id = req.params.id;

    const doc = await order.findOneAndUpdate(
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
 * ✅ 司机端：标记送达（done + delivered）
 * PATCH /api/driver/orders/:id/delivered
 * body: { deliveryPhotoUrl?, deliveryNote? }
 * =====================================================
 */
router.patch("/:id([0-9a-fA-F]{24})/delivered", requireLogin, requireDriver, async (req, res) => {
  try {
    const uid = String(req.user?.id || req.user?._id || "").trim();
    const driverId = mongoose.Types.ObjectId.isValid(uid) ? new mongoose.Types.ObjectId(uid) : null;
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

    const doc = await order.findOneAndUpdate({ _id: id, driverId }, { $set: patch }, { new: true });

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

export default router;
