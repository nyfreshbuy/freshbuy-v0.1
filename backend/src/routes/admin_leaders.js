// backend/src/routes/admin_leaders.js
import express from "express";
import User from "../models/user.js";
import PickupPoint from "../models/PickupPoint.js";
import { genLeaderCode } from "../utils/leaderCode.js";
import { maskPickupAddress } from "../utils/address_mask.js";
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

function pickLeaderName(u) {
  return String(
    u?.name ||
      u?.nickname ||
      u?.username ||
      u?.fullName ||
      (u?.phone ? `用户${String(u.phone).slice(-4)}` : "团长")
  ).trim();
}

function pickLeaderStatus(u) {
  if (u?.status === "disabled" || u?.isDisabled) return "冻结";
  return "正常";
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildPickupName(u, pickup) {
  const addr = getDefaultAddressFromUser(u);

  return String(
    pickup?.name ||
      pickup?.displayArea ||
      pickup?.maskedAddress ||
      addr?.formattedAddress ||
      addr?.addressLine ||
      "-"
  ).trim();
}

// ========================================================
// GET /api/admin/leaders
// ✅ 获取真实团长列表（给 admin/leaders.html 用）
// ========================================================
router.get("/", async (req, res) => {
  try {
    const leaders = await User.find({ role: "leader" })
      .sort({ createdAt: -1 })
      .lean();

    const leaderIds = leaders.map((u) => u._id).filter(Boolean);

    const pickupPoints = leaderIds.length
      ? await PickupPoint.find({ leaderUserId: { $in: leaderIds } }).lean()
      : [];

    const pickupMap = new Map(
      pickupPoints.map((p) => [String(p.leaderUserId), p])
    );

    const items = leaders.map((u, idx) => {
      const pickup = pickupMap.get(String(u._id));

      return {
        userId: String(u._id),
        leaderId: String(u.leaderCode || `L${String(idx + 1).padStart(4, "0")}`),
        leaderName: pickLeaderName(u),
        phone: String(u.phone || "").trim(),
        pickupName: buildPickupName(u, pickup),

        // 先兼容已有字段，没有就显示 0
        totalOrders: toNumber(u.leaderOrderCount || u.totalOrders || 0),
        totalGmv: toNumber(u.leaderTotalGmv || u.totalGmv || 0),
        commissionRate: toNumber(
          u.leaderCommissionRate ?? u.commissionRate ?? 0
        ),
        withdrawable: toNumber(
          u.withdrawableCommission ??
            u.availableCommission ??
            u.pendingWithdrawAmount ??
            0
        ),

        status: pickLeaderStatus(u),
        createdAt: u.createdAt || null,

        pickupPointId: pickup?._id ? String(pickup._id) : "",
        pickupEnabled: Boolean(pickup?.enabled),
      };
    });

    const summary = {
      totalLeaders: items.length,
      totalGmv: items.reduce((sum, x) => sum + toNumber(x.totalGmv), 0),
      pendingCommission: items.reduce(
        (sum, x) => sum + toNumber(x.withdrawable),
        0
      ),
      activeLeaders: items.filter((x) => toNumber(x.totalOrders) > 0).length,
    };

    return res.json({
      ok: true,
      items,
      summary,
    });
  } catch (err) {
    console.error("GET /api/admin/leaders error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "load leaders failed",
    });
  }
});

// ========================================================
// POST /api/admin/leaders/make-leader
// ✅ 把某个用户升级为团长并生成邀请码
// ✅ 如果用户默认地址完整，则自动创建 / 更新一个自提点
// ========================================================
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
        const exists = await User.findOne({ leaderCode: code })
          .select("_id")
          .lean();

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
    const leaderName = pickLeaderName(u);
    const leaderPhone = String(u.phone || "").trim();

    const addr = getDefaultAddressFromUser(u);

    const addressLine1 = String(
      addr?.addressLine || addr?.formattedAddress || ""
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
      const maskedAddress = maskPickupAddress(addressLine1, nearStreet);

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