// backend/src/routes/admin_leaders.js
import express from "express";
import User from "../models/user.js";
import PickupPoint from "../models/PickupPoint.js";
import { genLeaderCode } from "../utils/leaderCode.js";
import { maskAddress } from "../utils/address_mask.js";
// import { requireAdmin } from "../middlewares/admin.js";

const router = express.Router();
router.use(express.json());
// router.use(requireAdmin);

function getDefaultAddressFromUser(u) {
  const list = Array.isArray(u?.addresses) ? u.addresses : [];
  if (!list.length) return null;

  const byFlag = list.find((a) => a && a.isDefault);
  if (byFlag) return byFlag;

  const idx = Number(u?.accountSettings?.defaultAddressIndex);
  if (Number.isInteger(idx) && idx >= 0 && idx < list.length) {
    return list[idx];
  }

  return list[0] || null;
}

// ✅ 把某个用户升级为团长并生成邀请码
// ✅ 如果用户默认地址完整，则自动创建 / 更新一个自提点
router.post("/make-leader", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    if (!userId) {
      return res.status(400).json({ ok: false, message: "userId required" });
    }

    const u = await User.findById(userId);
    if (!u) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    // 1) 升级为团长
    u.role = "leader";

    // 2) 生成唯一邀请码
    if (!u.leaderCode) {
      for (let i = 0; i < 12; i++) {
        const code = genLeaderCode(6);
        const exists = await User.findOne({ leaderCode: code }).select("_id").lean();
        if (!exists) {
          u.leaderCode = code;
          break;
        }
      }

      if (!u.leaderCode) {
        return res.status(500).json({
          ok: false,
          message: "Failed to generate unique leaderCode",
        });
      }
    }

    await u.save();

    // =========================
    // ✅ 自动创建 / 更新团长自提点
    // 规则：团长默认地址 = 自提点地址
    // =========================
    const leaderName = String(
      u.name || u.nickname || u.username || u.fullName || "团长"
    ).trim();

    const leaderPhone = String(u.phone || "").trim();

    const addr = getDefaultAddressFromUser(u);

    const addressLine1 = String(
      addr?.addressLine ||
      addr?.formattedAddress ||
      ""
    ).trim();

    // 你的 user.addresses 里没有单独 addressLine2，所以这里先留空
    const addressLine2 = "";

    const city = String(addr?.city || "").trim();
    const state = String(addr?.state || "").trim();
    const zip = String(addr?.zip || "").trim();

    const lat = Number.isFinite(Number(addr?.lat)) ? Number(addr.lat) : undefined;
    const lng = Number.isFinite(Number(addr?.lng)) ? Number(addr.lng) : undefined;

    // 展示区域：优先 city
    const displayArea = String(city || "").trim();

    // 近街道：你当前 user.addresses 里没有单独字段，先留空
    const nearStreet = "";

    // 取货时间先给默认值，后面可在团长管理里单独维护
    const pickupTimeText = "周六 2:00 PM - 6:00 PM";

    let pickupPointCreated = false;

    // ✅ 地址完整时才自动建点
    if (addressLine1 && city && state && zip) {
      const maskedAddress = maskAddress(addressLine1, nearStreet);

      await PickupPoint.findOneAndUpdate(
        { leaderUserId: u._id },
        {
          $set: {
            enabled: true,

            name: `${leaderName} 自提点`,
            code: `LDR-${String(u._id)}`,

            leaderUserId: u._id,
            leaderName,
            leaderPhone,

            addressLine1,
            addressLine2,
            city,
            state,
            zip,

            displayArea,
            nearStreet,
            maskedAddress,
            pickupTimeText,

            ...(lat !== undefined ? { lat } : {}),
            ...(lng !== undefined ? { lng } : {}),

            minOrderAmount: 0,
            pickupFee: 0,
            revealFullAddressAfterOrder: false,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      pickupPointCreated = true;
    }

    return res.json({
      ok: true,
      userId: String(u._id),
      leaderCode: u.leaderCode,
      pickupPointCreated,
      hasDefaultAddress: Boolean(addr),
    });
  } catch (err) {
    console.error("POST /api/admin/leaders/make-leader error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "make leader failed",
    });
  }
});

export default router;