import express from "express";
import jwt from "jsonwebtoken";
import Driver from "../models/Driver.js";

const router = express.Router();
router.use(express.json());

// =======================
// JWT
// =======================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET 未设置，driver 登录将失败");
}

function signDriverToken(driver) {
  return jwt.sign(
    {
      id: String(driver._id),
      role: "driver",
      phone: driver.phone,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// =======================
// （可选）司机鉴权中间件：Authorization: Bearer xxx
// 你以后 driver/orders 等接口建议用它
// =======================
function requireDriver(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) return next(); // 先不强制：兼容你现在用 driverId 调试的方式

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload?.role !== "driver") {
      return res.status(403).json({ success: false, message: "非司机身份" });
    }
    req.user = { id: payload.id, role: payload.role, phone: payload.phone };
    return next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "token 无效或已过期" });
  }
}

// ===============================
// 0) 司机登录（DB版）
// POST /api/driver/login
// body: { phone, password }
// ===============================
router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body || {};

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "手机号和密码不能为空",
      });
    }

    // 查司机
    const driver = await Driver.findOne({ phone }).lean();
    if (!driver) {
      return res.status(401).json({
        success: false,
        message: "司机不存在",
      });
    }

    // 密码校验（与你现有代码风格一致：明文）
    if (String(driver.password) !== String(password)) {
      return res.status(401).json({
        success: false,
        message: "密码错误",
      });
    }

    // 状态校验（如果你库里有 status 字段）
    if (driver.status && driver.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "司机账号未启用",
      });
    }

    const token = signDriverToken(driver);

    return res.json({
      success: true,
      token,
      driver: {
        id: String(driver._id),
        name: driver.name || "",
        phone: driver.phone,
      },
    });
  } catch (err) {
    console.error("POST /api/driver/login 出错:", err);
    res.status(500).json({
      success: false,
      message: "司机登录失败（DB版）",
    });
  }
});

// ===============================
// 兼容：如果你还没做登录中间件，就先用 query/body 传 driverId 跑通
// （有 token 时，会优先用 req.user）
// ===============================
function getDriverId(req) {
  if (req.user && (req.user.id || req.user._id)) return String(req.user.id || req.user._id);
  if (req.query && req.query.driverId) return String(req.query.driverId);
  if (req.body && req.body.driverId) return String(req.body.driverId);
  return null;
}

// ✅ 对下面接口启用“可选鉴权”：有 token 就解析，没有就继续用 driverId 调试
router.use(requireDriver);

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
        id: String(driver._id),
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
router.patch("/origin", async (req, res) => {
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
