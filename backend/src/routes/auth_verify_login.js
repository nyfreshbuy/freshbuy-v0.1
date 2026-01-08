import bcrypt from "bcryptjs"; // 文件顶部加
import express from "express";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import User from "../models/user.js";

const router = express.Router();
router.use(express.json());

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID,
  JWT_SECRET,
} = process.env;

const client =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

function normUSPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(phone).startsWith("+")) return String(phone);
  return "+" + digits;
}

function signToken(user) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET 未设置");
  return jwt.sign(
    { id: String(user._id), role: user.role || "customer", phone: user.phone },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * POST /api/auth/verify-login
 * body: { phone, code }
 */
router.post("/verify-login", async (req, res) => {
  try {
    console.log("✅ verify-login running: verificationChecks v1");

    if (!client) {
      return res.status(500).json({
        success: false,
        build: "verify-login@checks_v1",
        message: "Twilio 未配置",
      });
    }

    const phone = normUSPhone(req.body.phone);
    const code = String(req.body.code || "").trim();

    if (!phone) {
      return res.status(400).json({
        success: false,
        build: "verify-login@checks_v1",
        message: "手机号不正确",
      });
    }
    if (!/^\d{3,10}$/.test(code)) {
      return res.status(400).json({
        success: false,
        build: "verify-login@checks_v1",
        message: "验证码格式不正确",
      });
    }

    // ✅ Twilio Verify 校验（注意：verificationChecks 有 s）
    const check = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    if (check.status !== "approved") {
      return res.status(401).json({
        success: false,
        build: "verify-login@checks_v1",
        message: "验证码错误或已过期",
        status: check.status,
      });
    }

    // ✅ 查/建用户（默认 customer）
    let user = await User.findOne({ phone });
// ...

if (!user) {
  const tempPassword = Math.random().toString(36).slice(2, 10) + Date.now().toString().slice(-4);
  const hashed = await bcrypt.hash(tempPassword, 10);

  user = await User.create({
    phone,
    role: "customer",
    name: "用户" + phone.slice(-4),   // 或者 "Freshbuy用户xxxx"
    password: hashed,               // 给必填 password 一个 hash
  });
}
    const token = signToken(user);

    return res.json({
      success: true,
      build: "verify-login@checks_v1",
      token,
      user: { id: String(user._id), phone: user.phone, role: user.role },
    });
  } catch (e) {
    console.error("verify-login error:", e?.message || e);
    return res.status(500).json({
      success: false,
      build: "verify-login@checks_v1",
      message: "登录失败",
      detail: e?.message || String(e),
    });
  }
});

export default router;
