// backend/src/routes/payments.js
import express from "express";
import mongoose from "mongoose";
import User from "../models/user.js";
import Order from "../models/order.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ payments.js LOADED:", import.meta.url);

function toObjectIdMaybe(v) {
  const s = String(v || "").trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// ===============================
// GET /api/payments/wallet
// 返回钱包余额（结算页展示用）
// ===============================
router.get("/wallet", requireLogin, async (req, res) => {
  try {
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    const u = await User.findById(userId).select("walletBalance");
    return res.json({ success: true, walletBalance: Number(u?.walletBalance || 0) });
  } catch (e) {
    console.error("GET /api/payments/wallet error:", e);
    return res.status(500).json({ success: false, message: "Load wallet failed" });
  }
});

// ===============================
// POST /api/payments/wallet/pay-order
// body: { orderId, idempotencyKey? }
// - 原子扣款 walletBalance
// - 标记订单 payment.paid + status=paid
// ===============================
router.post("/wallet/pay-order", requireLogin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const userId = toObjectIdMaybe(req.user?.id || req.user?._id);
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    const orderId = toObjectIdMaybe(req.body?.orderId);
    if (!orderId) return res.status(400).json({ success: false, message: "orderId required" });

    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();

    let resultOrder = null;
    let newBalance = 0;

    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, userId }).session(session);
      if (!order) throw new Error("订单不存在");

      // ✅ 已支付直接返回（防重复扣款）
      const payStatus = order.payment?.status || "unpaid";
      if (payStatus === "paid") {
        resultOrder = order;
        const u0 = await User.findById(userId).select("walletBalance").session(session);
        newBalance = Number(u0?.walletBalance || 0);
        return;
      }

      // ✅ 幂等：同一个 key 重复请求直接返回
      // ✅ 幂等：同一个 key 只有在订单已支付时才直接返回（避免误跳过扣款）
if (idempotencyKey && order.payment?.idempotencyKey === idempotencyKey) {
  const payStatus2 = order.payment?.status || "unpaid";
  if (payStatus2 === "paid") {
    resultOrder = order;
    const u0 = await User.findById(userId).select("walletBalance").session(session);
    newBalance = Number(u0?.walletBalance || 0);
    return;
  }
  // 未支付则继续走扣款流程
}
      // ✅ 计算应付金额（优先 payment.amountTotal，否则用 totalAmount）
      const amountTotal =
        Number(order.payment?.amountTotal ?? order.totalAmount ?? 0) || 0;

      if (!Number.isFinite(amountTotal) || amountTotal <= 0) {
        throw new Error("订单金额不合法");
      }

      // ✅ 原子扣款：余额必须足够
      const upd = await User.updateOne(
        { _id: userId, walletBalance: { $gte: amountTotal } },
        { $inc: { walletBalance: -amountTotal } }
      ).session(session);

      if (upd.modifiedCount !== 1) {
        throw new Error("余额不足");
      }

      // 读取最新余额
      const u = await User.findById(userId).select("walletBalance").session(session);
      newBalance = Number(u?.walletBalance || 0);

      // ✅ 标记订单已支付
      const now = new Date();
      order.status = "paid";
      order.paidAt = now;

      order.payment = order.payment || {};
      order.payment.status = "paid";
order.payment.method = "wallet";
order.payment.paidTotal = amountTotal;

// ✅ 对齐 orders.js / Order Model：使用 payment.wallet.paid 与 payment.stripe.paid
order.payment.wallet = order.payment.wallet || {};
order.payment.wallet.paid = amountTotal;

order.payment.stripe = order.payment.stripe || {};
order.payment.stripe.paid = 0;
order.payment.stripe.intentId = order.payment.stripe.intentId || "";

      order.payment.idempotencyKey = idempotencyKey || order.payment.idempotencyKey || "";

      // ✅ 金额快照（如果还没写过）
      if (!Number(order.payment.amountTotal)) {
        order.payment.amountTotal = amountTotal;
      }

      await order.save({ session });
      resultOrder = order;
    });

    return res.json({
      success: true,
      message: "paid",
      walletBalance: newBalance,
      order: resultOrder,
    });
  } catch (e) {
    console.error("POST /api/payments/wallet/pay-order error:", e);
    const msg = String(e?.message || "Pay order failed");
    return res.status(400).json({ success: false, message: msg });
  } finally {
    session.endSession();
  }
});

export default router;
