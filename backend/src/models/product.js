// backend/src/routes/orders.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js";
import Product from "../models/product.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🧾 orders.js loaded (variants stock shared)");

/**
 * 统一返回错误
 */
function bad(res, message, code = 400, extra = {}) {
  return res.status(code).json({ success: false, message, ...extra });
}

/**
 * 订单状态建议：
 * - pending: 已创建（库存已预扣），待支付
 * - paid: 已支付
 * - cancelled: 已取消（库存已回滚）
 */
function normalizeQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * 从 product.variants 找 variant
 * - 找不到：默认单个 unitCount=1
 */
function getVariant(product, variantKey) {
  const key = String(variantKey || "").trim();
  const list = Array.isArray(product.variants) ? product.variants : [];
  const v = list.find((x) => String(x.key || "").trim() === key);
  if (v && v.enabled !== false) return v;
  // 兼容：没传 variantKey 或没配置 variants 时
  return { key: "single", label: "单个", unitCount: 1, price: null };
}

/**
 * 预扣库存（创建订单时）
 * items: [{productId, variantKey, quantity}]
 */
async function reserveStock(items) {
  // 使用 session 事务（MongoDB replica set/Atlas 支持）
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reserved = []; // 记录扣了哪些库存用于失败回滚/写入订单
    for (const it of items) {
      const productId = String(it.productId || "").trim();
      const variantKey = String(it.variantKey || "").trim();
      const quantity = normalizeQty(it.quantity);

      if (!productId) throw new Error("商品缺少 productId");
      if (quantity <= 0) throw new Error("商品数量不合法");

      const product = await Product.findById(productId).session(session);
      if (!product) throw new Error("商品不存在: " + productId);

      const variant = getVariant(product, variantKey);
      const unitCount = Math.max(1, normalizeQty(variant.unitCount || 1));
      const needUnits = quantity * unitCount;

      // 不允许 0 库存还下单：你已有 allowZeroStock 开关
      const allowZero = product.allowZeroStock === true;
      if (!allowZero && Number(product.stock || 0) < needUnits) {
        throw new Error(`库存不足: ${product.name}`);
      }

      // ✅ 扣库存（预扣）
      product.stock = Number(product.stock || 0) - needUnits;
      await product.save({ session });

      reserved.push({
        productId: product._id,
        variantKey: variant.key || variantKey || "single",
        unitCount,
        quantity,
        needUnits,
        price: variant.price != null ? Number(variant.price) : Number(product.price || 0),
        name: product.name,
        image: product.image || "",
      });
    }

    await session.commitTransaction();
    session.endSession();
    return reserved;
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    throw e;
  }
}

/**
 * 回滚库存（取消/支付失败）
 */
async function rollbackStock(items) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    for (const it of items) {
      const product = await Product.findById(it.productId).session(session);
      if (!product) continue;
      const addBack = Number(it.needUnits || (normalizeQty(it.quantity) * normalizeQty(it.unitCount || 1)));
      product.stock = Number(product.stock || 0) + addBack;
      await product.save({ session });
    }
    await session.commitTransaction();
    session.endSession();
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    throw e;
  }
}

// =========================
// ping
// =========================
router.get("/ping", (req, res) => res.json({ ok: true, name: "orders" }));

// =========================
// 创建订单（预扣库存）
// POST /api/orders
// body: { items: [{productId, variantKey, quantity}], address, note, payMethod }
// =========================
router.post("/", requireLogin, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return bad(res, "未登录", 401);

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return bad(res, "items 不能为空");

    // 1) 预扣库存，并把“规格换算后的明细”拿到
    const reservedItems = await reserveStock(items);

    // 2) 计算金额（这里给一个基础版；你可以接入优惠券/税/运费）
    const subtotal = reservedItems.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0);
    const total = Number(subtotal.toFixed(2));

    // 3) 创建订单
    const order = await Order.create({
      userId,
      status: "pending", // 待支付（库存已预扣）
      payStatus: "pending",
      payMethod: String(req.body.payMethod || "unknown"),
      items: reservedItems.map((it) => ({
        productId: it.productId,
        variantKey: it.variantKey,
        unitCount: it.unitCount,
        quantity: it.quantity,
        price: it.price,
        name: it.name,
        image: it.image,
      })),
      stockReserve: reservedItems.map((it) => ({
        productId: it.productId,
        variantKey: it.variantKey,
        unitCount: it.unitCount,
        quantity: it.quantity,
        needUnits: it.needUnits,
      })),
      address: req.body.address || null,
      note: String(req.body.note || ""),
      subtotal,
      total,
    });

    return res.json({ success: true, order });
  } catch (e) {
    return bad(res, e.message || "创建订单失败");
  }
});

// =========================
// 标记已支付（你可以在 Stripe webhook / 钱包扣款成功后调用）
// POST /api/orders/:id/markPaid
// =========================
router.post("/:id/markPaid", requireLogin, async (req, res) => {
  try {
    const userId = req.user?._id;
    const id = req.params.id;

    const order = await Order.findById(id);
    if (!order) return bad(res, "订单不存在", 404);
    if (String(order.userId) !== String(userId) && req.user.role !== "admin") {
      return bad(res, "无权限", 403);
    }

    if (order.status === "paid" || order.payStatus === "paid") {
      return res.json({ success: true, order });
    }

    order.status = "paid";
    order.payStatus = "paid";
    order.paidAt = new Date();
    await order.save();

    return res.json({ success: true, order });
  } catch (e) {
    return bad(res, e.message || "更新支付状态失败");
  }
});

// =========================
// 取消订单（回滚库存）
// POST /api/orders/:id/cancel
// =========================
router.post("/:id/cancel", requireLogin, async (req, res) => {
  try {
    const userId = req.user?._id;
    const id = req.params.id;

    const order = await Order.findById(id);
    if (!order) return bad(res, "订单不存在", 404);

    if (String(order.userId) !== String(userId) && req.user.role !== "admin") {
      return bad(res, "无权限", 403);
    }

    if (order.status === "cancelled") return res.json({ success: true, order });
    if (order.status === "paid" || order.payStatus === "paid") {
      return bad(res, "已支付订单不能直接取消（需走退款流程）", 400);
    }

    // 回滚库存（用 stockReserve 最准）
    const reserve = Array.isArray(order.stockReserve) ? order.stockReserve : [];
    await rollbackStock(reserve);

    order.status = "cancelled";
    order.payStatus = "cancelled";
    order.cancelledAt = new Date();
    await order.save();

    return res.json({ success: true, order });
  } catch (e) {
    return bad(res, e.message || "取消订单失败");
  }
});

// =========================
// 获取我的订单
// GET /api/orders/my
// =========================
router.get("/my", requireLogin, async (req, res) => {
  try {
    const userId = req.user?._id;
    const list = await Order.find({ userId }).sort({ createdAt: -1 }).limit(100);
    return res.json({ success: true, list });
  } catch (e) {
    return bad(res, e.message || "获取订单失败");
  }
});

export default router;
