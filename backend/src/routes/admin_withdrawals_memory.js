// backend/src/routes/admin_withdrawals_memory.js
import express from "express";
import {
  createWithdrawal,
  listWithdrawals,
  updateWithdrawalStatus,
} from "../memory/settlementsStore.js";

const router = express.Router();

// ✅ 团长发起提现（或者后台帮团长录入）
router.post("/", (req, res) => {
  try {
    const w = createWithdrawal(req.body || {});
    res.json({ success: true, data: w });
  } catch (err) {
    console.error("创建提现失败:", err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// ✅ 查询提现列表（带筛选 + 分页）
router.get("/", (req, res) => {
  try {
    const {
      leaderName,
      status,
      startDate,
      endDate,
      page,
      pageSize,
    } = req.query;

    const result = listWithdrawals({
      leaderName,
      status,
      startDate,
      endDate,
      page,
      pageSize,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("查询提现失败:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ 管理员审核提现（通过/拒绝/已打款）
router.patch("/:id/status", (req, res) => {
  try {
    const updated = updateWithdrawalStatus(req.params.id, req.body || {});
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "提现记录不存在" });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("更新提现状态失败:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
