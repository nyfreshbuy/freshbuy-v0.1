// backend/src/routes/admin_users_mongo.js
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
console.log("✅ admin_users_mongo.js 已加载");
const router = express.Router();
router.use(express.json()); // ✅ 关键：支持 PATCH/POST JSON body

// 小工具
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}
function genTempPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// 把 DB User 变成前端更好用的结构（兼容旧字段）
function normalizeUser(u) {
  return {
    _id: u._id?.toString?.() || u._id,
    id: u._id?.toString?.() || u._id, // 兼容旧前端用 id
    name: u.name || "",
    phone: u.phone || "",
    role: u.role || "customer",
    status: u.status || "active", // 如果你没有这个字段也没关系
    isActive: u.isActive !== undefined ? !!u.isActive : (u.status ? u.status !== "disabled" : true), // 兼容
    createdAt: u.createdAt,
  };
}

// ✅ GET /api/admin/users?keyword=&role=&page=&pageSize=
router.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);

    const keyword = String(req.query.keyword || "").trim();
    const role = String(req.query.role || "").trim();

    const filter = {};

    if (role) filter.role = role;

    if (keyword) {
      const re = new RegExp(escapeRegex(keyword), "i");
      filter.$or = [{ name: re }, { phone: re }, { email: re }];

      // 允许直接用 _id 搜
      if (isValidObjectId(keyword)) {
        filter.$or.push({ _id: keyword });
      }
    }

    const total = await User.countDocuments(filter);

    const docs = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select("_id name phone role createdAt status isActive");

    const users = docs.map(normalizeUser);
    const totalPages = Math.max(Math.ceil(total / pageSize) || 1, 1);

    return res.json({
      success: true,
      ok: true,
      message: "ok",
      total,
      page,
      pageSize,
      totalPages,

      // 多字段兼容
      users,
      list: users,
      items: users,
      data: users,
    });
  } catch (err) {
    console.error("❌ GET /api/admin/users failed:", err);
    return res.status(500).json({
      success: false,
      ok: false,
      message: err.message || "获取用户失败",
    });
  }
});
// ✅ 新增：GET /api/admin/users/:id  (获取单个用户)
router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "用户ID不合法" });
    }

    const doc = await User.findById(id).select("_id name phone role createdAt status isActive");
    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    return res.json({ success: true, user: normalizeUser(doc) });
  } catch (err) {
    console.error("❌ GET /api/admin/users/:id failed:", err);
    return res.status(500).json({ success: false, message: err.message || "获取失败" });
  }
});
// ✅✅ 新增：PATCH /api/admin/users/:id  (编辑用户：姓名/手机号/角色/状态)
router.patch("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "用户ID不合法" });
    }

    const body = req.body || {};
    const update = {};

    if (typeof body.name === "string") update.name = body.name.trim();
    if (typeof body.phone === "string") update.phone = body.phone.trim();

    // 角色校验
    if (body.role !== undefined) {
      const role = String(body.role || "").trim();
      const ROLE_ENUM = ["customer", "leader", "driver", "admin"];
      if (!ROLE_ENUM.includes(role)) {
        return res.status(400).json({ success: false, message: "非法角色：" + role });
      }
      update.role = role;
    }

    // 状态：支持 status(active/disabled) 或 isActive(true/false)
    if (body.status !== undefined) {
      const status = String(body.status || "").trim();
      if (!["active", "disabled"].includes(status)) {
        return res.status(400).json({ success: false, message: "非法状态：" + status });
      }
      update.status = status;
      update.isActive = status === "active";
    } else if (body.isActive !== undefined) {
      const isActive = !!body.isActive;
      update.isActive = isActive;
      update.status = isActive ? "active" : "disabled";
    }

    // phone 唯一冲突检测（如果你 phone 是 unique）
    if (update.phone) {
      const conflict = await User.findOne({ phone: update.phone, _id: { $ne: id } }).select("_id");
      if (conflict) {
        return res.status(409).json({ success: false, message: "手机号已被其他用户占用" });
      }
    }

    const doc = await User.findByIdAndUpdate(id, { $set: update }, { new: true }).select(
      "_id name phone role createdAt status isActive"
    );

    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    return res.json({ success: true, user: normalizeUser(doc) });
  } catch (err) {
    console.error("❌ PATCH /api/admin/users/:id failed:", err);
    return res.status(500).json({ success: false, message: err.message || "更新失败" });
  }
});

