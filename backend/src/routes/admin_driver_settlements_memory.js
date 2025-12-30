// backend/src/routes/admin_driver_settlements_memory.js
import express from "express";
import {
  createDriverSettlement,
  listDriverSettlements,
  updateDriverSettlementStatus,
} from "../memory/settlementsStore.js";

const router = express.Router();

let demoSeeded = false;
function ensureDemoData() {
  if (demoSeeded) return;
  demoSeeded = true;

  const today = new Date();

  createDriverSettlement({
    driverName: "李司机",
    driverPhone: "18800001001",
    date: today,
    orderCount: 28,
    amount: 210,
    status: "pending",
  });

  createDriverSettlement({
    driverName: "王司机",
    driverPhone: "18800001002",
    date: today,
    orderCount: 21,
    amount: 180,
    status: "pending",
  });

  createDriverSettlement({
    driverName: "张司机",
    driverPhone: "18800001003",
    date: new Date(today.getTime() - 86400000),
    orderCount: 24,
    amount: 190,
    status: "settled",
  });
}

// GET /api/admin/driver-settlements
router.get("/", (req, res) => {
  try {
    ensureDemoData();

    const { page = 1, pageSize = 10 } = req.query;
    const result = listDriverSettlements({ page, pageSize });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("查询司机结算失败:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/admin/driver-settlements/:id/status
router.patch("/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    const record = updateDriverSettlementStatus(req.params.id, status);
    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: "司机结算记录不存在" });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    console.error("更新司机结算状态失败:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
