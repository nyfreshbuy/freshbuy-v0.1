// backend/src/routes/admin_profit.js
import express from "express";
import Order from "../models/order.js";

const router = express.Router();

// =============================
// 工具：时间范围
// =============================
function buildDateMatch({ startDate, endDate }) {
  const match = { status: { $in: ["paid", "delivered"] } };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }

  return match;
}

// =============================
// 1️⃣ 总览
// =============================
router.get("/summary", async (req, res) => {
  try {
    const match = buildDateMatch(req.query);

    const orders = await Order.find(match);

    let revenue = 0;
    let cost = 0;
    let commission = 0;
    let tax = 0;

    for (const o of orders) {
      revenue += Number(o.subtotal || 0);
      tax += Number(o.salesTax || 0);
      commission += Number(o.leaderCommission?.amount || 0);

      for (const it of o.items || []) {
        cost += Number(it.cost || 0) * Number(it.qty || 0);
      }
    }

    const grossProfit = revenue - cost;
    const netProfit = grossProfit - commission;

    res.json({
      success: true,
      data: {
        revenue,
        cost,
        grossProfit,
        commission,
        tax,
        netProfit,
        orderCount: orders.length,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// =============================
// 2️⃣ 商品利润排行
// =============================
router.get("/products", async (req, res) => {
  try {
    const match = buildDateMatch(req.query);

    const orders = await Order.find(match);

    const map = {};

    for (const o of orders) {
      for (const it of o.items || []) {
        const key = it.productId + "_" + (it.name || "");

        if (!map[key]) {
          map[key] = {
            productId: it.productId,
            name: it.name,
            qty: 0,
            revenue: 0,
            cost: 0,
          };
        }

        map[key].qty += Number(it.qty || 0);
        map[key].revenue += Number(it.price || 0) * Number(it.qty || 0);
        map[key].cost += Number(it.cost || 0) * Number(it.qty || 0);
      }
    }

    const list = Object.values(map).map((x) => ({
      ...x,
      profit: x.revenue - x.cost,
      margin: x.revenue ? (x.revenue - x.cost) / x.revenue : 0,
    }));

    list.sort((a, b) => b.profit - a.profit);

    res.json({ success: true, data: list.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =============================
// 3️⃣ 团长利润分析
// =============================
router.get("/leaders", async (req, res) => {
  try {
    const match = buildDateMatch(req.query);

    const orders = await Order.find(match);

    const map = {};

    for (const o of orders) {
      const leaderId = o.leaderId || "unknown";

      if (!map[leaderId]) {
        map[leaderId] = {
          leaderId,
          orderCount: 0,
          revenue: 0,
          commission: 0,
        };
      }

      map[leaderId].orderCount += 1;
      map[leaderId].revenue += Number(o.subtotal || 0);
      map[leaderId].commission += Number(o.leaderCommission?.amount || 0);
    }

    const list = Object.values(map).sort((a, b) => b.revenue - a.revenue);

    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =============================
// 4️⃣ 低利润订单
// =============================
router.get("/low-profit", async (req, res) => {
  try {
    const match = buildDateMatch(req.query);

    const orders = await Order.find(match).limit(200);

    const list = orders.map((o) => {
      let cost = 0;

      for (const it of o.items || []) {
        cost += Number(it.cost || 0) * Number(it.qty || 0);
      }

      const revenue = Number(o.subtotal || 0);
      const commission = Number(o.leaderCommission?.amount || 0);
      const profit = revenue - cost - commission;

      return {
        _id: o._id,
        revenue,
        cost,
        commission,
        profit,
      };
    });

    list.sort((a, b) => a.profit - b.profit);

    res.json({ success: true, data: list.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;