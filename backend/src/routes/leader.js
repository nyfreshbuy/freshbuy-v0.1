// backend/src/routes/leader.js
import express from "express";
import User from "../models/user.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());
router.use(requireLogin);

// ✅ 团长中心：我的信息（邀请码、余额、团队人数）
router.get("/me", async (req, res) => {
  const me = await User.findById(req.user._id).select(
    "role leaderCode leaderCommissionBalance leaderTotalCommissionEarned"
  );

  if (!me) return res.status(404).json({ ok: false, message: "User not found" });

  const isLeader = me.role === "leader";
  if (!isLeader) {
    return res.json({ ok: true, isLeader: false });
  }

  const teamCount = await User.countDocuments({ invitedByLeaderId: me._id });

  return res.json({
    ok: true,
    isLeader: true,
    leaderCode: me.leaderCode,
    balance: me.leaderCommissionBalance,
    totalEarned: me.leaderTotalCommissionEarned,
    teamCount,
  });
});

// ✅ 团长中心：我的团队列表（被我邀请的用户）
router.get("/team", async (req, res) => {
  const me = await User.findById(req.user._id).select("role");
  if (!me || me.role !== "leader") {
    return res.status(403).json({ ok: false, message: "Not a leader" });
  }

  const list = await User.find({ invitedByLeaderId: me._id })
    .select("phone name accountSettings.displayName createdAt")
    .sort({ createdAt: -1 })
    .limit(200);

  return res.json({ ok: true, list });
});

export default router;