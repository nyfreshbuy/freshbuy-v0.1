// backend/src/routes/auth_verify_register.js
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

// 至少 8 位，必须包含字母 + 数字（你原来的规则）
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
 * ✅ 一体化接口（兼容前端）
 *
 * POST /api/auth/verify-register
 *
 * A) 发送验证码（前端点击“获取验证码”时只传 phone）
 * body: { phone }
 *
 * B) 校验验证码并注册（你原有逻辑）
 * body: { phone, code, name, password, autoLogin? }
 */
router.post("/verify-register", async (req, res) => {
  try {
    if (!client || !TWILIO_VERIFY_SERVICE_SID) {
      return res.status(500).json({ success: false, msg: "Twilio 未配置" });
    }

    // ✅ 只打印后 6 位，不泄露敏感信息
    console.log(
      "TWILIO_ACCOUNT_SID tail:",
      (process.env.TWILIO_ACCOUNT_SID || "").slice(-6)
    );
    console.log(
      "TWILIO_VERIFY_SERVICE_SID tail:",
      (process.env.TWILIO_VERIFY_SERVICE_SID || "").slice(-6)
    );
    console.log("HAS TWILIO AUTH TOKEN?", !!process.env.TWILIO_AUTH_TOKEN);
    console.log(
      "VERIFY SID raw:",
      JSON.stringify(process.env.TWILIO_VERIFY_SERVICE_SID || "")
    );

    const phone = normUSPhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");

    if (!phone) {
      return res.status(400).json({ success: false, msg: "手机号不正确" });
    }

    // =====================================================
    // ✅ A) 没有 code：当作“发送验证码”
    // =====================================================
    if (!code) {
      // 可选：如果手机号已注册，你可以提示“已注册请登录”
      // const exists = await User.findOne({ phone });
      // if (exists) return res.status(409).json({ success:false, msg:"该手机号已注册，请直接登录" });

      await client.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({ to: phone, channel: "sms" });

      return res.json({ success: true, msg: "验证码已发送" });
    }

    // =====================================================
    // ✅ B) 有 code：当作“校验验证码并注册”
    // =====================================================
    if (!/^\d{3,10}$/.test(code)) {
      return res.status(400).json({ success: false, msg: "验证码格式不正确" });
    }
    if (!name) {
      return res.status(400).json({ success: false, msg: "请填写姓名" });
    }
    if (!PW_RE.test(password)) {
      return res.status(400).json({ success: false, msg: "密码至少8位且必须包含字母和数字" });
    }

    // ✅ 验证验证码（重点：明确使用 verificationChecks 复数）
    const check = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    if (check?.status !== "approved") {
      return res.status(401).json({
        success: false,
        msg: "验证码错误或已过期",
        status: check?.status || "unknown",
      });
    }

    // 已注册则提示登录
    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(409).json({ success: false, msg: "该手机号已注册，请直接登录" });
    }

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
      msg: "注册成功",
      token,
      user: {
        id: String(user._id),
        phone: user.phone,
        role: user.role,
        name: user.name,
      },
    });
  } catch (e) {
    console.error("verify-register error:", e?.message || e);
    return res.status(500).json({
      success: false,
      msg: "注册/发送验证码失败",
      detail: e?.message || String(e),
    });
  }
});

export default router;
