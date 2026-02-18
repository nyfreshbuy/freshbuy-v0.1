// backend/src/routes/auth_verify_register.js
import express from "express";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import SmsRateLimit from "../models/SmsRateLimit.js";

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

// ✅ 限流配置（稳定版：MongoDB 按天计数 + TTL 自动过期）
const SEND_COOLDOWN_MS = 60 * 1000; // 60秒冷却（跨实例有效：用DB lastSendAt）
const DAILY_MAX_PER_PHONE = 8; // 每个号码每天最多发 8 次（你可改 5/10）

// ✅ 微信防脏手机号：去空白/不可见字符/全角+，统一 E.164
function normUSPhone(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";

  // 全角＋ -> 半角+
  s = s.replace(/＋/g, "+");

  // 去掉所有空白（包含不可见空白）
  s = s.replace(/\s+/g, "");

  // 只保留 + 和数字
  s = s.replace(/[^\d+]/g, "");

  // 如果有多个 +，只保留开头那个
  if (s.includes("+")) {
    s = "+" + s.replace(/\+/g, "");
  }

  // ✅ 如果用户只填了 10 位美国手机号，补 +1
  if (/^\d{10}$/.test(s)) s = "+1" + s;

  // ✅ 如果是 11 位且以 1 开头，也补 +
  if (/^1\d{10}$/.test(s)) s = "+" + s;

  // ✅ E.164 基本校验（Twilio 要这个）
  if (!/^\+[1-9]\d{1,14}$/.test(s)) return "";

  return s;
}

