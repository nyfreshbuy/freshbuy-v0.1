// backend/src/routes/admin_auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();
router.use(express.json());

console.log("✅ admin_auth.js 已加载");

// ✅ ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "admin_auth" });
});

// ===================================================
// POST /api/admin/auth/login
// body: { phone, password }
// 仅允许 role=admin 登录成功
// ===================================================
router.post("/login", async (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!phone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "phone/password 必填" });
    }

    const user = await User.findOne({ phone }).select(
      "_id name phone role password"
    );

    if (!user) {
      return res.status(401).json({ success: false, message: "账号或密码错误" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ success: false, message: "非管理员账号" });
    }

    const ok = await bcrypt.compare(password, user.password || "");
    if (!ok) {
      return res.status(401).json({ success: false, message: "账号或密码错误" });
    }

    const secret = process.env.JWT_SECRET || process.env.SECRET || "freshbuy_dev_secret";
    const token = jwt.sign(
      { id: user._id.toString(), role: user.role, phone: user.phone },
      secret,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("POST /api/admin/auth/login error:", err);
    return res.status(500).json({ success: false, message: "管理员登录失败" });
  }
});

export default router;
