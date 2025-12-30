import express from "express";
import Product from "../models/Product.js";
import User from "../models/User.js";
import Order from "../models/Order.js"; // ✅ 确保你有 Order 模型
import { requireLogin } from "../middlewares/auth.js";
const router = express.Router();
router.use(express.json());
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "admin_dashboard" });
});
// ====== 管理员校验（如果你已有 requireAdmin，可直接替换） ======
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "未登录" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "无权限" });
  }
  next();
}

// =====================================================
// GET /api/admin/dashboard/summary
// 仪表盘顶部 4 个统计卡
// =====================================================
router.get("/summary", requireLogin, requireAdmin, async (req, res) => {
  try {
    // 商品
    const [productTotal, productActive] = await Promise.all([
      Product.countDocuments({}),
      Product.countDocuments({ isActive: true }),
    ]);

    // 用户
    const userTotal = await User.countDocuments({});

    // 今日时间范围
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    // 订单统计（DB）
    const [orderTotal, orderToday, agg] = await Promise.all([
      Order.countDocuments({}),
      Order.countDocuments({ createdAt: { $gte: start, $lte: end } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            sum: { $sum: { $ifNull: ["$totalAmount", 0] } },
          },
        },
      ]),
    ]);

    const revenueToday = agg?.[0]?.sum || 0;

    return res.json({
      success: true,
      data: {
        productTotal,
        productActive,
        userTotal,
        orderTotal,
        orderToday,
        revenueToday,
      },
    });
  } catch (err) {
    console.error("dashboard summary error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "获取仪表盘数据失败",
    });
  }
});

// =====================================================
// GET /api/admin/dashboard/recent-orders
// 最新订单（DB）—— 给你截图里的“最新订单”表用
// =====================================================
router.get("/recent-orders", requireLogin, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    // 如需只显示已支付，可改成：{ paid: true }
    const filter = {};

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // 补用户信息
    const userIds = [
      ...new Set(
        orders
          .map((o) => String(o.userId || o.user || ""))
          .filter(Boolean)
      ),
    ];

    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select("_id name phone")
          .lean()
      : [];

    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const rows = orders.map((o) => {
      const uid = String(o.userId || o.user || "");
      const u = userMap.get(uid);

      const amount =
        o.totalAmount ??
        o.total ??
        o.amount ??
        o.pricing?.grand ??
        0;

      return {
        id: String(o._id),
        orderNo:
          o.orderNo ||
          o.no ||
          o.order_number ||
          String(o._id).slice(-6),
        userName: o.userName || u?.name || u?.phone || "—",
        amount: Number(amount) || 0,
        deliveryType: o.deliveryType || o.delivery_type || o.mode || "—",
        status: o.status || "pending",
        createdAt: o.createdAt,
      };
    });

    return res.json({
      success: true,
      orders: rows,
    });
  } catch (err) {
    console.error("recent-orders error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "获取最新订单失败",
    });
  }
});

export default router;
