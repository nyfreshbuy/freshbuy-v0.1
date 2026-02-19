// backend/src/routes/auth_verify_register.js
import express from "express";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import SmsRateLimit from "../models/SmsRateLimit.js";
import { normalizeUSPhone } from "../utils/phone.js";

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

// 至少 8 位，必须包含字母 + 数字
const PW_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

// ✅ 限流配置
const SEND_COOLDOWN_MS = 60 * 1000; // 60 秒冷却
const DAILY_MAX_PER_PHONE = 8; // 每号每天最多 8 次

function signToken(user) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET 未设置");
  return jwt.sign(
    { id: String(user._id), role: user.role || "customer", phone: user.phone },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function makeReqId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function logTwilioError(tag, reqId, e) {
  const info = {
    reqId,
    tag,
    msg: e?.message,
    name: e?.name,
    code: e?.code,
    status: e?.status,
    moreInfo: e?.moreInfo,
    details: e?.details,
  };
  console.error("❌ TWILIO ERROR", info);
  if (e?.stack) console.error("❌ TWILIO STACK", e.stack);
}

// =====================================================
// ✅ 发送验证码（共用函数）
// =====================================================
async function handleSendCode({ reqId, phone }, res) {
  try {
    const now = new Date();

    // 当天 00:00
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    // 次日 00:00（TTL）
    const expiresAt = new Date(dayStart);
    expiresAt.setDate(expiresAt.getDate() + 1);

    const doc = await SmsRateLimit.findOneAndUpdate(
      { phone, dayStart },
      { $setOnInsert: { phone, dayStart, expiresAt, count: 0 } },
      { new: true, upsert: true }
    );

    // 60 秒冷却
    if (doc.lastSendAt && now - doc.lastSendAt < SEND_COOLDOWN_MS) {
      const left = Math.ceil((SEND_COOLDOWN_MS - (now - doc.lastSendAt)) / 1000);
      return res.status(429).json({
        success: false,
        msg: `验证码已发送，请${left}秒后再试`,
        reqId,
      });
    }

    // 每日次数上限
    if (doc.count >= DAILY_MAX_PER_PHONE) {
      return res.status(429).json({
        success: false,
        msg: "今天验证码请求次数过多，请明天再试或联系客服",
        reqId,
      });
    }

    const r = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: "sms" });

    console.log("✅ TWILIO SEND OK", {
      reqId,
      toTail: String(phone).slice(-4),
      status: r?.status,
      sidTail: r?.sid ? String(r.sid).slice(-6) : "",
      channel: r?.channel,
    });

    await SmsRateLimit.updateOne(
      { phone, dayStart },
      { $inc: { count: 1 }, $set: { lastSendAt: now } }
    );

    return res.json({ success: true, msg: "验证码已发送", reqId });
  } catch (e) {
    logTwilioError("send_verification", reqId, e);
    return res.status(500).json({
      success: false,
      msg: "发送验证码失败",
      detail: e?.message || String(e),
      reqId,
    });
  }
}

// =====================================================
// ✅ POST /api/auth/send-code
// body: { phone }
// =====================================================
router.post("/send-code", async (req, res) => {
  const reqId = makeReqId();

  res.on("finish", () => {
    console.log("🧾 SEND-CODE OUT", { reqId, status: res.statusCode });
  });

  try {
    if (!client || !TWILIO_VERIFY_SERVICE_SID) {
      console.error("❌ SEND-CODE CONFIG MISSING", {
        reqId,
        hasClient: !!client,
        hasServiceSid: !!TWILIO_VERIFY_SERVICE_SID,
        sidTail: (TWILIO_VERIFY_SERVICE_SID || "").slice(-6),
        accTail: (TWILIO_ACCOUNT_SID || "").slice(-6),
        hasAuthToken: !!TWILIO_AUTH_TOKEN,
      });
      return res.status(500).json({ success: false, msg: "Twilio 未配置", reqId });
    }

    const phone = normalizeUSPhone(req.body.phone);

    console.log("🧾 SEND-CODE HIT", {
      reqId,
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
      ua: req.headers["user-agent"] || "",
      contentType: req.headers["content-type"] || "",
      phoneTail: phone ? String(phone).slice(-4) : "",
      hasPhone: !!phone,
      dailyMax: DAILY_MAX_PER_PHONE,
      cooldownSec: Math.floor(SEND_COOLDOWN_MS / 1000),
      verifySidTail: (TWILIO_VERIFY_SERVICE_SID || "").slice(-6),
    });

    if (!phone) {
      return res.status(400).json({
        success: false,
        msg: "手机号格式不正确（仅支持美国手机号：646xxxxxxx 或 +1646xxxxxxx；不要输入 +646...）",
        reqId,
      });
    }

    return handleSendCode({ reqId, phone }, res);
  } catch (e) {
    console.error("❌ SEND-CODE FAIL", {
      reqId,
      msg: e?.message || String(e),
      code: e?.code,
      name: e?.name,
    });
    if (e?.stack) console.error("❌ SEND-CODE STACK", e.stack);

    return res.status(500).json({
      success: false,
      msg: "发送验证码失败",
      detail: e?.message || String(e),
      reqId,
    });
  }
});

