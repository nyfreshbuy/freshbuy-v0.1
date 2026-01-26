// backend/src/routes/wallet.js
import express from "express";
import User from "../models/user.js";
import Wallet from "../models/Wallet.js";
import Recharge from "../models/Recharge.js";
import { requireLogin } from "../middlewares/auth.js";
import RechargeRequest from "../models/RechargeRequest.js";
const router = express.Router();

console.log("✅ wallet (DB + login) 路由已加载");

// ✅ ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "wallet" });
});

/**
 * 小工具：从 User 上兼容读取旧字段余额
 */
function readLegacyBalanceFromUser(u) {
  const v = u?.walletBalance ?? u?.balance ?? u?.wallet ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 小工具：确保 Wallet 文档存在（并可选择从旧字段迁移一次）
 */
async function ensureWalletDoc(userId, userDoc) {
  let wallet = await Wallet.findOne({ userId });

  if (!wallet) {
    // 如果你之前把余额存 User 上，这里可以迁移进 Wallet
    const legacy = userDoc ? readLegacyBalanceFromUser(userDoc) : 0;

    wallet = await Wallet.create({
      userId,
      balance: legacy,
      totalRecharge: legacy > 0 ? legacy : 0, // 你也可以设为 0，看你口径
    });
  }

  return wallet;
}

/**
 * ✅ GET /api/wallet/me
 * 兼容你现在这份接口：返回 walletBalance + user 基本信息
 */
router.get("/me", requireLogin, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "未登录（缺少 token id）" });

    const u = await User.findById(userId).select("_id name phone role walletBalance balance wallet");
    if (!u) return res.status(404).json({ success: false, message: "User not found" });

    // 统一以 Wallet 表为准；如果没有 Wallet 就自动创建（可迁移旧字段）
    const w = await ensureWalletDoc(userId, u);

    return res.json({
      success: true,
      walletBalance: Number(w.balance || 0),
      balance: Number(w.balance || 0), // 兼容字段
      user: {
        id: u._id.toString(),
        name: u.name || "",
        phone: u.phone || "",
        role: u.role || "customer",
      },
    });
  } catch (err) {
    console.error("GET /api/wallet/me error:", err);
    return res.status(500).json({ success: false, message: "Load wallet failed" });
  }
});

/**
 * ✅ GET /api/wallet/my
 * 这是你用户中心“钱包与充值”页需要的接口：
 * - balance
 * - totalRecharge
 * - records（最近充值记录）
 */
router.get("/my", requireLogin, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    const u = await User.findById(userId).select("_id name phone role walletBalance balance wallet");
    if (!u) return res.status(404).json({ success: false, message: "User not found" });

    const w = await ensureWalletDoc(userId, u);

    // 充值记录：默认取最近 20 条
    const limit = Math.min(Number(req.query.limit || 20) || 20, 100);
    const list = await Recharge.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({
      success: true,
      balance: Number(w.balance || 0),
      totalRecharge: Number(w.totalRecharge || 0),
      walletBalance: Number(w.balance || 0), // 兼容字段
      records: list.map((r) => ({
        time: r.createdAt,
        amount: Number(r.amount || 0),
        bonus: Number(r.bonus || 0),
        method: r.method || "admin",
        status: r.status || "success",
        note: r.note || "",
      })),
      user: {
        id: u._id.toString(),
        name: u.name || "",
        phone: u.phone || "",
        role: u.role || "customer",
      },
    });
  } catch (err) {
    console.error("GET /api/wallet/my error:", err);
    return res.status(500).json({ success: false, message: "Load wallet failed" });
  }
});

/**
 * （可选）GET /api/wallet/history
 * 如果你未来想单独做“充值记录”页，可以用这个
 */
router.get("/history", requireLogin, async (req, res) => {
  try {
    const userId = req.user?.id;
    const page = Math.max(Number(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20) || 20, 1), 100);

    const total = await Recharge.countDocuments({ userId });
    const list = await Recharge.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    return res.json({
      success: true,
      page,
      pageSize,
      total,
      list: list.map((r) => ({
        time: r.createdAt,
        amount: Number(r.amount || 0),
        bonus: Number(r.bonus || 0),
        method: r.method || "admin",
        status: r.status || "success",
        note: r.note || "",
      })),
    });
  } catch (err) {
    console.error("GET /api/wallet/history error:", err);
    return res.status(500).json({ success: false, message: "Load history failed" });
  }
});

export default router;
