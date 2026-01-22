// backend/src/routes/admin_auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/user.js";

const router = express.Router();
router.use(express.json());

console.log("✅ admin_auth.js 已加载");

// =========================
// Phone normalize（US）
// 统一成：11位且以 1 开头（你数据库当前是这种：1718xxxxxxx）
// =========================
function normalizeUSPhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

// ✅ ping
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "admin_auth" });
});

// ===================================================
// 内部实现：登录处理（避免复制粘贴两份）
// ===================================================
async function handleLogin(req, res) {
  try {
    const phoneRaw = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "").trim();
    const phone = normalizeUSPhone(phoneRaw);

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: "phone/password 必填" });
    }

    // ✅ 你库里 phone 是纯数字字符串，这里用 normalize 后的 phone 查
    const user = await User.findOne({ phone }).select("_id name phone role password");

    if (!user) {
      return res.status(401).json({ success: false, message: "账号或密码错误" });
    }

    // ✅ 仍然保持“仅管理员能登录”逻辑不变
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
    console.error("POST login error (admin_auth.js):", err);
    return res.status(500).json({ success: false, message: "管理员登录失败" });
  }
}

// ===================================================
// POST /api/admin/auth/login
// body: { phone, password }
// 仅允许 role=admin 登录成功
// ===================================================
router.post("/login", handleLogin);

// ===================================================
// ✅ 兼容根路径 /login（你前端 Network 里就是打的 /login）
// 如果你 server.js 把本 router 挂在 /api/admin/auth，
// 那前端打 /login 会走不到；加一个别名可以兜底。
// 注意：如果你已经有别的 /login 路由，这里可能冲突。
// ===================================================
router.post("/../login", (req, res) => handleLogin(req, res)); // 保险写法（大多数不会命中）

// 更通用的兜底（推荐）：由 server.js 直接加 app.post("/login", ...) 转发
// 但如果你就想在这个文件里兜底，请用下面这个：
// ⚠️ 前提：server.js 挂载这个 router 在根路径（app.use("/", adminAuth))
// router.post("/login", handleLogin);

export default router;