// =====================================================
// ✅ POST /api/auth/verify-register
// body: { phone, code, name, password, autoLogin? }
// =====================================================
router.post("/verify-register", async (req, res) => {
  const reqId = makeReqId();

  res.on("finish", () => {
    console.log("🧾 VERIFY-REGISTER OUT", { reqId, status: res.statusCode });
  });

  try {
    if (!client || !TWILIO_VERIFY_SERVICE_SID) {
      console.error("❌ VERIFY-REGISTER CONFIG MISSING", {
        reqId,
        hasClient: !!client,
        hasServiceSid: !!TWILIO_VERIFY_SERVICE_SID,
        sidTail: (TWILIO_VERIFY_SERVICE_SID || "").slice(-6),
        accTail: (TWILIO_ACCOUNT_SID || "").slice(-6),
        hasAuthToken: !!TWILIO_AUTH_TOKEN,
      });
      return res.status(500).json({ success: false, msg: "Twilio 未配置", reqId });
    }

    const phone = normalizeUSPhone(req.body.phone);
    const code = String(req.body.code ?? "").trim();
    const name = String(req.body.name ?? "").trim();
    const password = String(req.body.password ?? "");
    const autoLogin = req.body.autoLogin === true || req.body.autoLogin === "true";

    console.log("🧾 VERIFY-REGISTER HIT", {
      reqId,
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
      ua: req.headers["user-agent"] || "",
      contentType: req.headers["content-type"] || "",
      phoneTail: phone ? String(phone).slice(-4) : "",
      hasPhone: !!phone,
      hasCode: !!code,
      codeLen: code ? code.length : 0,
      hasName: !!name,
      passwordLen: password ? password.length : 0,
      autoLogin,
      verifySidTail: (TWILIO_VERIFY_SERVICE_SID || "").slice(-6),
    });

    if (!phone) {
      return res.status(400).json({
        success: false,
        msg: "手机号格式不正确（仅支持美国手机号：646xxxxxxx 或 +1646xxxxxxx；不要输入 +646...）",
        reqId,
      });
    }

    // ✅ 没有 code 直接拒绝（避免误调用造成重复发短信）
    if (!code) {
      return res.status(400).json({
        success: false,
        msg: "缺少验证码，请先点击“获取验证码”",
        reqId,
      });
    }

    if (!/^\d{4,6}$/.test(code)) {
      return res.status(400).json({ success: false, msg: "验证码格式不正确", reqId });
    }

    if (!name) {
      return res.status(400).json({ success: false, msg: "请填写姓名", reqId });
    }

    if (!PW_RE.test(password)) {
      return res.status(400).json({
        success: false,
        msg: "密码至少8位且必须包含字母和数字",
        reqId,
      });
    }

    // ✅ 校验验证码
    let check = null;
    try {
      check = await client.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: phone, code });

      console.log("✅ TWILIO CHECK RETURN", {
        reqId,
        toTail: String(phone).slice(-4),
        status: check?.status || "unknown",
        sidTail: check?.sid ? String(check.sid).slice(-6) : "",
      });
    } catch (e) {
      logTwilioError("check_verification", reqId, e);

      if (e?.status === 404 && e?.code === 20404) {
        return res.status(401).json({
          success: false,
          msg: "验证码已失效，请重新获取",
          reqId,
        });
      }

      return res.status(500).json({
        success: false,
        msg: "验证码校验失败（Twilio）",
        detail: e?.message || String(e),
        reqId,
      });
    }

    if (check?.status !== "approved") {
      return res.status(401).json({
        success: false,
        msg: "验证码错误或已过期",
        status: check?.status || "unknown",
        reqId,
      });
    }

    // ✅ 兼容旧数据（DB里可能存了各种格式）
    function buildPhoneCandidates(e164Phone) {
      const p = String(e164Phone || "").trim();
      const digits = p.replace(/[^\d]/g, ""); // 1xxxxxxxxxx
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
      return Array.from(new Set([p, digits, last10, `1${last10}`, `+1${last10}`]));
    }

    const candidates = buildPhoneCandidates(phone);
    const existing = await User.findOne({ phone: { $in: candidates } });

    if (existing) {
      return res.status(409).json({
        success: false,
        msg: "该手机号已注册，请直接登录",
        reqId,
      });
    }

    // ✅ 注册写库
    const hashed = await bcrypt.hash(password, 10);
    const phoneDigits = String(phone).replace(/[^\d]/g, ""); // 存成纯数字

    const user = await User.create({
      phone: phoneDigits,
      name,
      password: hashed,
      role: "customer",
    });

    const token = autoLogin ? signToken(user) : null;

    console.log("✅ VERIFY-REGISTER OK", {
      reqId,
      userId: String(user._id),
      phoneTail: String(phone).slice(-4),
      autoLogin,
    });

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
      reqId,
    });
  } catch (e) {
    const isDup = e && (e.code === 11000 || String(e.message || "").includes("E11000"));

    console.error("❌ VERIFY-REGISTER FAIL", {
      reqId,
      msg: e?.message || String(e),
      code: e?.code,
      name: e?.name,
      isDup,
    });
    if (e?.stack) console.error("❌ VERIFY-REGISTER STACK", e.stack);

    return res.status(isDup ? 409 : 500).json({
      success: false,
      msg: isDup ? "该手机号已注册，请直接登录" : "注册失败",
      detail: e?.message || String(e),
      reqId,
    });
  }
});

export default router;
