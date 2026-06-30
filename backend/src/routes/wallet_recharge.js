// backend/src/routes/wallet_recharge.js
import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";
import { requireLogin } from "../middlewares/auth.js";
import Recharge from "../models/Recharge.js";

const router = express.Router();
router.use(express.json());
const IS_PROD = process.env.NODE_ENV === "production";

console.log("✅ wallet_recharge.js loaded");
const MIN_RECHARGE_AMOUNT = 200;
// Stripe 初始化
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

// -------------------------
// 工具：ObjectId 兜底
// -------------------------
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// -------------------------
// 工具：前端域名兜底 + 自动补 https + 去掉末尾 /
// -------------------------
function getFrontendBaseUrl() {
  const raw = String(process.env.FRONTEND_BASE_URL || "").trim() || "https://nyfreshbuy.com";
  const withScheme =
    raw.startsWith("http://") || raw.startsWith("https://")
      ? raw
      : "https://" + raw.replace(/^\/+/, "");
  return withScheme.replace(/\/+$/, "");
}

// ===================================================
// GET /api/wallet/recharge/ping
// ===================================================
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "wallet_recharge" });
});

// ===================================================
// GET /api/wallet/recharge/__debug
// 用来确认 Render 是否部署了最新代码
// ===================================================
router.get("/__debug", (req, res) => {
  if (IS_PROD) return res.status(404).json({ success: false, message: "Not found" });
  res.json({
    ok: true,
    file: "backend/src/routes/wallet_recharge.js",
    ts: new Date().toISOString(),
    hasPIData: true,
    frontendBase: getFrontendBaseUrl(),
  });
});

// ===================================================
// POST /api/wallet/recharge/create
// ✅ 创建 Stripe Checkout（钱包充值）
// body: { amount }
// 返回：{ success:true, url }
// ===================================================
router.post("/create", requireLogin, async (req, res) => {
  try {
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message: "Stripe 未配置（缺少 STRIPE_SECRET_KEY）",
      });
    }

const amount = Number(req.body?.amount || 0);
if (!Number.isFinite(amount) || amount < MIN_RECHARGE_AMOUNT) {
  return res.status(400).json({
    success: false,
    message: `充值金额不合法（最低 $${MIN_RECHARGE_AMOUNT}）`,
  });
}

    const FRONTEND = getFrontendBaseUrl();

    // 1) 先创建 Recharge 记录（pending）
    const recharge = await Recharge.create({
      userId,
      amount,
      payMethod: "stripe",
      status: "pending",
      remark: "Stripe wallet recharge",
    });

    // ✅ DEBUG：确认线上走到这里
    console.log("💳 [wallet_recharge/create] creating checkout", {
      userId: String(userId),
      amount,
      rechargeId: String(recharge._id),
      frontend: FRONTEND,
    });

    // 2) 创建 Stripe Checkout Session
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

      // ✅ 关键：把 metadata 写进 PaymentIntent（payment_intent.succeeded 能读到）
      payment_intent_data: {
        metadata: {
          type: "wallet_recharge",
          rechargeId: recharge._id.toString(),
          userId: userId.toString(),
          amount: String(amount),
        },
      },

      // ✅ Session metadata（checkout.session.completed 可读）
      metadata: {
        type: "wallet_recharge",
        rechargeId: recharge._id.toString(),
        userId: userId.toString(),
        amount: String(amount),
      },

      success_url: `${FRONTEND}/user/recharge_success.html`,
      cancel_url: `${FRONTEND}/user/recharge_cancel.html`,
    });

    console.log("💳 [wallet_recharge/create] checkout created", {
      sessionId: session?.id,
      pi: session?.payment_intent || null,
    });

    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("POST /api/wallet/recharge/create error:", err?.message || err, err);
    return res.status(500).json({
      success: false,
      message: err?.message || "创建 Stripe 充值失败",
    });
  }
});

// ===================================================
// GET /api/wallet/recharge/zelle-info
// ✅ 前端显示 Zelle 收款账号 + 备注前缀（来自 Render 环境变量）
// ===================================================
router.get("/zelle-info", (req, res) => {
  const recipient = String(process.env.ZELLE_RECIPIENT || "").trim();
  const memoPrefix = String(process.env.ZELLE_MEMO_PREFIX || "Freshbuy充值").trim();

  return res.json({
    success: true,
    recipient,
    memoPrefix,
  });
});

// ===================================================
// POST /api/wallet/recharge/zelle
// ✅ 用户提交 Zelle 充值申请（pending，等待后台审核入账）
// body: { amount, ref?, memo? }
// ===================================================
router.post("/zelle", requireLogin, async (req, res) => {
  try {
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

   const amount = Number(req.body?.amount || 0);
if (!Number.isFinite(amount) || amount < MIN_RECHARGE_AMOUNT) {
  return res.status(400).json({
    success: false,
    message: `充值金额不合法（最低 $${MIN_RECHARGE_AMOUNT}）`,
  });
}
    const ref = String(req.body?.ref || "").trim();
    const memo = String(req.body?.memo || "").trim();

    const remarkParts = [];
    if (memo) remarkParts.push("memo=" + memo);
    if (ref) remarkParts.push("ref=" + ref);

    const rec = await Recharge.create({
      userId,
      amount,
      payMethod: "zelle",
      status: "pending",
      remark: remarkParts.join(" | ") || "Zelle recharge request",
    });

    console.log("💸 [wallet_recharge/zelle] submitted", {
      userId: String(userId),
      amount,
      rechargeId: String(rec._id),
      remark: rec.remark,
    });

    return res.json({
      success: true,
      message: "已提交 Zelle 充值申请（待审核）",
      id: rec._id.toString(),
    });
  } catch (err) {
    console.error("POST /api/wallet/recharge/zelle error:", err);
    return res.status(500).json({
      success: false,
      message: "提交 Zelle 申请失败",
    });
  }
});

export default router;
