// backend/src/routes/driver_dispatch.js
import express from "express";
import Order from "../models/order.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

// 司机权限：driver 或 admin
function requireDriver(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "driver" && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "需要司机权限" });
  }
  next();
}

function startEndOfDay(dateStr) {
  const s = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const start = new Date(s + "T00:00:00.000");
  const end = new Date(s + "T23:59:59.999");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

/**
 * ✅ GET /api/driver/batches?date=YYYY-MM-DD
 * 返回司机当天有几个 batchKey（用于下拉）
 */
router.get("/batches", requireLogin, requireDriver, async (req, res) => {
  try {
    const { date } = req.query;
    const r = startEndOfDay(date);
    if (!r) return res.status(400).json({ success: false, message: "date 格式必须 YYYY-MM-DD" });

    const driverId = String(req.user._id);

    // 你派单写进订单的字段：优先 driverId，其次 assignedDriverId（两种都兼容）
    const match = {
      createdAt: { $gte: r.start, $lte: r.end },
      $or: [
        { driverId: driverId },
        { assignedDriverId: driverId },
      ],
    };

    // batchKey 字段兼容：dispatch.batchKey / batchKey
    const rows = await Order.aggregate([
      { $match: match },
      {
        $project: {
          batchKey: {
            $ifNull: ["$dispatch.batchKey", "$batchKey"],
          },
        },
      },
      { $match: { batchKey: { $ne: null, $ne: "" } } },
      { $group: { _id: "$batchKey", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const batches = rows.map((x) => ({ batchKey: x._id, count: x.count }));
    return res.json({ success: true, batches });
  } catch (e) {
    console.error("driver/batches error:", e);
    return res.status(500).json({ success: false, message: "服务器错误" });
  }
});

/**
 * ✅ GET /api/driver/orders?date=YYYY-MM-DD 或 /api/driver/orders?batchKey=xxx
 * 返回司机自己的订单
 */
router.get("/orders", requireLogin, requireDriver, async (req, res) => {
  try {
    const driverId = String(req.user._id);
    const { date, batchKey } = req.query;

    const match = {
      $or: [
        { driverId: driverId },
        { assignedDriverId: driverId },
      ],
    };

    if (batchKey) {
      match.$or = [
        { "dispatch.batchKey": String(batchKey) },
        { batchKey: String(batchKey) },
      ].map((m) => ({ ...m })); // 先按 batchKey 查
      // 再叠加 driver 过滤
      match.$and = [
        { $or: [{ driverId: driverId }, { assignedDriverId: driverId }] },
      ];
    } else if (date) {
      const r = startEndOfDay(date);
      if (!r) return res.status(400).json({ success: false, message: "date 格式必须 YYYY-MM-DD" });
      match.createdAt = { $gte: r.start, $lte: r.end };
    }

    const list = await Order.find(match)
      .sort({ routeSeq: 1, createdAt: 1 })
      .lean();

    return res.json({ success: true, orders: list });
  } catch (e) {
    console.error("driver/orders error:", e);
    return res.status(500).json({ success: false, message: "服务器错误" });
  }
});

export default router;
