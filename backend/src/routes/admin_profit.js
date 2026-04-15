// backend/src/routes/admin_profit.js
import express from "express";
import Order from "../models/order.js";
import Invoice from "../models/Invoice.js";

const router = express.Router();

// =============================
// 工具：时间范围
// =============================
function buildDateMatch({ startDate, endDate }) {
  const match = {
    status: { $in: ["paid", "delivered", "done", "completed"] },
  };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) {
      match.createdAt.$gte = new Date(String(startDate));
    }
    if (endDate) {
      const end = new Date(String(endDate));
      end.setHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }

  return match;
}

function buildInvoiceDateMatch({ startDate, endDate }) {
  const match = {};

  if (startDate || endDate) {
    match.date = {};
    if (startDate) {
      match.date.$gte = new Date(String(startDate));
    }
    if (endDate) {
      const end = new Date(String(endDate));
      end.setHours(23, 59, 59, 999);
      match.date.$lte = end;
    }
  }

  return match;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function orderItemRevenue(it) {
  return num(it?.lineTotal ?? num(it?.price) * num(it?.qty));
}

function orderItemCost(it) {
  // ✅ 1. 优先使用 FIFO 成本（你已经算好的）
  if (Number(it?.totalCost || 0) > 0) {
    return Number(it.totalCost);
  }

  // ✅ 2. 兼容老数据（没有 totalCost 的情况）
  const qty = Number(it?.qty || 0);
  const unitCount = Number(it?.unitCount || 1);

  const unitCost = Number(
    it?.unitCostSnapshot ??
    it?.cost ??
    0
  );

  return unitCost * qty * unitCount;
}

function calcMargin(revenue, profit) {
  return revenue > 0 ? profit / revenue : 0;
}

// =============================
// 1️⃣ 总览
// GET /api/admin/profit/summary
// =============================
router.get("/summary", async (req, res) => {
  try {
    const orderMatch = buildDateMatch(req.query);
    const invoiceMatch = buildInvoiceDateMatch(req.query);

    const [orders, invoices] = await Promise.all([
      Order.find(orderMatch),
      Invoice.find(invoiceMatch),
    ]);

    let orderRevenue = 0;
    let orderCost = 0;
    let commission = 0;
    let tax = 0;

    for (const o of orders) {
      tax += num(o?.salesTax);
      commission += num(o?.leaderCommission?.amount);

      for (const it of o?.items || []) {
        orderRevenue += orderItemRevenue(it);
        orderCost += orderItemCost(it);
      }
    }

    let invoiceRevenue = 0;
    let invoiceCost = 0;

    for (const inv of invoices) {
  invoiceRevenue += num(inv?.total);

  // ✅ 优先使用总成本（新数据）
  if (Number(inv?.totalCost || 0) > 0) {
    invoiceCost += Number(inv.totalCost);
    continue;
  }

  // ❗ fallback：老发票没有 totalCost，用每行重算
  for (const it of inv?.items || []) {
    const qty = Number(it?.qty || 0);
    const unitCost = Number(it?.unitCost || 0);
    const unitCount = Number(it?.unitCount || 1);

    invoiceCost += unitCost * qty * unitCount;
  }
}
    const revenue = orderRevenue + invoiceRevenue;
    const cost = orderCost + invoiceCost;
    const grossProfit = revenue - cost;
    const netProfit = grossProfit - commission;
    const margin = calcMargin(revenue, grossProfit);

    res.json({
      success: true,
      data: {
        revenue,
        cost,
        grossProfit,
        margin,
        commission,
        tax,
        netProfit,
        orderCount: orders.length,
        invoiceCount: invoices.length,
        orders: {
          revenue: orderRevenue,
          cost: orderCost,
          grossProfit: orderRevenue - orderCost,
          margin: calcMargin(orderRevenue, orderRevenue - orderCost),
        },
        invoices: {
          revenue: invoiceRevenue,
          cost: invoiceCost,
          grossProfit: invoiceRevenue - invoiceCost,
          margin: calcMargin(invoiceRevenue, invoiceRevenue - invoiceCost),
        },
      },
    });
  } catch (e) {
    console.error("GET /api/admin/profit/summary error:", e);
    res.status(500).json({ success: false, message: e.message || "profit summary failed" });
  }
});

// =============================
// 2️⃣ 商品利润排行
// GET /api/admin/profit/products
// =============================
router.get("/products", async (req, res) => {
  try {
    const orderMatch = buildDateMatch(req.query);
    const orders = await Order.find(orderMatch);

    const map = {};

    for (const o of orders) {
      for (const it of o?.items || []) {
        const productId = String(it?.productId || "");
        const name = String(it?.name || "");
        const key = `${productId}_${name}`;

        if (!map[key]) {
          map[key] = {
            productId,
            name,
            qty: 0,
            revenue: 0,
            cost: 0,
          };
        }

        map[key].qty += num(it?.qty);
        map[key].revenue += orderItemRevenue(it);
        map[key].cost += orderItemCost(it);
      }
    }

    const list = Object.values(map).map((x) => {
      const profit = x.revenue - x.cost;
      return {
        ...x,
        profit,
        margin: calcMargin(x.revenue, profit),
      };
    });

    list.sort((a, b) => b.profit - a.profit);

    res.json({
      success: true,
      data: list.slice(0, 50),
    });
  } catch (e) {
    console.error("GET /api/admin/profit/products error:", e);
    res.status(500).json({ success: false, message: e.message || "products profit failed" });
  }
});

// =============================
// 3️⃣ 团长利润分析
// GET /api/admin/profit/leaders
// =============================
router.get("/leaders", async (req, res) => {
  try {
    const orderMatch = buildDateMatch(req.query);
    const orders = await Order.find(orderMatch);

    const map = {};

    for (const o of orders) {
      const leaderId = String(o?.leaderId || "unknown");

      if (!map[leaderId]) {
        map[leaderId] = {
          leaderId,
          orderCount: 0,
          revenue: 0,
          cost: 0,
          commission: 0,
        };
      }

      let orderRevenue = 0;
      let orderCost = 0;

      for (const it of o?.items || []) {
        orderRevenue += orderItemRevenue(it);
        orderCost += orderItemCost(it);
      }

      map[leaderId].orderCount += 1;
      map[leaderId].revenue += orderRevenue;
      map[leaderId].cost += orderCost;
      map[leaderId].commission += num(o?.leaderCommission?.amount);
    }

    const list = Object.values(map)
      .map((x) => {
        const grossProfit = x.revenue - x.cost;
        const netProfit = grossProfit - x.commission;

        return {
          ...x,
          grossProfit,
          netProfit,
          margin: calcMargin(x.revenue, grossProfit),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    res.json({
      success: true,
      data: list,
    });
  } catch (e) {
    console.error("GET /api/admin/profit/leaders error:", e);
    res.status(500).json({ success: false, message: e.message || "leaders profit failed" });
  }
});

// =============================
// 4️⃣ 低利润订单
// GET /api/admin/profit/low-profit
// =============================
router.get("/low-profit", async (req, res) => {
  try {
    const orderMatch = buildDateMatch(req.query);
    const orders = await Order.find(orderMatch).limit(200);

    const list = orders.map((o) => {
      let revenue = 0;
      let cost = 0;

      for (const it of o?.items || []) {
        revenue += orderItemRevenue(it);
        cost += orderItemCost(it);
      }

      const commission = num(o?.leaderCommission?.amount);
      const grossProfit = revenue - cost;
      const profit = grossProfit - commission;

      return {
        _id: o._id,
        orderNo: o.orderNo || "",
        revenue,
        cost,
        grossProfit,
        commission,
        profit,
        margin: calcMargin(revenue, grossProfit),
      };
    });

    list.sort((a, b) => a.profit - b.profit);

    res.json({
      success: true,
      data: list.slice(0, 50),
    });
  } catch (e) {
    console.error("GET /api/admin/profit/low-profit error:", e);
    res.status(500).json({ success: false, message: e.message || "low profit failed" });
  }
});

export default router;