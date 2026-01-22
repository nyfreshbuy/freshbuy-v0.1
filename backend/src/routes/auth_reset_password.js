// backend/src/routes/auth_reset_password.js
import express from "express";
import bcrypt from "bcryptjs";
import twilio from "twilio";
import User from "../models/user.js";

const router = express.Router();
router.use(express.json());

console.log("🔐 auth_reset_password.js loaded");

// Twilio Verify 参数
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || "";

const tw =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// ✅ 统一把手机号转成 Twilio 需要的 E.164（美国）
function normalizeToE164US(input) {
  let p = String(input || "").trim();
  p = p.replace(/[^\d+]/g, "");

  if (p.startsWith("+")) return p;
  if (/^\d{10}$/.test(p)) return `+1${p}`;
  if (/^1\d{10}$/.test(p)) return `+${p}`;

  return p;
}

// ✅ POST /api/auth/reset-password
// body: { phone, code, newPassword }
router.post("/reset-password", async (req, res) => {
  try {
    const phone = normalizeToE164US(req.body?.phone);
    const code = String(req.body?.code || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();

    if (!phone) return res.status(400).json({ success: false, message: "缺少手机号" });
    if (!code) return res.status(400).json({ success: false, message: "缺少验证码" });
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "新密码至少 6 位" });
    }
    if (!phone.startsWith("+")) {
      return res
        .status(400)
        .json({ success: false, message: "手机号格式错误，请输入美国手机号（10位或+1开头）" });
    }

    // 1) 校验验证码
    if (!tw || !TWILIO_VERIFY_SERVICE_SID) {
      return res.status(500).json({
        success: false,
        message: "短信服务未配置（TWILIO_VERIFY_SERVICE_SID 缺失）",
      });
    }

    const check = await tw.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    if (!check || check.status !== "approved") {
      return res.status(400).json({ success: false, message: "验证码不正确或已过期" });
    }

    // 2) 找用户（兼容 DB 里 phone 可能不带 +1）
    const digits = phone.replace(/[^\d]/g, ""); // 17184195531
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits; // 7184195531
    const candidates = Array.from(new Set([phone, digits, last10, `1${last10}`, `+1${last10}`]));

    const u = await User.findOne({ phone: { $in: candidates } }).select(
      "+password +passwordHash _id phone"
    );

    if (!u) {
      return res.status(404).json({ success: false, message: "该手机号未注册" });
    }

    // 3) 写新密码
    const hashed = await bcrypt.hash(newPassword, 10);

    if (u.passwordHash !== undefined) u.passwordHash = hashed;
    if (u.password !== undefined) u.password = hashed;

    await u.save();

    return res.json({ success: true, message: "密码已重置" });
  } catch (err) {
    console.error("POST /api/auth/reset-password error:", err);
    return res.status(500).json({ success: false, message: "重置失败，请稍后再试" });
  }
});

export default router;
