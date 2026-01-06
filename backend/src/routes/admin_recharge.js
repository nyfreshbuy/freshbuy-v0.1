import express from "express";
import mongoose from "mongoose";
import Recharge from "../models/Recharge.js";
import User from "../models/user.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ admin_recharge.js 已加载");

// 工具：ObjectId 兜底
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s)
    ? new mongoose.Types.ObjectId(s)
    : null;
}

// ==================================================
// POST /api/admin/recharge
// body: { userId | phone, amount, bonus, remark }
// ==================================================
router.post("/", requireLogin, async (req, res) => {
  try {
    // ✅ 1. 校验管理员权限
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "无权限（仅管理员可操作）",
      });
    }

    const { userId, phone, amount, bonus = "", remark = "后台充值" } = req.body;

    const rechargeAmount = Number(amount);
    if (!Number.isFinite(rechargeAmount) || rechargeAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "amount must be > 0" });
    }

    // ✅ 2. 找用户（支持 userId 或 phone）
    let user = null;

    if (userId) {
      const oid = toObjectIdMaybe(userId);
      if (!oid) {
        return res.status(400).json({ success: false, message: "非法 userId" });
      }
      user = await User.findById(oid);
    } else if (phone) {
      user = await User.findOne({ phone: String(phone).trim() });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "用户不存在",
      });
    }

    // ✅ 3. 写充值记录
    const record = await Recharge.create({
      userId: user._id,
      amount: rechargeAmount,
      bonus: String(bonus),
      payMethod: "admin",
      status: "done",
      remark,
    });

    // ✅ 4. 加钱包余额
    await User.updateOne(
      { _id: user._id },
      { $inc: { walletBalance: rechargeAmount } }
    );

    const updatedUser = await User.findById(user._id).select(
      "walletBalance balance wallet"
    );

    const walletBalance =
      Number(
        updatedUser.walletBalance ??
          updatedUser.balance ??
          updatedUser.wallet ??
          0
      ) || 0;

    return res.json({
      success: true,
      message: "后台充值成功",
      user: {
        id: user._id.toString(),
        phone: user.phone,
        name: user.name,
      },
      record: {
        id: record._id.toString(),
        amount: record.amount,
        bonus: record.bonus,
        remark: record.remark,
        createdAt: record.createdAt,
      },
      walletBalance,
    });
  } catch (err) {
    console.error("POST /api/admin/recharge error:", err);
    res.status(500).json({ success: false, message: "后台充值失败" });
  }
});
// ==================================================
// GET /api/admin/recharge/list
// query: page, pageSize, userId, phone, status
// ==================================================
// ==================================================
// GET /api/admin/recharge/list
// query: page, pageSize, limit, userId, phone, status
// 返回：list + walletBalance（给后台页面显示）
// ==================================================
router.get("/list", requireLogin, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "无权限（仅管理员可查看）" });
    }

    let { page = 1, pageSize = 20, limit, userId, phone, status } = req.query;

    // ✅ 兼容你的后台页面用的 limit
    if (limit && !pageSize) pageSize = limit;
    page = Math.max(1, Number(page) || 1);
    pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));

    const query = {};
    let targetUserId = null; // 用于计算 walletBalance

    // 1) userId 过滤
    if (userId) {
      const oid = toObjectIdMaybe(userId);
      if (!oid) return res.status(400).json({ success: false, message: "非法 userId" });
      query.userId = oid;
      targetUserId = oid;
    }

    // 2) phone 过滤（先查用户）
    if (phone) {
      const u = await User.findOne({ phone: String(phone).trim() }).select("_id");
      if (!u) {
        return res.json({
          success: true,
          page,
          pageSize,
          total: 0,
          totalPages: 0,
          list: [],
          walletBalance: 0,
        });
      }
      query.userId = u._id;
      targetUserId = u._id;
    }

    // 3) 状态过滤
    if (status) query.status = String(status).trim();

    const total = await Recharge.countDocuments(query);

    const list = await Recharge.find(query)
      .populate("userId", "phone name walletBalance balance wallet")
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    // ✅ 关键：把余额算出来返回给后台页面显示
    let walletBalance = 0;
    if (targetUserId) {
      const uu = await User.findById(targetUserId).select("walletBalance balance wallet");
      walletBalance =
        Number(uu?.walletBalance ?? uu?.balance ?? uu?.wallet ?? 0) || 0;
    }

    return res.json({
      success: true,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      list,
      walletBalance, // ✅ 前端要的字段
    });
  } catch (err) {
    console.error("GET /api/admin/recharge/list error:", err);
    return res.status(500).json({ success: false, message: "查询充值记录失败" });
  }
});
export default router;
