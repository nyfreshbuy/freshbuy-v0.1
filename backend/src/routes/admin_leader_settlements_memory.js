// backend/src/routes/admin_leader_settlements_memory.js
import express from "express";
import {
  createLeaderSettlement,
  listLeaderSettlements,
  updateLeaderSettlementStatus,
  markAllLeaderSettlementsPaid,
} from "../memory/settlementsStore.js";

const router = express.Router();

let demoSeeded = false;
function ensureDemoData() {
  if (demoSeeded) return;
  demoSeeded = true;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);

  createLeaderSettlement({
    leaderName: "王团长",
    leaderPhone: "18800000001",
    periodStart: weekStart,
    periodEnd: now,
    orderCount: 126,
    amount: 1280.5,
    status: "pending",
  });

  createLeaderSettlement({
    leaderName: "Liqi",
    leaderPhone: "18800000002",
    periodStart: weekStart,
    periodEnd: now,
    orderCount: 82,
    amount: 620,
    status: "pending",
  });

  createLeaderSettlement({
    leaderName: "Amy",
    leaderPhone: "18800000003",
    periodStart: new Date(weekStart.getTime() - 7 * 86400000),
    periodEnd: new Date(weekStart.getTime() - 1 * 86400000),
    orderCount: 64,
    amount: 430,
    status: "settled",
  });
}

// GET /api/admin/leader-settlements
router.get("/", (req, res) => {
  try {
    ensureDemoData();

    const { page = 1, pageSize = 10 } = req.query;
    const result = listLeaderSettlements({ page, pageSize });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("查询团长结算失败:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/admin/leader-settlements/:id/status
router.patch("/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    const record = updateLeaderSettlementStatus(req.params.id, status);
    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: "结算记录不存在" });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    console.error("更新团长结算状态失败:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/admin/leader-settlements/mark-all-paid
router.patch("/mark-all-paid", (req, res) => {
  try {
    const count = markAllLeaderSettlementsPaid();
    res.json({ success: true, count });
  } catch (err) {
    console.error("一键标记已打款失败:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
