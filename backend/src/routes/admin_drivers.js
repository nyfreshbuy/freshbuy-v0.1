// backend/src/routes/admin_drivers.js
import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";

const router = express.Router();

console.log("🚀 admin_drivers.js (MongoDB版) 已加载");

// ===================================================
// 工具：生成随机密码
// ===================================================
function genTempPassword(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < len; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}

// ===================================================
// GET /api/admin/drivers
// 司机列表 + 搜索 + 筛选
// ===================================================
router.get("/drivers", async (req, res) => {
  try {
    const { q = "", status, zone } = req.query;

    const filter = { role: "driver" };

    if (q) {
      filter.$or = [
        { name: new RegExp(q, "i") },
        { phone: new RegExp(q, "i") },
        { "driverProfile.plate": new RegExp(q, "i") },
      ];
    }

    if (status) {
      filter["driverProfile.status"] = status;
    }

    if (zone) {
      filter["driverProfile.zone"] = zone;
    }

    const docs = await User.find(filter).sort({ createdAt: -1 });

    const drivers = docs.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      phone: u.phone,
      carType: u.driverProfile?.carType || "",
      plate: u.driverProfile?.plate || "",
      zone: u.driverProfile?.zone || "",
      status: u.driverProfile?.status || "offline",
      todayOrders: u.driverProfile?.todayOrders || 0,
      totalOrders: u.driverProfile?.totalOrders || 0,
      rating: u.driverProfile?.rating || 0,
      joinedAt: u.createdAt,
    }));

    res.json({ success: true, drivers });
  } catch (err) {
    console.error("GET /drivers 出错:", err);
    res.status(500).json({ success: false, message: "获取司机列表失败" });
  }
});

// ===================================================
// GET /api/admin/drivers/:id
// 司机详情
// ===================================================
router.get("/drivers/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ 核心修复：非法 ObjectId 直接返回，不让 Mongoose 抛异常
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ success: false, message: "司机不存在" });
    }

    const u = await User.findById(id);
    if (!u || u.role !== "driver") {
      return res.json({ success: false, message: "司机不存在" });
    }

    return res.json({
      success: true,
      driver: {
        id: u._id.toString(),
        name: u.name,
        phone: u.phone,
        carType: u.driverProfile?.carType || "",
        plate: u.driverProfile?.plate || "",
        zone: u.driverProfile?.zone || "",
        status: u.driverProfile?.status || "offline",
      },
    });
  } catch (err) {
    console.error("GET /api/admin/drivers/:id 出错:", err);
    return res.status(500).json({ success: false, message: "获取司机详情失败" });
  }
});
// ===================================================
// POST /api/admin/drivers
// 新增司机
// ===================================================
router.post("/drivers", express.json(), async (req, res) => {
  try {
    const { name, phone, carType, plate, zone, status } = req.body;

    if (!name || !phone) {
      return res.json({ success: false, message: "姓名和手机号不能为空" });
    }

    const exists = await User.findOne({ phone });
    if (exists) {
      return res.json({ success: false, message: "手机号已存在" });
    }

    const tempPassword = genTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    const user = await User.create({
      name,
      phone,
      password: hash,
      role: "driver",
      driverProfile: {
        carType: carType || "",
        plate: plate || "",
        zone: zone || "",
        status: status || "offline",
      },
    });

    res.json({
      success: true,
      driverId: user._id.toString(),
      tempPassword,
    });
  } catch (err) {
    console.error("POST /drivers 出错:", err);
    res.status(500).json({ success: false, message: "新增司机失败" });
  }
});

// ===================================================
// PATCH /api/admin/drivers/:id
// 编辑司机
// ===================================================
router.patch("/drivers/:id", express.json(), async (req, res) => {
  try {
    const { name, phone, carType, plate, zone, status } = req.body;

    const u = await User.findById(req.params.id);
    if (!u || u.role !== "driver") {
      return res.json({ success: false, message: "司机不存在" });
    }

    if (name) u.name = name;
    if (phone) u.phone = phone;

    u.driverProfile = {
      ...u.driverProfile,
      carType: carType ?? u.driverProfile.carType,
      plate: plate ?? u.driverProfile.plate,
      zone: zone ?? u.driverProfile.zone,
      status: status ?? u.driverProfile.status,
    };

    await u.save();
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /drivers/:id 出错:", err);
    res.status(500).json({ success: false, message: "保存失败" });
  }
});

// ===================================================
// POST /api/admin/drivers/:id/reset-password
// 重置司机密码
// ===================================================
router.post("/drivers/:id/reset-password", async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u || u.role !== "driver") {
      return res.json({ success: false, message: "司机不存在" });
    }

    const tempPassword = genTempPassword();
    u.password = await bcrypt.hash(tempPassword, 10);
    await u.save();

    res.json({ success: true, tempPassword });
  } catch (err) {
    console.error("reset-password 出错:", err);
    res.status(500).json({ success: false, message: "重置失败" });
  }
});

// ===================================================
// GET /api/admin/driver-stats
// 司机统计
// ===================================================
router.get("/driver-stats", async (req, res) => {
  try {
    const total = await User.countDocuments({ role: "driver" });
    const online = await User.countDocuments({
      role: "driver",
      "driverProfile.status": "online",
    });

    res.json({
      success: true,
      stats: {
        totalDrivers: total,
        onlineDrivers: online,
        todayOrders: 0,
        doneOrders: 0,
        abnormalOrders: 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "统计失败" });
  }
});
// ===================================================
// DELETE /api/admin/drivers/:id
// 删除司机
// ===================================================
router.delete("/drivers/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 防止非法 ObjectId
    if (!id || id.length !== 24) {
      return res.json({ success: false, message: "司机不存在" });
    }

    const u = await User.findById(id);
    if (!u || u.role !== "driver") {
      return res.json({ success: false, message: "司机不存在" });
    }

    await User.deleteOne({ _id: id });

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/admin/drivers/:id 出错:", err);
    res.status(500).json({ success: false, message: "删除司机失败" });
  }
});
export default router;
