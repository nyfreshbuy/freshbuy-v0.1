// backend/src/routes/user_profile.js
import express from "express";
import User from "../models/user.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();

router.get("/me/default-address", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name phone addresses");
    if (!user) return res.status(404).json({ success: false, message: "用户不存在" });

    const addr = (user.addresses || []).find((a) => a.isDefault) || null;

    return res.json({
      success: true,
      data: addr
        ? {
            contactName: addr.contactName || user.name || "",
            contactPhone: addr.contactPhone || user.phone || "",
            addressLine: addr.addressLine || "",
            city: addr.city || "",
            zip: addr.zip || "",
            // ⭐ 这里先不含 lat/lng（因为你 User.addressSchema 目前没这俩字段）
          }
        : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "获取默认地址失败" });
  }
});
// backend/src/routes/user_profile.js（继续追加）
router.put("/me/default-address", requireLogin, async (req, res) => {
  try {
    const { contactName, contactPhone, addressLine, city, zip } = req.body || {};

    if (!contactName || !contactPhone || !addressLine || !zip) {
      return res.status(400).json({ success: false, message: "地址信息不完整" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "用户不存在" });

    // 全部先取消 default
    user.addresses = (user.addresses || []).map((a) => ({ ...a.toObject?.() , isDefault: false }));

    // 追加一个新的默认地址（最简单稳定）
    user.addresses.push({
      label: "默认地址",
      contactName,
      contactPhone,
      addressLine,
      city: city || "",
      zip,
      isDefault: true,
    });

    await user.save();

    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "保存默认地址失败" });
  }
});
export default router;
