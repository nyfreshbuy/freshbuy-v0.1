// backend/src/routes/admin_leaders.js
import express from "express";
import User from "../models/user.js";
import { genLeaderCode } from "../utils/leaderCode.js";
// import { requireAdmin } from "../middlewares/admin.js";

const router = express.Router();
router.use(express.json());
// router.use(requireAdmin);

// ✅ 把某个用户升级为团长并生成邀请码
router.post("/make-leader", async (req, res) => {
  const userId = String(req.body.userId || "").trim();
  if (!userId) return res.status(400).json({ ok: false, message: "userId required" });

  const u = await User.findById(userId);
  if (!u) return res.status(404).json({ ok: false, message: "User not found" });

  u.role = "leader";

  if (!u.leaderCode) {
    for (let i = 0; i < 12; i++) {
      const code = genLeaderCode(6);
      const exists = await User.findOne({ leaderCode: code }).select("_id");
      if (!exists) {
        u.leaderCode = code;
        break;
      }
    }
    if (!u.leaderCode) {
      return res.status(500).json({ ok: false, message: "Failed to generate unique leaderCode" });
    }
  }

  await u.save();

  return res.json({ ok: true, userId: String(u._id), leaderCode: u.leaderCode });
});

export default router;