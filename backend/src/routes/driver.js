import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/user.js"; // ⚠️ 如果你文件名是 User.js 就改成 ../models/User.js
const router = express.Router();
router.use(express.json());

// =======================
// JWT
// =======================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET 未设置，driver 登录将失败");
}

function signDriverToken(user) {
  return jwt.sign(
    {
      id: String(user._id),
      role: "driver",
      phone: user.phone,
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

  if (!token) {
    return res.status(401).json({ success: false, message: "未登录" });
  }

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
    const phoneStr = String(phone || "").trim().replace(/[^\d]/g, "");

    if (!phoneStr || !password) {
      return res.status(400).json({ success: false, message: "手机号和密码不能为空" });
    }

    // ✅ 司机账号在 users：role=driver
    // ⚠️ 如果你的 User schema password 是 select:false，需要 +password
    const user = await User.findOne({ phone: phoneStr, role: "driver" })
      .select("+password name phone role isActive driverProfile")
      .lean();

    if (!user) {
      return res.status(401).json({ success: false, message: "司机不存在" });
    }

    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: "司机账号已禁用" });
    }

    const ok = await bcrypt.compare(String(password), String(user.password || ""));
    if (!ok) {
      return res.status(401).json({ success: false, message: "密码错误" });
    }

    const token = signDriverToken(user);

    return res.json({
      success: true,
      token,
      driver: {
        id: String(user._id),
        name: user.name || "",
        phone: user.phone || phoneStr,
        // 下面这些如果你 user 里有 driverProfile 就返回
        driverProfile: user.driverProfile || null,
      },
    });
  } catch (err) {
    console.error("POST /api/driver/login 出错:", err);
    return res.status(500).json({ success: false, message: "司机登录失败" });
  }
});
router.use(requireDriver);
function getDriverId(req) {
  return req.user?.id ? String(req.user.id) : null;
}
router.get("/origin", async (req, res) => {
  try {
    const driverId = getDriverId(req);
    if (!driverId) {
      return res.status(401).json({ success: false, message: "缺少司机身份（请先登录或传 driverId）" });
    }

    const user = await User.findById(driverId)
      .select("driverProfile phone name role")
      .lean();

    if (!user || user.role !== "driver") {
      return res.status(404).json({ success: false, message: "司机不存在（users）" });
    }

    return res.json({
      success: true,
      origin: user.driverProfile?.lastLocation || null,
      driver: {
        id: String(user._id),
        name: user.name || "",
        phone: user.phone || "",
      },
    });
  } catch (err) {
    console.error("GET /api/driver/origin 出错:", err);
    return res.status(500).json({ success: false, message: "获取司机起点失败（users）" });
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
      return res.status(401).json({ success: false, message: "缺少司机身份（请先登录或传 driverId）" });
    }

    const { lat, lng, address } = req.body || {};
    if (!address || typeof address !== "string" || !address.trim()) {
      return res.status(400).json({ success: false, message: "address 不能为空" });
    }

    const parsedLat = lat != null ? Number(lat) : undefined;
    const parsedLng = lng != null ? Number(lng) : undefined;

    if (lat != null && Number.isNaN(parsedLat)) {
      return res.status(400).json({ success: false, message: "lat 必须是数字" });
    }
    if (lng != null && Number.isNaN(parsedLng)) {
      return res.status(400).json({ success: false, message: "lng 必须是数字" });
    }

    const patch = {
      "driverProfile.lastLocation": {
        address: address.trim(),
        lat: parsedLat,
        lng: parsedLng,
        updatedAt: new Date(),
      },
    };

    const user = await User.findByIdAndUpdate(driverId, { $set: patch }, { new: true })
      .select("driverProfile phone name role")
      .lean();

    if (!user || user.role !== "driver") {
      return res.status(404).json({ success: false, message: "司机不存在（users）" });
    }

    return res.json({
      success: true,
      origin: user.driverProfile?.lastLocation || null,
    });
  } catch (err) {
    console.error("PATCH /api/driver/origin 出错:", err);
    return res.status(500).json({ success: false, message: "更新司机起点失败（users）" });
  }
});
export default router;
