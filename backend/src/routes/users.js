// backend/src/routes/users.js
import express from "express";
import bcrypt from "bcryptjs"; // ✅ 用于校验/加密密码
import User from "../models/user.js";
import Address from "../models/Address.js"; // ✅ 关键：从 Address 集合取默认地址
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ users.js LOADED:", import.meta.url);

// ===============================
// Address -> Client normalize
// ===============================
function normalizeAddressForClient(a) {
  if (!a) return null;
  return {
    _id: String(a._id),
    id: String(a._id),

    contactName: `${a.firstName || ""} ${a.lastName || ""}`.trim(),
    contactPhone: a.phone || "",
    addressLine: [a.street1 || "", a.apt || ""].filter(Boolean).join(", "),
    city: a.city || "",
    state: a.state || "",
    zip: a.zip || "",

    placeId: a.placeId || "",
    formattedAddress: a.formattedAddress || "",
    lat: a.lat,
    lng: a.lng,

    isDefault: !!a.isDefault,
    note: a.note || "",
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function getDefaultAddress(userId) {
  let def = await Address.findOne({ userId, isDefault: true }).sort({
    updatedAt: -1,
    createdAt: -1,
  });

  if (!def) {
    def = await Address.findOne({ userId }).sort({
      updatedAt: -1,
      createdAt: -1,
    });
  }

  return def ? normalizeAddressForClient(def) : null;
}

// ===============================
// ✅ 当前用户信息（给前端用）
// GET /api/users/me
// ===============================
router.get("/me", requireLogin, async (req, res) => {
  try {
    // requireLogin 里你用的是 req.user.id
    const u = await User.findById(req.user.id).select(
      "_id name nickname phone role email accountSettings isActive createdAt updatedAt"
    );

    if (!u) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const defaultAddress = await getDefaultAddress(String(u._id));

    return res.json({
      success: true,
      user: {
        _id: String(u._id),
        id: String(u._id),
        role: u.role,
        phone: u.phone,
        name: u.name,
        nickname: u.nickname || "", // ✅ 返回昵称
        email: u.email || "",
        accountSettings: u.accountSettings || {},
        isActive: u.isActive,
        defaultAddress, // ✅ Address 集合默认地址
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      },
    });
  } catch (err) {
    console.error("GET /api/users/me error:", err);
    return res.status(500).json({ success: false, message: "Load user failed" });
  }
});

// ===============================
// ✅ 更新当前用户昵称
// PATCH /api/users/me
// body: { nickname: "xxx" }
// ===============================
router.patch("/me", requireLogin, async (req, res) => {
  try {
    const nickname = String(req.body?.nickname || "").trim();

    if (!nickname) {
      return res.status(400).json({ success: false, message: "nickname 不能为空" });
    }
    if (nickname.length > 24) {
      return res.status(400).json({ success: false, message: "nickname 最多 24 个字符" });
    }

    const u = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { nickname } },
      { new: true }
    ).select("_id name nickname phone role email accountSettings isActive createdAt updatedAt");

    if (!u) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const defaultAddress = await getDefaultAddress(String(u._id));

    return res.json({
      success: true,
      user: {
        _id: String(u._id),
        id: String(u._id),
        role: u.role,
        phone: u.phone,
        name: u.name,
        nickname: u.nickname || "",
        email: u.email || "",
        accountSettings: u.accountSettings || {},
        isActive: u.isActive,
        defaultAddress,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      },
    });
  } catch (err) {
    console.error("PATCH /api/users/me error:", err);
    return res.status(500).json({ success: false, message: "Update nickname failed" });
  }
});

// ===============================
// ✅ 修改密码（已有密码账号）
// POST /api/users/change-password
// body: { oldPassword: "xxx", newPassword: "yyy" }
// ===============================
router.post("/change-password", requireLogin, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    const oldPassword = String(req.body?.oldPassword || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();

    if (!oldPassword) {
      return res.status(400).json({ success: false, message: "缺少当前密码" });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "新密码至少 6 位" });
    }

    // 兼容 schema 里把密码字段设置为 select:false
    const u = await User.findById(userId).select("+password +passwordHash _id");

    if (!u) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const hashed = u.passwordHash || u.password || "";
    if (!hashed) {
      return res.status(400).json({ success: false, message: "该账号未设置密码，无法修改" });
    }

    const ok = await bcrypt.compare(oldPassword, hashed);
    if (!ok) {
      return res.status(400).json({ success: false, message: "当前密码不正确" });
    }

    const newHashed = await bcrypt.hash(newPassword, 10);

    if (u.passwordHash !== undefined) u.passwordHash = newHashed;
    if (u.password !== undefined) u.password = newHashed;

    await u.save();

    return res.json({ success: true, message: "密码已更新" });
  } catch (err) {
    console.error("POST /api/users/change-password error:", err);
    return res.status(500).json({ success: false, message: "修改密码失败" });
  }
});

// ===============================
// ✅ 设置密码（首次设置，仅限无密码账号）
// POST /api/users/set-password
// body: { newPassword: "yyy" }
// ===============================
router.post("/set-password", requireLogin, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "未登录" });

    const newPassword = String(req.body?.newPassword || "").trim();

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "新密码至少 6 位" });
    }

    // 兼容 schema 里把密码字段设置为 select:false
    const u = await User.findById(userId).select("+password +passwordHash _id");

    if (!u) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    // 如果已经有密码，则不允许走“设置密码”
    const existed = u.passwordHash || u.password || "";
    if (existed) {
      return res.status(400).json({
        success: false,
        message: "该账号已设置密码，请使用修改密码",
      });
    }

    const newHashed = await bcrypt.hash(newPassword, 10);

    // 兼容字段名
    if (u.passwordHash !== undefined) u.passwordHash = newHashed;
    if (u.password !== undefined) u.password = newHashed;

    await u.save();

    return res.json({ success: true, message: "密码设置成功" });
  } catch (err) {
    console.error("POST /api/users/set-password error:", err);
    return res.status(500).json({ success: false, message: "设置密码失败" });
  }
});

// ===============================
// ❌ 旧接口弃用
// ===============================
router.get("/me/default-address", requireLogin, (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Deprecated: use GET /api/addresses/my (defaultAddress) instead.",
  });
});

router.put("/me/default-address", requireLogin, (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Deprecated: use POST /api/addresses/default instead.",
  });
});

export default router;
