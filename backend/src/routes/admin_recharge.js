// backend/src/routes/admin_recharge.js
import express from "express";
import mongoose from "mongoose";
import Recharge from "../models/Recharge.js";
import User from "../models/user.js";
import Wallet from "../models/Wallet.js"; // ⚠️ 必须与你真实文件名一致（Wallet.js 或 wallet.js）
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ admin_recharge.js loaded");

// ✅ 配置：Zelle 赠送比例
const ZELLE_BONUS_RATE = 0.05;

// ✅ 小工具：两位小数
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// 工具：ObjectId 兜底
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// 工具：手机号标准化（只保留数字）
function normalizePhone(p) {
  return String(p || "").replace(/\D/g, "");
}

// 工具：admin 权限校验（你当前项目就是靠 req.user.role）
function ensureAdmin(req, res) {
  if (req.user?.role !== "admin" && req.user?.role !== "super") {
    res.status(403).json({ success: false, message: "无权限（仅管理员可操作）" });
    return false;
  }
  return true;
}

// ✅ ping
router.get("/ping", requireLogin, (req, res) => {
  if (!ensureAdmin(req, res)) return;
  res.json({ ok: true, name: "admin_recharge" });
});

// ==================================================
// POST /api/admin/recharge
// body: { userId | phone, amount, bonus, remark }
// ✅ 写 Recharge 流水 + 更新 Wallet.balance/totalRecharge
// ✅ 余额入账 = amount + bonus（bonus 为后台手动输入）
// ==================================================
router.post("/", requireLogin, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { userId, phone, amount, bonus = 0, remark = "后台充值" } = req.body;

    const rechargeAmount = Number(amount);
    if (!Number.isFinite(rechargeAmount) || rechargeAmount <= 0) {
      return res.status(400).json({ success: false, message: "amount must be > 0" });
    }

    const bonusAmount = round2(Number(bonus || 0));
    if (!Number.isFinite(bonusAmount) || bonusAmount < 0) {
      return res.status(400).json({ success: false, message: "bonus must be >= 0" });
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
      phone: user.phone || "",
      amount: round2(rechargeAmount),
      bonus: round2(bonusAmount),
      payMethod: "admin",
      status: "done",
      remark,
      operatorId: req.user?.id || req.user?._id || null,
    });

    // 3) ✅ 更新 Wallet：后台手动充值 = amount + bonus（bonus 由后台输入）
    const credited = round2(rechargeAmount + bonusAmount);

    const wallet = await Wallet.findOneAndUpdate(
      { userId: user._id },
      { $inc: { balance: credited, totalRecharge: rechargeAmount } },
      { new: true, upsert: true }
    ).lean();

    const walletBalance = Number(wallet?.balance || 0);

    console.log("💳 [admin_recharge/post] OK", {
      userId: String(user._id),
      phone: user.phone,
      amount: rechargeAmount,
      bonus: bonusAmount,
      credited,
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
    if (!ensureAdmin(req, res)) return;

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

// ==================================================
// GET /api/admin/recharge/pending?limit=200
// ✅ 只列出 Zelle pending（用于后台审核）
// ==================================================
router.get("/pending", requireLogin, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const limit = Math.min(Number(req.query.limit || 200), 300);

    const items = await Recharge.find({ payMethod: "zelle", status: "pending" })
      .populate("userId", "phone name")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error("GET /api/admin/recharge/pending error:", err);
    return res.status(500).json({ success: false, message: "加载 pending 失败" });
  }
});

// ==================================================
// POST /api/admin/recharge/:id/approve
// body: { note? }
// ✅ Zelle：pending -> done + Wallet.balance 入账（含赠送5%）
// ✅ 幂等：只处理 zelle + pending
// ==================================================
router.post("/:id/approve", requireLogin, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "非法 id" });
    }

    const note = String(req.body?.note || "").trim();

    // ✅ 幂等：只处理 zelle + pending
    const rec = await Recharge.findOneAndUpdate(
      { _id: id, payMethod: "zelle", status: "pending" },
      { $set: { status: "done" } },
      { new: true }
    );

    if (!rec) {
      const existed = await Recharge.findById(id).lean();
      if (!existed) return res.status(404).json({ success: false, message: "记录不存在" });
      return res.json({ success: true, message: `无需重复处理（当前状态=${existed.status}）` });
    }

    const amount = Number(rec.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      // 防守：金额异常则回滚状态
      await Recharge.updateOne({ _id: id }, { $set: { status: "pending" } });
      return res.status(400).json({ success: false, message: "金额异常，已回滚状态" });
    }

    // ✅ 追加 remark（用于审计）
    const append = note ? ` | admin=${note}` : " | admin=approved";
    await Recharge.updateOne({ _id: id }, { $set: { remark: String(rec.remark || "") + append } });

    // ✅ Zelle 赠送 5%
    const bonus = round2(amount * ZELLE_BONUS_RATE);
    const credited = round2(amount + bonus);

    // ✅ 写回充值记录 bonus（用于用户中心展示/对账）
    await Recharge.updateOne({ _id: id }, { $set: { bonus } });

    // ✅ 更新 Wallet：余额加 credited；totalRecharge 只加 amount
    const wallet = await Wallet.findOneAndUpdate(
      { userId: rec.userId },
      { $inc: { balance: credited, totalRecharge: amount } },
      { new: true, upsert: true }
    ).lean();

    return res.json({
      success: true,
      message: `已确认入账（含赠送 $${bonus}）`,
      walletBalance: Number(wallet?.balance || 0),
      credited,
      bonus,
    });
  } catch (err) {
    console.error("POST /api/admin/recharge/:id/approve error:", err);
    return res.status(500).json({ success: false, message: "入账失败" });
  }
});

