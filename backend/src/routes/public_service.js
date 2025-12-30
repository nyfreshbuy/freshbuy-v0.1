// backend/src/routes/public_service.js
import express from "express";

const router = express.Router();

// ===============
// 1) Zip 是否服务：硬判断
// GET /api/public/service/check?zip=11365
// ===============
router.get("/service/check", async (req, res) => {
  try {
    const zipRaw = String(req.query.zip || "").trim();
    const zip = zipRaw.replace(/[^0-9]/g, ""); // 只留数字
    if (zip.length !== 5) {
      return res.status(400).json({ success: false, message: "Zip code 必须是 5 位数字" });
    }

    // ✅ 这里读取你“配送区域 zones”的数据源
    // 你项目里已经有：✅ admin_zones 已挂载到 /api/admin/zones
    // 所以你应该有 Zone Model 或者 zones 的 DB 结构
    //
    // 下面给你一个“兼容写法”：你只要把 getEnabledZones() 换成你项目真实的读取即可。

    const zones = await getEnabledZones(); // TODO: 替换为真实DB读取
    const hit = zones.find((z) => zipInZone(zip, z));

    return res.json({
      success: true,
      supported: !!hit,
      zone: hit ? pickZone(hit) : null,
      zip,
    });
  } catch (e) {
    console.error("GET /api/public/service/check error:", e);
    res.status(500).json({ success: false, message: "server error" });
  }
});

// ===============
// 2) IP 自动识别：软推荐（只提示，不限制）
// GET /api/public/geo
// ===============
router.get("/geo", async (req, res) => {
  try {
    // 你可以用 IPinfo（有免费额度/也可无 token 但更受限）
    // 建议：在 .env 加 IPINFO_TOKEN=xxxx
    const token = process.env.IPINFO_TOKEN || "";
    const url = token ? `https://ipinfo.io/json?token=${token}` : `https://ipinfo.io/json`;

    const r = await fetch(url, { method: "GET" });
    const data = await r.json().catch(() => ({}));

    // IPinfo 常见字段：city/region/country/postal/loc... :contentReference[oaicite:0]{index=0}
    const suggestedZip = (data.postal || "").trim();
    return res.json({
      success: true,
      suggestedZip: suggestedZip || "",
      city: data.city || "",
      region: data.region || "",
      country: data.country || "",
      source: "ipinfo",
    });
  } catch (e) {
    console.error("GET /api/public/geo error:", e);
    res.status(200).json({
      success: true,
      suggestedZip: "",
      city: "",
      region: "",
      country: "",
      source: "ipinfo",
      note: "geo lookup failed",
    });
  }
});

export default router;

// ---------------------
// 你只需要改这一块：从 DB 取 zones
// ---------------------
async function getEnabledZones() {
  // ✅ 方案A：如果你有 Zone Mongoose Model，就用：
  // return await Zone.find({ enabled: true }).lean();

  // ✅ 方案B：先临时写死（你调通后再换 DB）
  return [
    {
      id: "zone_freshmeadows",
      name: "Fresh Meadows",
      enabled: true,
      zipPrefixes: ["11365", "11366"],
      zipRanges: [],
      zips: [],
    },
  ].filter((z) => z.enabled);
}

function zipInZone(zip, zone) {
  const zips = Array.isArray(zone.zips) ? zone.zips : [];
  const prefixes = Array.isArray(zone.zipPrefixes) ? zone.zipPrefixes : [];
  const ranges = Array.isArray(zone.zipRanges) ? zone.zipRanges : [];

  if (zips.includes(zip)) return true;
  if (prefixes.some((p) => zip.startsWith(String(p)))) return true;

  const n = Number(zip);
  if (Number.isFinite(n)) {
    for (const r of ranges) {
      const from = Number(r.from);
      const to = Number(r.to);
      if (Number.isFinite(from) && Number.isFinite(to) && n >= from && n <= to) return true;
    }
  }
  return false;
}

function pickZone(z) {
  return { id: z.id || z._id?.toString?.() || "", name: z.name || "" };
}