function signToken(user) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET 未设置");
  return jwt.sign(
    { id: String(user._id), role: user.role || "customer", phone: user.phone },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// ✅ 生成 reqId，方便你在 Render 里串联一整次请求
function makeReqId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ✅ 把 Twilio 错误打印得更“可定位”，但不泄露敏感信息
function logTwilioError(tag, reqId, e) {
  const info = {
    reqId,
    tag,
    msg: e?.message,
    name: e?.name,
    code: e?.code, // Twilio/Node error code
    status: e?.status, // HTTP status
    moreInfo: e?.moreInfo, // Twilio more info url
    details: e?.details, // sometimes includes useful hints
  };
  console.error("❌ TWILIO ERROR", info);
  if (e?.stack) console.error("❌ TWILIO STACK", e.stack);
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
  const reqId = makeReqId();

  // ✅ 统一收尾日志：不管成功/失败，都能看到最终 status
  res.on("finish", () => {
    console.log("🧾 VERIFY-REGISTER OUT", { reqId, status: res.statusCode });
  });

  try {
    // ✅ 配置检查（仅打印 tail，不泄露）
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

    // ✅ 读取请求数据（不泄露 password / code 内容）
    const phone = normUSPhone(req.body.phone);
    const code = String(req.body.code ?? "").trim(); // ✅ 始终按字符串（防 0 开头丢失）
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
      dailyMax: DAILY_MAX_PER_PHONE,
      cooldownSec: Math.floor(SEND_COOLDOWN_MS / 1000),
    });

    if (!phone) {
      console.warn("❌ VERIFY-REGISTER REJECT", {
        reqId,
        reason: "手机号不正确",
        phoneRawTail: String(req.body.phone || "").slice(-6),
      });
      return res.status(400).json({ success: false, msg: "手机号不正确", reqId });
    }

    // =====================================================
    // ✅ A) 没有 code：当作“发送验证码”
    // =====================================================
    if (!code) {
      try {
        // =========================
        // ✅ MongoDB 稳定限流：同号 60 秒冷却 + 每日上限
        // =========================
        const now = new Date();

        // 当天 00:00（服务器时区；你在纽约运行通常OK）
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);

        // 次日 00:00（TTL 到点自动清理）
        const expiresAt = new Date(dayStart);
        expiresAt.setDate(expiresAt.getDate() + 1);

        // upsert：拿到当天的计数记录
        const doc = await SmsRateLimit.findOneAndUpdate(
          { phone, dayStart },
          { $setOnInsert: { phone, dayStart, expiresAt, count: 0 } },
          { new: true, upsert: true }
        );

        // ✅ 60 秒冷却（跨实例也有效）
        if (doc.lastSendAt && now - doc.lastSendAt < SEND_COOLDOWN_MS) {
          const left = Math.ceil(
            (SEND_COOLDOWN_MS - (now - doc.lastSendAt)) / 1000
          );
          return res.status(429).json({
            success: false,
            msg: `验证码已发送，请${left}秒后再试`,
            reqId,
          });
        }

        // ✅ 每日次数上限
        if (doc.count >= DAILY_MAX_PER_PHONE) {
          return res.status(429).json({
            success: false,
            msg: "今天验证码请求次数过多，请明天再试或联系客服",
            reqId,
          });
        }

        // ✅ Twilio 发送
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

        // ✅ 发送成功才计数（避免 Twilio 失败也占次数）
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
    // ✅ B) 有 code：当作“校验验证码并注册”
    // =====================================================
    // ✅ 建议收紧为 4-6 位（常见Verify长度），减少异常输入
    if (!/^\d{4,6}$/.test(code)) {
      console.warn("❌ VERIFY-REGISTER REJECT", {
        reqId,
        reason: "验证码格式不正确",
        codeLen: code.length,
      });
      return res.status(400).json({ success: false, msg: "验证码格式不正确", reqId });
    }

    if (!name) {
      console.warn("❌ VERIFY-REGISTER REJECT", {
        reqId,
        reason: "请填写姓名",
      });
      return res.status(400).json({ success: false, msg: "请填写姓名", reqId });
    }

    if (!PW_RE.test(password)) {
      console.warn("❌ VERIFY-REGISTER REJECT", {
        reqId,
        reason: "密码不符合规则",
        passwordLen: password.length,
        rule: ">=8 & contains letter+digit",
      });
      return res.status(400).json({
        success: false,
        msg: "密码至少8位且必须包含字母和数字",
        reqId,
      });
    }

    // ✅ 验证验证码
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

      // ✅ Twilio 20404/404：记录不存在/过期/次数到顶 -> 当成验证码失效
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
      console.warn("❌ VERIFY-REGISTER REJECT", {
        reqId,
        reason: "验证码错误或已过期",
        twilioStatus: check?.status || "unknown",
      });
      return res.status(401).json({
        success: false,
        msg: "验证码错误或已过期",
        status: check?.status || "unknown",
        reqId,
      });
    }

    // 已注册则提示登录
   // ✅ 兼容 DB 里 phone 可能存：+1718... / 1718... / 718...
function buildPhoneCandidates(e164Phone) {
  const p = String(e164Phone || "").trim();
  const digits = p.replace(/[^\d]/g, ""); // 1718...
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits; // 718...
  return Array.from(new Set([p, digits, last10, `1${last10}`, `+1${last10}`]));
}

// 已注册则提示登录（兼容旧数据）
const candidates = buildPhoneCandidates(phone);
const existing = await User.findOne({ phone: { $in: candidates } });

    if (existing) {
      console.warn("❌ VERIFY-REGISTER REJECT", {
        reqId,
        reason: "该手机号已注册",
        phoneTail: String(phone).slice(-4),
      });
      return res.status(409).json({
        success: false,
        msg: "该手机号已注册，请直接登录",
        reqId,
      });
    }

    // ✅ 注册写库
    const hashed = await bcrypt.hash(password, 10);
    const phoneDigits = String(phone).replace(/[^\d]/g, "");

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
    // ✅ Mongo duplicate key 等也打印（很多“偶发失败”其实是并发重复提交）
    const isDup =
      e && (e.code === 11000 || String(e.message || "").includes("E11000"));

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
      msg: isDup ? "该手机号已注册，请直接登录" : "注册/发送验证码失败",
      detail: e?.message || String(e),
      reqId,
    });
  }
});

export default router;
