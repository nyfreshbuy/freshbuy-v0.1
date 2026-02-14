// backend/src/routes/auth_mongo.js
import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/user.js";
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
// Phone normalize（US）
// 统一成：11位且以 1 开头（你数据库当前是这种：1718xxxxxxx）
// =========================
function normalizeUSPhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";

  // 10位 -> 补1
  if (digits.length === 10) return "1" + digits;

  // 11位且以1开头 -> 原样
  if (digits.length === 11 && digits.startsWith("1")) return digits;

  // 其他情况：先原样返回（你也可以改成 return "" 直接拒绝）
  return digits;
}

// =========================
// ✅ 小工具：生成请求ID，方便 Render 对照日志
// =========================
function makeReqId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

// =========================
// 注册（POST /api/auth/register）
// =========================
router.post("/register", async (req, res) => {
  const reqId = makeReqId();

  // ✅ 任何返回前统一打一个收尾日志（能看到 status）
  res.on("finish", () => {
    console.log("🧾 REGISTER OUT", {
      reqId,
      status: res.statusCode,
    });
  });

  try {
    // ✅ body 解析：兼容偶发 req.body 是 string
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch (e) {
        console.warn("❌ REGISTER BAD JSON", {
          reqId,
          contentType: req.headers["content-type"],
          err: e?.message,
        });
        return res.status(400).json({
          success: false,
          msg: "请求格式错误（JSON 解析失败）",
          message: "请求格式错误（JSON 解析失败）",
          reqId,
        });
      }
    }

    // ✅ 统一手机号格式（10位->补1，11位以1开头->原样）
    const phoneRaw = String(body.phone || "");
    const phone = normalizeUSPhone(phoneRaw);

    const password = String(body.password || "");
    const signupToken = body.signupToken;

    // ✅ name 不强制：客人没填也能注册（自动生成“用户xxxx”）
    const name =
      String(body.name || "").trim() || ("用户" + String(phone || "").slice(-4));

    // ✅ 命中日志（不打印密码/验证码内容，只打印长度）
    console.log("🧾 REGISTER HIT", {
      reqId,
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
      ua: body.ua || req.headers["user-agent"] || "",
      contentType: req.headers["content-type"] || "",
      phoneRawTail: phoneRaw ? phoneRaw.slice(-4) : "",
      phoneTail: phone ? phone.slice(-4) : "",
      phoneLen: phone ? phone.length : 0,
      hasName: !!String(body.name || "").trim(),
      passwordLen: password ? password.length : 0,
      hasSignupToken: !!signupToken,
      signupTokenLen: signupToken ? String(signupToken).length : 0,
      hasCode: !!body.code,
      codeLen: body.code ? String(body.code).length : 0,
      requireSms: process.env.REQUIRE_SMS_SIGNUP === "1",
      mongoDb: process.env.MONGODB_URI ? "set" : "missing",
    });

    // ✅ 参数校验：只强制 phone + password
    if (!phone || !password) {
      console.warn("❌ REGISTER REJECT", {
        reqId,
        reason: "缺少参数（手机号/密码）",
        phoneOk: !!phone,
        passwordOk: !!password,
      });

      return res.status(400).json({
        success: false,
        msg: "缺少参数（手机号/密码）",
        message: "缺少参数（手机号/密码）",
        reqId,
      });
    }

    // ✅ 是否强制短信验证（开关）
    const REQUIRE_SMS = process.env.REQUIRE_SMS_SIGNUP === "1";

    if (REQUIRE_SMS) {
      const v = verifySignupToken(signupToken, phone);
      if (!v.ok) {
        console.warn("❌ REGISTER REJECT", {
          reqId,
          reason: "短信验证未通过",
          detail: v.message,
        });

        return res.status(400).json({
          success: false,
          msg: v.message,
          message: v.message,
          reqId,
        });
      }
    }

    const exists = await User.findOne({ phone });
    if (exists) {
      console.warn("❌ REGISTER REJECT", {
        reqId,
        reason: "手机号已注册",
        phoneTail: phone.slice(-4),
      });

      return res.status(400).json({
        success: false,
        msg: "手机号已注册",
        message: "手机号已注册",
        reqId,
      });
    }

    const user = await User.create({
      name,
      phone,
      password,
      role: "customer",
    });

    const token = signToken(user);

    console.log("✅ REGISTER OK", {
      reqId,
      userId: String(user._id),
      phoneTail: phone.slice(-4),
    });

    return res.json({
      success: true,
      token,
      user: {
        id: String(user._id),
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      reqId,
    });
  } catch (err) {
    // ✅ Mongo 重复键（比如 phone unique）兜底成友好提示
    if (err && (err.code === 11000 || String(err.message || "").includes("E11000"))) {
      console.warn("❌ REGISTER REJECT", {
        reqId,
        reason: "Mongo duplicate key（手机号已注册）",
        code: err.code,
        msg: err.message,
      });

      return res.status(400).json({
        success: false,
        msg: "手机号已注册",
        message: "手机号已注册",
        reqId,
      });
    }

    // ✅ 这里把真实错误完整打印到 Render
    console.error("❌ REGISTER FAIL", {
      reqId,
      msg: err?.message,
      code: err?.code,
      name: err?.name,
    });
    if (err?.stack) console.error("❌ REGISTER STACK", err.stack);

    return res.status(500).json({
      success: false,
      msg: "注册失败",
      message: "注册失败",
      reqId,
    });
  }
});

// =========================
// 登录（POST /api/auth/login）
// =========================
router.post("/login", async (req, res) => {
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const phoneRaw = String(body.phone || "");
    const phone = normalizeUSPhone(phoneRaw);

    const password = String(body.password || "");

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        msg: "缺少参数",
        message: "缺少参数",
      });
    }

    const user = await User.findOne({ phone }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        msg: "账号或密码错误",
        message: "账号或密码错误",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        msg: "账号已禁用",
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
      msg: "登录失败",
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
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const phoneRaw = String(body.phone || "");
    const phone = normalizeUSPhone(phoneRaw);

    const password = String(body.password || "");

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        msg: "缺少参数",
        message: "缺少参数",
      });
    }

    const user = await User.findOne({ phone }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        msg: "账号或密码错误",
        message: "账号或密码错误",
      });
    }

    if (user.role !== "admin") {
      return res.status(403).json({
        success: false,
        msg: "非管理员账号",
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
      msg: "管理员登录失败",
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
