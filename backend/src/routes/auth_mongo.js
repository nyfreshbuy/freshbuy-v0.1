// backend/src/routes/auth_mongo.js
import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireLogin } from "../middlewares/auth.js";

console.log("🔥 RUNNING auth_mongo.js FROM:", import.meta.url);

const router = express.Router();

// ✅ 确保 body 可用（不依赖 server.js）
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// =========================
// 测试接口：确认路由是否挂载成功
// GET /api/auth/ping
// =========================
router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "auth_mongo", time: new Date().toISOString() });
});
// =========================
// JWT 工具
// =========================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET 未设置，登录将失败");
}

function signToken(user) {
  return jwt.sign(
    {
      id: String(user._id),
      role: user.role,
      phone: user.phone,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// =========================
// 注册前短信 token 校验（你现在的注册逻辑需要）
// =========================
function verifySignupToken(signupToken, phone) {
  if (!signupToken) {
    return { ok: false, message: "缺少 signupToken（请先短信验证）" };
  }

  try {
    const payload = jwt.verify(signupToken, JWT_SECRET);

    if (payload.purpose !== "signup") {
      return { ok: false, message: "signupToken 用途不匹配" };
    }

    if (payload.phone !== phone) {
      return { ok: false, message: "signupToken 与手机号不匹配" };
    }

    return { ok: true, payload };
  } catch (e) {
    return { ok: false, message: "signupToken 无效或已过期（请重新验证短信）" };
  }
}

// =========================
// 注册（POST /api/auth/register）
// =========================
router.post("/register", async (req, res) => {
  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").replace(/[^\d]/g, "");
    const password = String(body.password || "");
    const signupToken = body.signupToken;

    if (!name || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "缺少参数",
      });
    }

    // ✅ 短信校验（如果你以后想关闭，可在这里改）
    const v = verifySignupToken(signupToken, phone);
    if (!v.ok) {
      return res.status(401).json({ success: false, message: v.message });
    }

    const exists = await User.findOne({ phone });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "手机号已注册",
      });
    }

    const user = await User.create({
      name,
      phone,
      password,
      role: "customer",
    });

    const token = signToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: String(user._id),
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/auth/register error:", err);
    return res.status(500).json({
      success: false,
      message: "注册失败",
    });
  }
});

// =========================
// 登录（POST /api/auth/login）
// =========================
router.post("/login", async (req, res) => {
  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const phone = String(body.phone || "").replace(/[^\d]/g, "");
    const password = String(body.password || "");

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "缺少参数",
      });
    }

    // ⚠️ password 通常是 select:false，这里必须 +password
    const user = await User.findOne({ phone }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "账号或密码错误",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "账号已禁用",
      });
    }

    const token = signToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: String(user._id),
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/auth/login error:", err);
    return res.status(500).json({
      success: false,
      message: "登录失败",
    });
  }
});

// =========================
// 管理员登录（POST /api/auth/admin-login）
// =========================
router.post("/admin-login", async (req, res) => {
  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const phone = String(body.phone || "").replace(/[^\d]/g, "");
    const password = String(body.password || "");

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "缺少参数",
      });
    }

    const user = await User.findOne({ phone }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "账号或密码错误",
      });
    }

    if (user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "非管理员账号",
      });
    }

    const token = signToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: String(user._id),
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/auth/admin-login error:", err);
    return res.status(500).json({
      success: false,
      message: "管理员登录失败",
    });
  }
});

// =========================
// 当前用户（GET /api/auth/me）
// =========================
router.get("/me", requireLogin, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      role: req.user.role,
      phone: req.user.phone,
    },
  });
});

export default router;