// ✅ PATCH /api/admin/users/:id/role  (修改角色) ——保留你原来的
router.patch("/:id/role", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const role = String(req.body?.role || "").trim();

    const ROLE_ENUM = ["customer", "leader", "driver", "admin"];
    if (!ROLE_ENUM.includes(role)) {
      return res.status(400).json({ success: false, message: "非法角色：" + role });
    }

    const doc = await User.findByIdAndUpdate(id, { $set: { role } }, { new: true }).select(
      "_id name phone role createdAt status isActive"
    );

    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    return res.json({ success: true, user: normalizeUser(doc) });
  } catch (err) {
    console.error("❌ PATCH /api/admin/users/:id/role failed:", err);
    return res.status(500).json({ success: false, message: err.message || "更新失败" });
  }
});

// ✅ PATCH /api/admin/users/:id/toggle (启用/禁用 - 可选) ——保留并补强同步 status/isActive
router.patch("/:id/toggle", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const doc = await User.findById(id).select("_id isActive status");
    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    // 兼容两种字段：isActive 或 status
    if (doc.isActive !== undefined) {
      doc.isActive = !doc.isActive;
      doc.status = doc.isActive ? "active" : "disabled";
    } else {
      doc.status = doc.status === "disabled" ? "active" : "disabled";
    }

    await doc.save();
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error("❌ PATCH /api/admin/users/:id/toggle failed:", err);
    return res.status(500).json({ success: false, message: err.message || "操作失败" });
  }
});

// ✅✅ 新增：POST /api/admin/users/:id/reset-password  (重置密码)
router.post("/:id/reset-password", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "用户ID不合法" });
    }

    const newPassword = String(req.body?.newPassword || "").trim();
    const pwd = newPassword.length >= 6 ? newPassword : genTempPassword(10);

    const hash = await bcrypt.hash(pwd, 10);

    const doc = await User.findByIdAndUpdate(id, { $set: { password: hash } }, { new: true }).select("_id");
    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    return res.json({
      success: true,
      message: "密码已重置",
      tempPassword: pwd, // ✅ 后台弹窗复制用
    });
  } catch (err) {
    console.error("❌ POST /api/admin/users/:id/reset-password failed:", err);
    return res.status(500).json({ success: false, message: err.message || "重置密码失败" });
  }
});
// ✅✅ 新增：POST /api/admin/users  (创建用户)
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role = String(body.role || "customer").trim();
    const status = String(body.status || "active").trim();

    // 手机号归一化：只保留数字，取后10位（兼容带 1 的情况）
    const digits = String(body.phone || "").replace(/\D/g, "");
    let phone = digits;
    if (phone.length === 11 && phone.startsWith("1")) phone = phone.slice(1);
    if (phone.length >= 10) phone = phone.slice(-10);

    if (!phone || phone.length !== 10) {
      return res.status(400).json({ success: false, message: "手机号格式不正确（需10位）" });
    }

    const ROLE_ENUM = ["customer", "leader", "driver", "admin"];
    if (!ROLE_ENUM.includes(role)) {
      return res.status(400).json({ success: false, message: "非法角色：" + role });
    }

    if (!["active", "disabled"].includes(status)) {
      return res.status(400).json({ success: false, message: "非法状态：" + status });
    }

    // 手机号唯一冲突检测
    const exists = await User.findOne({ phone }).select("_id");
    if (exists) {
      return res.status(409).json({ success: false, message: "手机号已存在" });
    }

    // 密码：可传入，不传则生成并返回给后台
    const inputPwd = typeof body.password === "string" ? body.password.trim() : "";
    const plainPwd = inputPwd.length >= 6 ? inputPwd : genTempPassword(10);
    const hash = await bcrypt.hash(plainPwd, 10);

    const user = await User.create({
      name: name || `用户${phone.slice(-4)}`,
      phone,
      role,
      status,
      isActive: status === "active",
      password: hash,
    });

    return res.json({
      success: true,
      message: "创建成功",
      user: normalizeUser(user),
      // ✅ 管理员没手动填密码时，才回传生成的临时密码
      tempPassword: inputPwd ? undefined : plainPwd,
    });
  } catch (err) {
    console.error("❌ POST /api/admin/users failed:", err);

    // 兼容 Mongo unique index 报错
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: "手机号已存在" });
    }

    return res.status(500).json({ success: false, message: err.message || "创建失败" });
  }
});
export default router;
