import express from "express";
import Driver from "../models/Driver.js";

const router = express.Router();

// 兼容：如果你还没做登录中间件，就先用 query/body 传 driverId 跑通
function getDriverId(req) {
  // ✅ 推荐：你如果有 auth 中间件，一般会把用户信息挂到 req.user
  if (req.user && (req.user.id || req.user._id)) return String(req.user.id || req.user._id);

  // 兼容临时调试
  if (req.query && req.query.driverId) return String(req.query.driverId);
  if (req.body && req.body.driverId) return String(req.body.driverId);

  return null;
}

// ===============================
// 1) 获取司机起点（DB版）
// GET /api/driver/origin
// ===============================
router.get("/origin", async (req, res) => {
  try {
    const driverId = getDriverId(req);
    if (!driverId) {
      return res.status(401).json({
        success: false,
        message: "缺少司机身份（请先登录或传 driverId）",
      });
    }

    const driver = await Driver.findById(driverId)
      .select("lastLocation name phone workingState status")
      .lean();

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "司机不存在（DB版）",
      });
    }

    // 用 lastLocation 作为“起点”
    const origin = driver.lastLocation || {
      address: "",
      lat: undefined,
      lng: undefined,
      updatedAt: undefined,
    };

    return res.json({
      success: true,
      origin,
      driver: {
        id: driver._id.toString(),
        name: driver.name,
        phone: driver.phone,
        status: driver.status,
        workingState: driver.workingState,
      },
    });
  } catch (err) {
    console.error("GET /api/driver/origin 出错:", err);
    res.status(500).json({
      success: false,
      message: "获取司机起点失败（DB版）",
    });
  }
});

// ===============================
// 2) 更新司机起点（DB版）
// PATCH /api/driver/origin
// body: { address, lat?, lng? }
// ===============================
router.patch("/origin", express.json(), async (req, res) => {
  try {
    const driverId = getDriverId(req);
    if (!driverId) {
      return res.status(401).json({
        success: false,
        message: "缺少司机身份（请先登录或传 driverId）",
      });
    }

    const { lat, lng, address } = req.body || {};

    if (!address || typeof address !== "string" || !address.trim()) {
      return res.status(400).json({
        success: false,
        message: "address 不能为空",
      });
    }

    const parsedLat = typeof lat === "number" ? lat : lat != null ? Number(lat) : undefined;
    const parsedLng = typeof lng === "number" ? lng : lng != null ? Number(lng) : undefined;

    // 如果传了 lat/lng，但转换失败，就报错
    if (lat != null && Number.isNaN(parsedLat)) {
      return res.status(400).json({ success: false, message: "lat 必须是数字" });
    }
    if (lng != null && Number.isNaN(parsedLng)) {
      return res.status(400).json({ success: false, message: "lng 必须是数字" });
    }

    const patch = {
      lastLocation: {
        address: address.trim(),
        lat: parsedLat,
        lng: parsedLng,
        updatedAt: new Date(),
      },
    };

    const driver = await Driver.findByIdAndUpdate(driverId, patch, { new: true })
      .select("lastLocation")
      .lean();

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "司机不存在（DB版）",
      });
    }

    return res.json({
      success: true,
      origin: driver.lastLocation,
    });
  } catch (err) {
    console.error("PATCH /api/driver/origin 出错:", err);
    res.status(500).json({
      success: false,
      message: "更新司机起点失败（DB版）",
    });
  }
});

export default router;