// ==================================================
// POST /api/admin/recharge/:id/reject
// body: { note? }
// ✅ pending -> rejected（不加钱）
// ==================================================
router.post("/:id/reject", requireLogin, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "非法 id" });
    }

    const note = String(req.body?.note || "").trim();

    // ✅ 幂等：只处理 zelle + pending
    const rec = await Recharge.findOneAndUpdate(
      { _id: id, payMethod: "zelle", status: "pending" },
      {
        $set: {
          status: "rejected",
          remark: String(note ? `admin=${note}` : "admin=rejected"),
        },
      },
      { new: true }
    );

    if (!rec) {
      const existed = await Recharge.findById(id).lean();
      if (!existed) return res.status(404).json({ success: false, message: "记录不存在" });
      return res.json({ success: true, message: `无需重复处理（当前状态=${existed.status}）` });
    }

    return res.json({ success: true, message: "已拒绝" });
  } catch (err) {
    console.error("POST /api/admin/recharge/:id/reject error:", err);
    return res.status(500).json({ success: false, message: "拒绝失败" });
  }
});

// ==================================================
// GET /api/admin/recharge/reconcile?phone=xxx 或 ?userId=xxx
// ✅ 对账：返回 Wallet.balance + Wallet.totalRecharge + done充值合计 + 最近充值记录
// ==================================================
router.get("/reconcile", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin" && req.user?.role !== "super") {
      return res.status(403).json({ success: false, message: "无权限（仅管理员可查看）" });
    }

    const { userId, phone } = req.query;

    // 1) 找用户
    let user = null;
    let uid = null;

    if (userId) {
      uid = toObjectIdMaybe(userId);
      if (!uid) return res.status(400).json({ success: false, message: "非法 userId" });
      user = await User.findById(uid).select("_id phone name").lean();
    } else if (phone) {
      const p0 = String(phone).trim();
      const pn = normalizePhone(p0);

      // 同手机号多 user：优先选“有 Wallet 的 userId”
      const users = await User.find({
        $or: [{ phone: p0 }, { phone: pn }, { phone: { $regex: pn } }],
      })
        .select("_id phone name")
        .lean();

      if (!users.length) {
        return res.json({ success: true, found: false, message: "用户不存在" });
      }

      const ids = users.map((u) => u._id);
      const w = await Wallet.findOne({ userId: { $in: ids } }).select("userId").lean();
      uid = w?.userId || users[0]._id;
      user = users.find((u) => String(u._id) === String(uid)) || users[0];
    } else {
      return res.status(400).json({ success: false, message: "请提供 phone 或 userId" });
    }

    if (!user || !uid) return res.json({ success: true, found: false, message: "用户不存在" });

    // 2) 取 Wallet
    const wallet = await Wallet.findOne({ userId: uid }).select("balance totalRecharge").lean();
    const walletBalance = Number(wallet?.balance || 0);
    const walletTotalRecharge = Number(wallet?.totalRecharge || 0);

    // 3) done 充值合计（以 Recharge 表为准）
    const doneRows = await Recharge.find({ userId: uid, status: "done" }).select("amount").lean();
    const doneSum = doneRows.reduce((s, r) => s + Number(r.amount || 0), 0);

    // 4) 最近 50 条充值记录
    const list = await Recharge.find({ userId: uid }).sort({ createdAt: -1 }).limit(50).lean();

    // 5) 差额（对账重点）
    const diff = Number((walletBalance - doneSum).toFixed(2));

    return res.json({
      success: true,
      found: true,
      user: { id: String(uid), phone: user.phone || "", name: user.name || "" },
      wallet: { balance: walletBalance, totalRecharge: walletTotalRecharge },
      recharge: { doneSum, countDone: doneRows.length },
      diff,
      list,
    });
  } catch (err) {
    console.error("GET /api/admin/recharge/reconcile error:", err);
    return res.status(500).json({ success: false, message: "对账失败" });
  }
});

export default router;
