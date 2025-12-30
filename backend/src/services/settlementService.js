import Order from "../models/Order.js";
import Settlement from "../models/Settlement.js";

export async function generateDriverSettlement({
  driverId,
  start,
  end,
  perOrderPay = 4,
}) {
  const orders = await Order.find({
    driverId,
    deliveryDate: { $gte: start, $lte: end },
    settlementGenerated: false,
    status: "delivered",
  });

  if (!orders.length) return null;

  const orderIds = orders.map(o => o._id);
  const payout = orders.length * perOrderPay;

  const settlement = await Settlement.create({
    type: "driver",
    driverId,
    periodStart: start,
    periodEnd: end,
    orderCount: orders.length,
    orderIds,
    payout,
    status: "pending",
    generatedBy: "system",
  });

  // 🔒 锁单
  await Order.updateMany(
    { _id: { $in: orderIds } },
    { $set: { settlementGenerated: true } }
  );

  return settlement;
}
