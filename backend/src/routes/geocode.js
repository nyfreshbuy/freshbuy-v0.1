// backend/src/routes/geocode.js
import express from "express";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ success: false, message: "q 不能为空" });

    const key = process.env.GOOGLE_MAPS_SERVER_KEY;
    if (!key) {
      return res.status(500).json({
        success: false,
        message: "缺少 GOOGLE_MAPS_SERVER_KEY（请在 .env 配置）",
      });
    }

    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(q) +
      "&key=" +
      encodeURIComponent(key);

    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({ success: false, message: "Google Geocode 请求失败" });
    }

    if (data.status !== "OK" || !data.results?.[0]) {
      return res.status(400).json({
        success: false,
        message: "地址无法解析，请检查地址是否正确",
        status: data.status,
      });
    }

    const first = data.results[0];
    const loc = first.geometry?.location;

    return res.json({
      success: true,
      fullText: first.formatted_address || q,
      lat: Number(loc?.lat),
      lng: Number(loc?.lng),
    });
  } catch (e) {
    console.error("GET /api/geocode error:", e);
    return res.status(500).json({ success: false, message: "geocode 失败" });
  }
});

export default router;
