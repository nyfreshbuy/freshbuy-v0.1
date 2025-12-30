// backend/src/routes/zones_check.js
import express from "express";
import Zone from "../models/Zone.js";
import { normZip } from "../utils/zip.js";

const router = express.Router();

function pointInPolygon(lng, lat, polygonCoords) {
  // polygonCoords: [[lng,lat], [lng,lat], ...] (ring)
  let inside = false;
  for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
    const xi = polygonCoords[i][0], yi = polygonCoords[i][1];
    const xj = polygonCoords[j][0], yj = polygonCoords[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

// GET /api/zones/check?zip=11365&lat=40.73&lng=-73.79
router.get("/check", async (req, res) => {
  const zip = normZip(req.query.zip);
  if (!zip) return res.status(400).json({ ok: false, message: "zip 无效" });

  const zone = await Zone.findOne({ zips: zip }).select("name slug zips polygon");
  if (!zone) return res.json({ ok: true, deliverable: false, reason: "zip_not_supported", zip });

  // 先按 zip 命中（方案A）
  let deliverable = true;
  let reason = "zip_match";

  // 如果你已经进入方案B：有 polygon 且前端传了 lat/lng，就精确校验
  const lat = req.query.lat != null ? Number(req.query.lat) : null;
  const lng = req.query.lng != null ? Number(req.query.lng) : null;

  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const hasPolygon = zone.polygon?.type === "Polygon" && Array.isArray(zone.polygon.coordinates);

  if (hasPolygon && hasPoint) {
    const ring = zone.polygon.coordinates?.[0] || [];
    if (ring.length >= 3) {
      const inPoly = pointInPolygon(lng, lat, ring);
      deliverable = inPoly;
      reason = inPoly ? "polygon_match" : "polygon_miss";
    }
  }

  return res.json({
    ok: true,
    deliverable,
    reason,
    zip,
    zone: { name: zone.name, slug: zone.slug },
    used: {
      zipCheck: true,
      polygonCheck: hasPolygon && hasPoint,
    },
  });
});

export default router;
