// backend/src/routes/user_me.js
import express from "express";
import User from "../models/user.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("✅ user_me.js 已加载");

/**
 * ✅ GET /api/user/me
 * 返回完整用户信息（含 defaultAddress：至少 zip）
 * 目的：前端锁定 ZIP，避免用户输入 ZIP 与默认地址 ZIP 不一致
 */
router.get("/me", requireLogin, async (req, res) => {
  try {
    const uid = req?.user?.id || req?.user?._id || req?.userId || null;
    if (!uid) {
      return res.status(401).json({ success: false, message: "未登录" });
    }

    const user = await User.findById(uid).select("-password").lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    // ✅ 拼默认地址（兼容三种常见存法）
    let defaultAddress = user.defaultAddress || null;

    // addresses[] + defaultAddressId
    if (!defaultAddress && Array.isArray(user.addresses) && user.defaultAddressId) {
      defaultAddress =
        user.addresses.find((a) => String(a?._id) === String(user.defaultAddressId)) || null;
    }

    // addresses[] + isDefault
    if (!defaultAddress && Array.isArray(user.addresses)) {
      defaultAddress = user.addresses.find((a) => a?.isDefault === true) || null;
    }

    // ✅ 只回安全字段（你需要哪些再加）
    return res.json({
      success: true,
      user: {
        _id: user._id,
        id: String(user._id),
        role: user.role || "customer",
        phone: user.phone || "",
        name: user.name || "",
        email: user.email || "",

        // 你的前端只需要 zip，但这里带上常用字段，方便你后续用户中心复用
        defaultAddress: defaultAddress
          ? {
              _id: defaultAddress._id,
              label: defaultAddress.label || "",
              contactName: defaultAddress.contactName || "",
              contactPhone: defaultAddress.contactPhone || "",
              addressLine: defaultAddress.addressLine || "",
              city: defaultAddress.city || "",
              state: defaultAddress.state || "",
              zip: String(defaultAddress.zip || "").trim(),
            }
          : null,

        // 可选：如果你不想暴露所有 addresses，可以不返回
        // addresses: user.addresses || [],
      },
    });
  } catch (err) {
    console.error("GET /api/user/me error:", err);
    return res.status(500).json({ success: false, message: "server error" });
  }
});

export default router;
