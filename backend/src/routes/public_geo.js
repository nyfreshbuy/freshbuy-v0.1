// backend/src/routes/public_geo.js
import express from "express";

const router = express.Router();

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || "";
}

// ✅ 你已经验证过的测试接口
router.get("/", (req, res) => {
  res.json({ success: true, message: "public geo router ok" });
});

// ✅ IP → ZIP（ipinfo）
// 访问路径：/api/public/geo/ip-zip
router.get("/geo/ip-zip", async (req, res) => {
  try {
    const ipRaw = getClientIp(req);
    const ip = String(ipRaw || "").trim();

    // 本地开发：::1 / 127.0.0.1 不去查 ipinfo
    if (!ip || ip.includes("127.0.0.1") || ip.includes("::1")) {
      return res.json({ success: true, zip: null, note: "local_dev" });
    }

    const token = process.env.IPINFO_TOKEN;
    if (!token) {
      return res.status(500).json({ success: false, message: "IPINFO_TOKEN 未配置" });
    }

    // Node 18+ (你是 Node 22) 原生支持 fetch ✅ 不要 node-fetch
    const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { method: "GET" });
    const data = await r.json().catch(() => ({}));

    const zip = String(data.postal || "").trim();

    return res.json({
      success: true,
      zip: zip && /^\d{5}$/.test(zip) ? zip : null,
      city: data.city || null,
      region: data.region || null,
      ip: ip, // 调试用：上线可删
    });
  } catch (e) {
    console.error("ip-zip error:", e);
    res.status(500).json({ success: false, message: "geo 查询失败" });
  }
});

export default router;
