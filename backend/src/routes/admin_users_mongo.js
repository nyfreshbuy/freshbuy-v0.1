// backend/src/routes/admin_users_mongo.js
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import Address from "../models/Address.js"; // ✅ 读取用户默认地址
import Order from "../models/order.js"; // ✅ 新增：用于统计订单数/累计消费（如文件名不同请改这里）

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
    status: u.status || "active",
    isActive:
      u.isActive !== undefined
        ? !!u.isActive
        : u.status
          ? u.status !== "disabled"
          : true,
    // ✅ 账户余额（优先 walletBalance，其次 balance）
    walletBalance: Number(u.walletBalance ?? u.balance ?? 0),

    // ✅ 这两个字段在 GET /api/admin/users 里会补齐（来自订单聚合）
    totalOrders: 0,
    totalSpent: 0,

    // ✅ 地址文本会补齐
    addressText: "",

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
      .select("_id name phone role createdAt status isActive walletBalance balance")
      .lean();

    const users = docs.map(normalizeUser);

    // ✅ 批量统计：订单数 + 累计消费（来自 Order 集合）
    if (users.length) {
      const ids = users.map((u) => new mongoose.Types.ObjectId(String(u._id)));

      // ⚠️ 注意：这里用容错方式取金额字段
      // 如果你订单金额字段明确（比如 totalPayable），你可以直接替换 money 的取值
      const stats = await Order.aggregate([
        { $match: { userId: { $in: ids } } },

        // ✅ 如果你只想统计“已支付”订单，请按你订单字段放开下面的 match（示例）
        // { $match: { paymentStatus: "paid" } },

        {
          $project: {
            userId: 1,
            money: {
              $ifNull: [
                "$totalAmount",
                {
                  $ifNull: [
                    "$totalSpent",
                    {
                      $ifNull: [
                        "$total",
                        {
                          $ifNull: [
                            "$grandTotal",
                            { $ifNull: ["$amount", { $ifNull: ["$payAmount", 0] }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: "$userId",
            totalOrders: { $sum: 1 },
            totalSpent: { $sum: "$money" },
          },
        },
      ]);

      const statMap = {};
      for (const s of stats) {
        statMap[String(s._id)] = {
          totalOrders: Number(s.totalOrders || 0),
          totalSpent: Number(s.totalSpent || 0),
        };
      }

      for (const u of users) {
        const s = statMap[String(u._id)] || { totalOrders: 0, totalSpent: 0 };
        u.totalOrders = s.totalOrders;
        u.totalSpent = Number((s.totalSpent || 0).toFixed(2));
      }
    }

    // ✅ 批量查询默认地址并合并到 users.addressText（更具体）
    if (users.length) {
      const ids = users.map((u) => new mongoose.Types.ObjectId(String(u._id)));

      const addrDocs = await Address.find({ userId: { $in: ids }, isDefault: true })
        .select(
          "userId street line1 line2 address1 address2 apt unit city state zip formattedAddress"
        )
        .lean();

      const addrMap = {};
      for (const a of addrDocs) {
        addrMap[String(a.userId)] = a;
      }

      for (const u of users) {
        const a = addrMap[String(u._id)];
        if (!a) {
          u.addressText = "";
          continue;
        }

        const line =
          a.formattedAddress ||
          [
            a.street || a.line1 || a.address1 || "",
            a.line2 || a.address2 || a.apt || a.unit || "",
            a.city || "",
            a.state || "",
            a.zip || "",
          ]
            .filter(Boolean)
            .join(" ")
            .trim();

        u.addressText = line || "";
      }
    }

    const totalPages = Math.max(Math.ceil(total / pageSize) || 1, 1);

    return res.json({
      success: true,
      ok: true,
      message: "ok",
      total,
      page,
      pageSize,
      totalPages,
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

// ✅ GET /api/admin/users/:id  (获取单个用户)
router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "用户ID不合法" });
    }

    const doc = await User.findById(id)
      .select("_id name phone role createdAt status isActive walletBalance balance")
      .lean();

    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    const user = normalizeUser(doc);

    // ✅ 单用户：订单统计
    try {
      const stats = await Order.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(user._id)) } },
        {
          $project: {
            userId: 1,
            money: {
              $ifNull: [
                "$totalAmount",
                {
                  $ifNull: [
                    "$totalSpent",
                    {
                      $ifNull: [
                        "$total",
                        {
                          $ifNull: [
                            "$grandTotal",
                            { $ifNull: ["$amount", { $ifNull: ["$payAmount", 0] }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: "$userId",
            totalOrders: { $sum: 1 },
            totalSpent: { $sum: "$money" },
          },
        },
      ]);

      if (stats && stats[0]) {
        user.totalOrders = Number(stats[0].totalOrders || 0);
        user.totalSpent = Number((stats[0].totalSpent || 0).toFixed(2));
      }
    } catch (e) {
      // 不影响主流程
    }

    // ✅ 单用户：默认地址
    const addr = await Address.findOne({ userId: user._id, isDefault: true })
      .select("street line1 line2 address1 address2 apt unit city state zip formattedAddress")
      .lean();

    if (addr) {
      const line =
        addr.formattedAddress ||
        [
          addr.street || addr.line1 || addr.address1 || "",
          addr.line2 || addr.address2 || addr.apt || addr.unit || "",
          addr.city || "",
          addr.state || "",
          addr.zip || "",
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

      user.addressText = line || "";
    } else {
      user.addressText = "";
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error("❌ GET /api/admin/users/:id failed:", err);
    return res.status(500).json({ success: false, message: err.message || "获取失败" });
  }
});

// ✅ PATCH /api/admin/users/:id  (编辑用户：姓名/手机号/角色/状态)
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

    const doc = await User.findByIdAndUpdate(id, { $set: update }, { new: true })
      .select("_id name phone role createdAt status isActive walletBalance balance")
      .lean();

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

    const doc = await User.findByIdAndUpdate(id, { $set: { role } }, { new: true })
      .select("_id name phone role createdAt status isActive walletBalance balance")
      .lean();

    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    // ⚠️ 你原来这里写了 res.status(400)，我保留你原逻辑会导致前端认为失败
    // ✅ 修正为 200
    return res.json({ success: true, user: normalizeUser(doc) });
  } catch (err) {
    console.error("❌ PATCH /api/admin/users/:id/role failed:", err);
    return res.status(500).json({ success: false, message: err.message || "更新失败" });
  }
});

// ✅ PATCH /api/admin/users/:id/toggle (启用/禁用 - 可选)
router.patch("/:id/toggle", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const doc = await User.findById(id).select("_id isActive status");
    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

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

// ✅ POST /api/admin/users/:id/reset-password  (重置密码)
router.post("/:id/reset-password", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "用户ID不合法" });
    }

    const newPassword = String(req.body?.newPassword || "").trim();
    const pwd = newPassword.length >= 6 ? newPassword : genTempPassword(10);

    const hash = await bcrypt.hash(pwd, 10);

    const doc = await User.findByIdAndUpdate(id, { $set: { password: hash } }, { new: true }).select(
      "_id"
    );
    if (!doc) return res.status(404).json({ success: false, message: "用户不存在" });

    return res.json({
      success: true,
      message: "密码已重置",
      tempPassword: pwd,
    });
  } catch (err) {
    console.error("❌ POST /api/admin/users/:id/reset-password failed:", err);
    return res.status(500).json({ success: false, message: err.message || "重置密码失败" });
  }
});

// ✅ POST /api/admin/users  (创建用户)
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

    const exists = await User.findOne({ phone }).select("_id");
    if (exists) {
      return res.status(409).json({ success: false, message: "手机号已存在" });
    }

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
      tempPassword: inputPwd ? undefined : plainPwd,
    });
  } catch (err) {
    console.error("❌ POST /api/admin/users failed:", err);
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: "手机号已存在" });
    }
    return res.status(500).json({ success: false, message: err.message || "创建失败" });
  }
});

// ✅ DELETE /api/admin/users/:id  (删除用户)
router.delete("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "用户ID不合法" });
    }

    const user = await User.findById(id).select("_id role");
    if (!user) return res.status(404).json({ success: false, message: "用户不存在" });

    if (user.role === "admin") {
      return res.status(400).json({ success: false, message: "不能删除管理员" });
    }

    await Address.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });

    return res.json({ success: true, message: "用户已删除" });
  } catch (err) {
    console.error("❌ DELETE /api/admin/users/:id failed:", err);
    return res.status(500).json({ success: false, message: err.message || "删除失败" });
  }
});

export default router;
