// backend/src/routes/recharge.js
import express from "express";
import mongoose from "mongoose";
import Stripe from "stripe";

import Recharge from "../models/Recharge.js";
import User from "../models/user.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();

// ⚠️ 这里是 JSON body 解析（Webhook 用 raw，不放在这个文件里）
router.use(express.json());

console.log("✅ recharge.js (DB + Stripe + Zelle) 已加载");

// =========================
// Stripe 初始化
// =========================
const stripe =
  process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim()
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

// =========================
// 工具函数
// =========================
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

function getUserIdFromReq(req) {
  const userIdStr = req.user?.id || req.user?._id || "";
  return toObjectIdMaybe(userIdStr);
}

function mustUserId(req, res) {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    res.status(401).json({ success: false, message: "未登录（缺少 token id）" });
    return null;
  }
  return userId;
}

function parseAmount(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function assertAmount(amount, res, min = 10, max = 5000) {
  if (!Number.isFinite(amount) || amount < min || amount > max) {
    res.status(400).json({ success: false, message: `充值金额不合法（${min}-${max}）` });
    return false;
  }
  return true;
}

// ✅ ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "recharge" });
});

// =====================================================
// GET /api/recharge/zelle-info
// 给前端显示 Zelle 收款信息
// =====================================================
router.get("/zelle-info", (req, res) => {
  res.json({
    recipient: process.env.ZELLE_RECIPIENT || "",
    memoPrefix: process.env.ZELLE_MEMO_PREFIX || "Freshbuy充值",
  });
});

// =====================================================
// GET /api/recharge/my
// 获取我的充值记录
// =====================================================
router.get("/my", requireLogin, async (req, res) => {
  try {
    const userId = mustUserId(req, res);
    if (!userId) return;

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
// POST /api/recharge/stripe/create
// Stripe：创建 Checkout Session（返回跳转 url）
// body: { amount }
// =====================================================
router.post("/stripe/create", requireLogin, async (req, res) => {
  try {
    const userId = mustUserId(req, res);
    if (!userId) return;

    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe 未配置（缺少 STRIPE_SECRET_KEY）" });
    }

    const amount = parseAmount(req.body?.amount);
    if (!assertAmount(amount, res, 10, 5000)) return;

    const FRONTEND_URL = String(process.env.FRONTEND_URL || "").trim();
    if (!FRONTEND_URL) {
      return res.status(500).json({ success: false, message: "缺少 FRONTEND_URL 环境变量" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Freshbuy 账户充值" },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: String(userId),
        rechargeAmount: String(amount),
      },
      success_url: `${FRONTEND_URL}/user/recharge_success.html`,
      cancel_url: `${FRONTEND_URL}/user/recharge.html`,
    });

    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("POST /api/recharge/stripe/create error:", err);
    return res.status(500).json({ success: false, message: "创建 Stripe 支付失败" });
  }
});

// =====================================================
// POST /api/recharge/zelle
// Zelle：提交充值申请（pending，不直接加余额）
// body: { amount, ref, memo }
// =====================================================
router.post("/zelle", requireLogin, async (req, res) => {
  try {
    const userId = mustUserId(req, res);
    if (!userId) return;

    const amount = parseAmount(req.body?.amount);
    if (!assertAmount(amount, res, 10, 5000)) return;

    const ref = String(req.body?.ref || "").trim();
    const memo = String(req.body?.memo || "").trim();

    // ✅ 只记录，不入账（等待后台确认）
    const rec = await Recharge.create({
      userId,
      amount,
      bonus: "",
      payMethod: "zelle",
      status: "pending",
      remark: `ref=${ref}${memo ? " | memo=" + memo : ""}`,
    });

    return res.json({
      success: true,
      record: {
        id: rec._id.toString(),
        amount: Number(rec.amount || 0),
        payMethod: rec.payMethod,
        status: rec.status,
        remark: rec.remark || "",
        createdAt: rec.createdAt,
      },
      message: "已提交 Zelle 充值申请，等待人工确认入账",
    });
  } catch (err) {
    console.error("POST /api/recharge/zelle error:", err);
    return res.status(500).json({ success: false, message: "提交 Zelle 申请失败" });
  }
});

// =====================================================
// POST /api/recharge  （测试版：直接入账 + 增加钱包余额）
// body: { amount, bonus, payMethod, remark }
// ⚠️ 说明：这个接口会直接加余额，生产建议只留给管理员或测试使用
// =====================================================
router.post("/", requireLogin, async (req, res) => {
  try {
    const userId = mustUserId(req, res);
    if (!userId) return;

    const amount = parseAmount(req.body?.amount);
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
