import express from "express";
import mongoose from "mongoose";
import Recharge from "../models/Recharge.js";
import User from "../models/User.js";
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
router.post("/recharge", requireLogin, async (req, res) => {
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

export default router;
