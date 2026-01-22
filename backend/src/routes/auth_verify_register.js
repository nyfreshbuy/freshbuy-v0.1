import express from "express";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
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

const PW_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

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
 * 注册：POST /api/auth/verify-register
 * body: { phone, code, name, password, autoLogin? }
 */
router.post("/verify-register", async (req, res) => {
  try {
    if (!client) return res.status(500).json({ success: false, message: "Twilio 未配置" });
    console.log("TWILIO_ACCOUNT_SID tail:", (process.env.TWILIO_ACCOUNT_SID || "").slice(-6));
console.log("TWILIO_VERIFY_SERVICE_SID tail:", (process.env.TWILIO_VERIFY_SERVICE_SID || "").slice(-6));
console.log("HAS TWILIO AUTH TOKEN?", !!process.env.TWILIO_AUTH_TOKEN);
    const phone = normUSPhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");

    if (!phone) return res.status(400).json({ success: false, message: "手机号不正确" });
    if (!/^\d{3,10}$/.test(code)) return res.status(400).json({ success: false, message: "验证码格式不正确" });
    if (!name) return res.status(400).json({ success: false, message: "请填写姓名" });
    if (!PW_RE.test(password)) {
      return res.status(400).json({ success: false, message: "密码至少8位且必须包含字母和数字" });
    }

    // 验码
    const check = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    if (check.status !== "approved") {
      return res.status(401).json({ success: false, message: "验证码错误或已过期", status: check.status });
    }

    // 已注册则提示登录
    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(409).json({ success: false, message: "该手机号已注册，请直接登录" });
    }

    // 创建用户（满足你模型 required：name/password）
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      phone,
      name,
      password: hashed,
      role: "customer",
    });

    const autoLogin = req.body.autoLogin === true || req.body.autoLogin === "true";
    const token = autoLogin ? signToken(user) : null;

    return res.json({
      success: true,
      message: "注册成功",
      token,
      user: { id: String(user._id), phone: user.phone, role: user.role, name: user.name },
    });
  } catch (e) {
    console.error("verify-register error:", e?.message || e);
    return res.status(500).json({ success: false, message: "注册失败", detail: e?.message || String(e) });
  }
});

export default router;
