// backend/src/routes/recharge.js
import express from "express";
import mongoose from "mongoose";
import Recharge from "../models/Recharge.js";
import User from "../models/User.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ recharge.js (DB) 已加载");

function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// ✅ ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "recharge" });
});

// =====================================================
// GET /api/recharge/my
// =====================================================
router.get("/my", requireLogin, async (req, res) => {
  try {
    const userIdStr = req.user?.id || req.user?._id || "";
    const userId = toObjectIdMaybe(userIdStr);
    if (!userId) {
      return res.status(401).json({ success: false, message: "未登录（缺少 token id）" });
    }

    const limit = Math.min(Number(req.query.limit || 50), 200);

    const records = await Recharge.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    const totalRecharge = records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const mapped = records.map((r) => ({
      id: r._id.toString(),
      amount: Number(r.amount || 0),
      bonus: r.bonus || "",
      payMethod: r.payMethod || "test",
      status: r.status || "done",
      remark: r.remark || "",
      createdAt: r.createdAt,
    }));

    // ✅ 兼容字段：records/list/items 都给
    return res.json({
      success: true,
      totalRecharge,
      total: mapped.length,
      records: mapped,
      list: mapped,
      items: mapped,
    });
  } catch (err) {
    console.error("GET /api/recharge/my error:", err);
    return res.status(500).json({ success: false, message: "Load recharge history failed" });
  }
});

// =====================================================
// POST /api/recharge  （测试版：直接入账 + 增加钱包余额）
// body: { amount, bonus, payMethod, remark }
// =====================================================
router.post("/", requireLogin, async (req, res) => {
  try {
    const userIdStr = req.user?.id || req.user?._id || "";
    const userId = toObjectIdMaybe(userIdStr);
    if (!userId) {
      return res.status(401).json({ success: false, message: "未登录（缺少 token id）" });
    }

    const amount = Number(req.body?.amount || 0);
    const bonus = String(req.body?.bonus || "");
    const payMethod = String(req.body?.payMethod || "test");
    const remark = String(req.body?.remark || "");

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "amount must be > 0" });
    }

    // 1) 写充值记录
    const rec = await Recharge.create({
      userId,
      amount,
      bonus,
      payMethod,
      status: "done",
      remark,
    });

    // 2) 加钱包余额
    await User.updateOne({ _id: userId }, { $inc: { walletBalance: amount } });

    // 3) 返回最新余额（兼容多字段）
    const u = await User.findById(userId).select("walletBalance balance wallet");

    const walletBalance = Number(u?.walletBalance ?? u?.balance ?? u?.wallet ?? 0) || 0;

    return res.json({
      success: true,
      record: {
        id: rec._id.toString(),
        amount: rec.amount,
        bonus: rec.bonus,
        payMethod: rec.payMethod,
        status: rec.status,
        remark: rec.remark,
        createdAt: rec.createdAt,
      },
      walletBalance,
      balance: walletBalance, // ✅ 兼容前端
    });
  } catch (err) {
    console.error("POST /api/recharge error:", err);
    return res.status(500).json({ success: false, message: "Recharge failed" });
  }
});

export default router;
