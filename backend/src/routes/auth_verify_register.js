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
    const code = String(req.body.code || "").trim();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
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
    if (!/^\d{3,10}$/.test(code)) {
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
    const existing = await User.findOne({ phone });
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
    const user = await User.create({
      phone,
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
