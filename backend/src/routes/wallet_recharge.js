// backend/src/routes/wallet_recharge.js
import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";
import { requireLogin } from "../middlewares/auth.js";
import Wallet from "../models/Wallet.js";
import Recharge from "../models/Recharge.js";

const router = express.Router();
router.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

// 工具：ObjectId 兜底
function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// 工具：前端域名兜底 + 自动补 https
function getFrontendBaseUrl() {
  const raw = String(process.env.FRONTEND_BASE_URL || "").trim() || "https://nyfreshbuy.com";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/+$/, "");
  // 如果用户填的是 nyfreshbuy.com（无 scheme），自动补 https
  return ("https://" + raw.replace(/^\/+/, "")).replace(/\/+$/, "");
}

// ===================================================
// POST /api/wallet/recharge/create
// ✅ 创建 Stripe Checkout（钱包充值）
// body: { amount }
// ===================================================
router.post("/create", requireLogin, async (req, res) => {
  try {
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ message: "未登录" });

    // Stripe key 必须存在
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ message: "Stripe 未配置（缺少 STRIPE_SECRET_KEY）" });
    }

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount < 10) {
      return res.status(400).json({ message: "充值金额不合法（最低 $10）" });
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
      success_url: `${FRONTEND}/user/recharge_success.html`,
      cancel_url: `${FRONTEND}/user/recharge.html`,
      metadata: {
        type: "wallet_recharge",
        rechargeId: recharge._id.toString(),
        userId: userId.toString(),
        amount: String(amount),
      },
    });

    return res.json({ success: true, url: session.url });
  } catch (err) {
    // ✅ 把 Stripe 的真实错误也打印出来，方便你 Render 排查
    console.error("POST /wallet/recharge/create error:", err?.message || err, err);
    return res.status(500).json({ message: err?.message || "创建 Stripe 充值失败" });
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
    if (!userId) return res.status(401).json({ message: "未登录" });

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount < 10) {
      return res.status(400).json({ message: "充值金额不合法（最低 $10）" });
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

    return res.json({
      success: true,
      message: "已提交 Zelle 充值申请（待审核）",
      id: rec._id.toString(),
    });
  } catch (err) {
    console.error("POST /wallet/recharge/zelle error:", err);
    return res.status(500).json({ message: "提交 Zelle 申请失败" });
  }
});

export default router;
