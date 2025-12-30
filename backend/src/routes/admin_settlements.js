import express from "express";
import mongoose from "mongoose";
import Settlement from "../models/Settlement.js";
import Order from "../models/order.js";

const router = express.Router();
router.use(express.json());

// 1) 列表
router.get("/", async (req, res) => {
  const list = await Settlement.find()
    .sort({ createdAt: -1 })
    .populate("driverId", "name phone")
    .populate("leaderId", "name phone")
    .lean();

  res.json({ success: true, list });
});

// 2) 详情
router.get("/:id", async (req, res) => {
  const doc = await Settlement.findById(req.params.id)
    .populate("driverId", "name phone")
    .populate("leaderId", "name phone")
    .lean();

  if (!doc) return res.status(404).json({ success: false, message: "结算不存在" });

  const orders = await Order.find({ _id: { $in: doc.orderIds } })
    .select("orderNo customerName customerPhone totalAmount deliveryFee subtotal status deliveredAt deliveryDate")
    .lean();

  res.json({ success: true, data: doc, orders });
});

// 3) 生成司机结算（按日期范围）
router.post("/generate/driver", async (req, res) => {
  const { driverId, start, end, perOrderPay = 4 } = req.body || {};
  if (!mongoose.isValidObjectId(driverId))
    return res.status(400).json({ success: false, message: "driverId 不合法" });

  const periodStart = new Date(start);
  const periodEnd = new Date(end);
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()))
    return res.status(400).json({ success: false, message: "start/end 不合法" });

  // 查“可结算订单”
  const orders = await Order.find({
    driverId,
    status: "done",
    deliveryDate: { $gte: periodStart, $lte: periodEnd },
    settlementGenerated: false,
  }).lean();

  if (!orders.length) {
    return res.json({ success: true, message: "没有可结算订单", settlement: null });
  }

  const orderIds = orders.map((o) => o._id);

  const subtotalSum = orders.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
  const deliveryFeeSum = orders.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
  const totalAmountSum = orders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);

  const payout = orders.length * (Number(perOrderPay) || 0);

  // 先生成结算
  const settlement = await Settlement.create({
    type: "driver",
    driverId,
    periodStart,
    periodEnd,
    orderCount: orders.length,
    orderIds,
    subtotalSum,
    deliveryFeeSum,
    totalAmountSum,
    payout,
    status: "pending",
    generatedBy: "admin",
  });

  // 锁单（防重复结算）
  await Order.updateMany(
    { _id: { $in: orderIds } },
    { $set: { settlementGenerated: true, settlementId: settlement._id } }
  );

  res.json({ success: true, settlement });
});

// 4) 标记已付款
router.patch("/:id/pay", async (req, res) => {
  const doc = await Settlement.findByIdAndUpdate(
    req.params.id,
    { status: "paid" },
    { new: true }
  );
  if (!doc) return res.status(404).json({ success: false, message: "结算不存在" });
  res.json({ success: true, data: doc });
});

export default router;
