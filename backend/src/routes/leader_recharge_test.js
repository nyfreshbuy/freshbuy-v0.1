// backend/src/routes/leader_recharge_test.js
import express from "express";
import {
  getUserByPhone,
  rechargeUser,
} from "../mock/mockUsers.js";

const router = express.Router();

console.log("✅ leader_recharge_test (内存版) 路由已加载");

/**
 * 团长本地测试：给用户代充值（内存版）
 * POST /api/leader/recharge-user-test
 * body: { userPhone, amount, leaderName }
 */
router.post("/leader/recharge-user-test", (req, res) => {
  try {
    const { userPhone, amount, leaderName } = req.body;

    if (!userPhone || amount == null) {
      return res.status(400).json({
        success: false,
        message: "缺少 userPhone 或 amount",
      });
    }

    const money = Number(amount);
    if (!money || money <= 0) {
      return res.json({
        success: false,
        message: "充值金额必须是大于 0 的数字",
      });
    }

    const user = getUserByPhone(userPhone);
    if (!user) {
      return res.json({
        success: false,
        message: "该手机号对应的用户不存在（" + userPhone + "）",
      });
    }

    rechargeUser(user, money);

    const remark = `团长代充（内存测试）：${leaderName || "未知团长"}`;

    console.log(
      `[TEST] 团长 ${leaderName || "未知"} 为用户 ${
        user.name
      } (${user.phone}) 代充 $${money}`
    );

    return res.json({
      success: true,
      message: "代充值成功（内存版，本地测试）",
      user,
      remark,
    });
  } catch (err) {
    console.error("leader/recharge-user-test 内存版报错:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;
