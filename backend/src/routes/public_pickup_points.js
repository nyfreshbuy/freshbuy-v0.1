import express from "express";
import PickupPoint from "../models/PickupPoint.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const zip = String(req.query.zip || "").trim();

    const query = { enabled: true };
    if (zip) {
      query.$or = [{ serviceZips: zip }, { zip }];
    }

    const rows = await PickupPoint.find(query)
      .sort({ displayArea: 1, name: 1, createdAt: -1 })
      .lean();

    const items = rows.map((it) => ({
      _id: String(it._id),
      name: it.name || "",
      code: it.code || "",
      leaderName: it.leaderName || "",
      displayArea: it.displayArea || "",
      nearStreet: it.nearStreet || "",
      maskedAddress: it.maskedAddress || "",
      pickupTimeText: it.pickupTimeText || "",
      minOrderAmount: Number(it.minOrderAmount || 0),
      pickupFee: Number(it.pickupFee || 0),
      lat: typeof it.lat === "number" ? it.lat : null,
      lng: typeof it.lng === "number" ? it.lng : null
    }));

    res.json({ ok: true, items });
  } catch (err) {
    console.error("public pickup points error:", err);
    res.status(500).json({ ok: false, message: "获取自提点失败" });
  }
});

export default router;