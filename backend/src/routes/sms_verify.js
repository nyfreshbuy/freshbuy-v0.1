import express from "express";
import twilio from "twilio";

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

// ✅ 美国手机号归一化：917xxxxxxx -> +1917xxxxxxx
function normUSPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(phone).startsWith("+")) return String(phone);
  return "+" + digits;
}

// ✅ 用来确认路由是否挂载成功
router.get("/ping", (req, res) => {
  res.json({
    ok: true,
    name: "sms_verify",
    hasTwilio:
      Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID),
  });
});

/**
 * POST /api/sms/send-code
 * body: { phone }
 */
router.post("/send-code", async (req, res) => {
  try {
    if (!client) {
      return res
        .status(500)
        .json({ success: false, message: "Twilio env 未配置" });
    }

    const phone = normUSPhone(req.body.phone);
    if (!phone || phone.length < 10) {
      return res.status(400).json({ success: false, message: "手机号不正确" });
    }

    const r = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: "sms" });

    return res.json({ success: true, status: r.status }); // pending
  } catch (e) {
    console.error("send-code error:", e?.message || e);
    return res.status(500).json({
      success: false,
      message: "发送失败",
      detail: e?.message || String(e),
    });
  }
});

/**
 * POST /api/sms/check-code
 * body: { phone, code }
 */
router.post("/check-code", async (req, res) => {
  try {
    if (!client) {
      return res
        .status(500)
        .json({ success: false, message: "Twilio env 未配置" });
    }

    const phone = normUSPhone(req.body.phone);
    const code = String(req.body.code || "").trim();

    if (!phone) return res.status(400).json({ success: false, message: "手机号不正确" });
    if (!/^\d{3,10}$/.test(code)) {
      return res.status(400).json({ success: false, message: "验证码格式不正确" });
    }

    const r = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    return res.json({
      success: true,
      status: r.status,
      approved: r.status === "approved",
    });
  } catch (e) {
    console.error("check-code error:", e?.message || e);
    return res.status(500).json({
      success: false,
      message: "校验失败",
      detail: e?.message || String(e),
    });
  }
});

export default router;
