import express from "express";
import twilio from "twilio";
import bcrypt from "bcryptjs";
import User from "../models/user.js";

const router = express.Router();
router.use(express.json());

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID,
} = process.env;

const client =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

const PW_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

function normUSPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(phone).startsWith("+")) return String(phone);
  return "+" + digits;
}

/**
 * 忘记密码：POST /api/auth/verify-reset-password
 * body: { phone, code, newPassword }
 */
router.post("/verify-reset-password", async (req, res) => {
  try {
    if (!client) return res.status(500).json({ success: false, message: "Twilio 未配置" });

    const phone = normUSPhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!phone) return res.status(400).json({ success: false, message: "手机号不正确" });
    if (!/^\d{3,10}$/.test(code)) return res.status(400).json({ success: false, message: "验证码格式不正确" });
    if (!PW_RE.test(newPassword)) {
      return res.status(400).json({ success: false, message: "新密码至少8位且必须包含字母和数字" });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ success: false, message: "该手机号未注册" });
    }

    // 验码
    const check = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    if (check.status !== "approved") {
      return res.status(401).json({ success: false, message: "验证码错误或已过期", status: check.status });
    }

    // 更新密码
    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    return res.json({ success: true, message: "密码已更新，请使用新密码登录" });
  } catch (e) {
    console.error("verify-reset-password error:", e?.message || e);
    return res.status(500).json({ success: false, message: "重置失败", detail: e?.message || String(e) });
  }
});

export default router;
