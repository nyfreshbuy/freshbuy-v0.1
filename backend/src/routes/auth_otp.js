import express from "express";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import User from "../models/user.js";

const router = express.Router();
router.use(express.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET 未设置，signupToken 会无法签发");
}

// ✅ 你 DB 里 phone 存纯数字：10-15 位（你 User.js 也是这个逻辑）
const normDigits = (p) => String(p || "").replace(/[^\d]/g, "");

// ✅ Twilio Verify 的 to 需要 E.164：美国默认 +1
function toE164US(phoneInput) {
  const s = String(phoneInput || "").trim();
  if (s.startsWith("+")) return s; // 已经是 E.164
  const digits = normDigits(s);
  // 你主要在美国：10位 → +1；已带国家码的 11-15 位 → +<digits>
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return ""; // 无效
}

// ✅ 限流：防止短信被刷爆（按需调）
const otpStartLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const pwdOtpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
});

const pwdResetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// =======================
// 1) 注册：发送验证码
// POST /api/auth/otp/start  body: { phone }
// =======================
router.post("/otp/start", otpStartLimiter, async (req, res) => {
  try {
    const to = toE164US(req.body.phone);
    if (!to) return res.status(400).json({ success: false, message: "phone invalid" });

    const r = await client.verify.v2
      .services(VERIFY_SID)
      .verifications.create({ to, channel: "sms" });

    return res.json({ success: true, status: r.status }); // pending
  } catch (err) {
    console.error("otp/start error:", err);
    return res.status(500).json({ success: false, message: "send otp failed" });
  }
});

// =======================
// 2) 注册：校验验证码 + 返回 signupToken（10分钟）
// POST /api/auth/otp/check  body: { phone, code }
// =======================
router.post("/otp/check", otpCheckLimiter, async (req, res) => {
  try {
    const to = toE164US(req.body.phone);
    const code = String(req.body.code || "").trim();
    if (!to || !code) {
      return res.status(400).json({ success: false, message: "phone & code required" });
    }

    const r = await client.verify.v2
      .services(VERIFY_SID)
      .verificationChecks.create({ to, code });

    if (r.status !== "approved") {
      return res.status(400).json({ success: false, message: "invalid code", status: r.status });
    }

    // ✅ signupToken 里存“DB 统一格式：纯数字 phone”
    const phoneDigits = normDigits(req.body.phone);

    const signupToken = jwt.sign(
      { purpose: "signup", phone: phoneDigits },
      JWT_SECRET,
      { expiresIn: "10m" }
    );

    return res.json({ success: true, verified: true, signupToken });
  } catch (err) {
    console.error("otp/check error:", err);
    return res.status(500).json({ success: false, message: "check otp failed" });
  }
});

// =======================
// 3) 忘记密码：发送验证码（只允许已注册手机号）
// POST /api/auth/password/otp  body: { phone }
// =======================
router.post("/password/otp", pwdOtpLimiter, async (req, res) => {
  try {
    const phoneDigits = normDigits(req.body.phone);
    const to = toE164US(req.body.phone);

    if (!phoneDigits || !to) {
      return res.status(400).json({ success: false, message: "手机号不能为空或格式不正确" });
    }

    // ✅ 必须是已注册用户
    const user = await User.findOne({ phone: phoneDigits }).select("_id phone");
    if (!user) {
      return res.status(404).json({ success: false, message: "该手机号未注册" });
    }

    await client.verify.v2
      .services(VERIFY_SID)
      .verifications.create({ to, channel: "sms" });

    return res.json({ success: true, message: "验证码已发送" });
  } catch (e) {
    console.error("password/otp error:", e);
    return res.status(500).json({ success: false, message: "发送失败" });
  }
});

// =======================
// 4) 忘记密码：校验验证码 + 重置密码
// POST /api/auth/password/reset body: { phone, code, newPassword }
// =======================
router.post("/password/reset", pwdResetLimiter, async (req, res) => {
  try {
    const phoneDigits = normDigits(req.body.phone);
    const to = toE164US(req.body.phone);
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!phoneDigits || !to || !code || !newPassword) {
      return res.status(400).json({ success: false, message: "参数不完整" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "新密码至少 6 位" });
    }

    // 1️⃣ 校验短信验证码
    const check = await client.verify.v2
      .services(VERIFY_SID)
      .verificationChecks.create({ to, code });

    if (check.status !== "approved") {
      return res.status(400).json({ success: false, message: "验证码错误或已过期" });
    }

    // 2️⃣ 更新密码（你 User.js 已经做了 updateOne/findOneAndUpdate 自动 hash）
    const user = await User.findOneAndUpdate(
      { phone: phoneDigits },
      { $set: { password: newPassword } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    return res.json({ success: true, message: "密码已重置，请重新登录" });
  } catch (e) {
    console.error("password/reset error:", e);
    return res.status(500).json({ success: false, message: "重置失败" });
  }
});

export default router;
