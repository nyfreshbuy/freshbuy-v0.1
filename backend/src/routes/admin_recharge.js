import express from "express";
import mongoose from "mongoose";
import Recharge from "../models/Recharge.js";
import User from "../models/user.js";
import Wallet from "../models/Wallet.js"; // ⚠️ 必须与你真实文件名一致（Wallet.js 或 wallet.js）
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ admin_recharge.js 已加载");

// 工具：ObjectId 兜底
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// 工具：手机号标准化（只保留数字）
function normalizePhone(p) {
  return String(p || "").replace(/\D/g, "");
}

// ==================================================
// POST /api/admin/recharge
// body: { userId | phone, amount, bonus, remark }
// ✅ 写 Recharge 流水 + 更新 Wallet.balance/totalRecharge
// ==================================================
router.post("/", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "无权限（仅管理员可操作）" });
    }

    const { userId, phone, amount, bonus = "", remark = "后台充值" } = req.body;

    const rechargeAmount = Number(amount);
    if (!Number.isFinite(rechargeAmount) || rechargeAmount <= 0) {
      return res.status(400).json({ success: false, message: "amount must be > 0" });
    }

    // 1) 找用户（优先 userId，其次 phone）
    let user = null;

    if (userId) {
      const oid = toObjectIdMaybe(userId);
      if (!oid) return res.status(400).json({ success: false, message: "非法 userId" });
      user = await User.findById(oid);
    } else if (phone) {
      const p0 = String(phone).trim();
      const pn = normalizePhone(p0);

      // 容错匹配：原样 / 纯数字 / 模糊包含数字
      user = await User.findOne({
        $or: [{ phone: p0 }, { phone: pn }, { phone: { $regex: pn } }],
      });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    // 2) 写充值记录（流水）
    const record = await Recharge.create({
      userId: user._id,
      amount: rechargeAmount,
      bonus: String(bonus),
      payMethod: "admin",
      status: "done",
      remark,
    });

    // 3) ✅ 更新 Wallet（真实余额来源）
    const wallet = await Wallet.findOneAndUpdate(
      { userId: user._id },
      { $inc: { balance: rechargeAmount, totalRecharge: rechargeAmount } },
      { new: true, upsert: true }
    ).lean();

    const walletBalance = Number(wallet?.balance || 0);

    console.log("💳 [admin_recharge/post] OK", {
      userId: String(user._id),
      phone: user.phone,
      inc: rechargeAmount,
      walletBalance,
      recordId: String(record._id),
    });

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
    return res.status(500).json({ success: false, message: "后台充值失败" });
  }
});

// ==================================================
// GET /api/admin/recharge/list
// query: page, pageSize, limit, userId, phone, status
// ✅ 返回：list + walletBalance（来自 Wallet.balance）
// ✅ phone 查询时：先找所有可能 User，再优先选“有 Wallet 的 userId”
// ==================================================
router.get("/list", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "无权限（仅管理员可查看）" });
    }

    let { page = 1, pageSize = 20, limit, userId, phone, status } = req.query;

    // ✅ 兼容后台页面用的 limit
    if (limit) pageSize = limit;

    page = Math.max(1, Number(page) || 1);
    pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));

    const query = {};
    let targetUserId = null;

    // 1) userId 过滤
    if (userId) {
      const oid = toObjectIdMaybe(userId);
      if (!oid) return res.status(400).json({ success: false, message: "非法 userId" });
      query.userId = oid;
      targetUserId = oid;
    }

    // 2) phone 过滤（关键：解决“同手机号多个 User”）
    if (phone) {
      const p0 = String(phone).trim();
      const pn = normalizePhone(p0);

      // 先找出所有可能匹配的用户
      const users = await User.find({
        $or: [{ phone: p0 }, { phone: pn }, { phone: { $regex: pn } }],
      })
        .select("_id phone")
        .lean();

      if (!users.length) {
        console.log("⚠️ [admin_recharge/list] user not found by phone =", p0);
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

      const userIds = users.map((x) => x._id);

      // ✅ 优先找“有钱包记录的 userId”
      const w = await Wallet.findOne({ userId: { $in: userIds } })
        .select("userId balance")
        .lean();

      targetUserId = w?.userId || users[0]._id; // 有钱包用钱包的 userId，否则用第一个
      query.userId = targetUserId;
    }

    // 3) 状态过滤
    if (status) query.status = String(status).trim();

    const total = await Recharge.countDocuments(query);

    const list = await Recharge.find(query)
      .populate("userId", "phone name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    // ✅ 余额来自 Wallet 表
    let walletBalance = 0;
    if (targetUserId) {
      const w2 = await Wallet.findOne({ userId: targetUserId }).select("balance").lean();
      walletBalance = Number(w2?.balance || 0);
    }

    console.log(
      "💰 [admin_recharge/list]",
      "phone=",
      phone ? String(phone) : "",
      "userId=",
      String(targetUserId || ""),
      "walletBalance=",
      walletBalance
    );

    return res.json({
      success: true,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      list,
      walletBalance,
    });
  } catch (err) {
    console.error("GET /api/admin/recharge/list error:", err);
    return res.status(500).json({ success: false, message: "查询充值记录失败" });
  }
});

export default router;
