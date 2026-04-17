import express from "express";
import mongoose from "mongoose";
import PickupPoint from "../models/PickupPoint.js";
import LeaderPickupChangeRequest from "../models/LeaderPickupChangeRequest.js";
import { requireLogin } from "../middlewares/auth.js";
import User from "../models/user.js";
import { geocodeAddress } from "../utils/geocoding.js";

const router = express.Router();
router.use(express.json());
router.use(requireLogin);

// 这里按你后台真实管理员判断逻辑改
function isAdmin(req) {
  return req.user?.role === "admin";
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: "未登录"
    });
  }

  if (!isAdmin(req)) {
    return res.status(403).json({
      ok: false,
      success: false,
      message: "无管理员权限"
    });
  }

  next();
}

function formatBusinessHoursText(hours = []) {
  if (!Array.isArray(hours) || !hours.length) return "";

  const dayMap = {
    1: "周一",
    2: "周二",
    3: "周三",
    4: "周四",
    5: "周五",
    6: "周六",
    0: "周日"
  };

  const openDays = hours
    .filter((x) => x && !x.closed && x.open && x.close)
    .map((x) => `${dayMap[x.day] || x.day} ${x.open}-${x.close}`);

  if (!openDays.length) return "暂停营业";
  return openDays.join(" / ");
}

async function tryGeocodePickupPoint(data) {
  const fullAddress = [
    data.addressLine1,
    data.addressLine2,
    data.city,
    data.state,
    data.zip
  ]
    .filter(Boolean)
    .join(", ");

  if (!fullAddress) {
    return { lat: null, lng: null };
  }

  try {
    const geo = await geocodeAddress(fullAddress);
    return {
      lat: Number.isFinite(Number(geo?.lat)) ? Number(geo.lat) : null,
      lng: Number.isFinite(Number(geo?.lng)) ? Number(geo.lng) : null
    };
  } catch (e) {
    console.warn("tryGeocodePickupPoint failed:", e?.message || e);
    return { lat: null, lng: null };
  }
}

// =========================
// 管理员：查看自提点变更申请列表
// =========================
router.get("/change-requests", requireAdmin, async (req, res) => {
  try {
    const list = await LeaderPickupChangeRequest.find({})
      .populate("leaderUserId", "name phone role")
      .populate("pickupPointId")
      .sort({ status: 1, createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      success: true,
      items: list.map((r) => ({
        _id: String(r._id),
        requestType: r.requestType || "add",
        status: r.status || "pending",
        leaderUser: r.leaderUserId || null,
        pickupPointId: r.pickupPointId ? String(r.pickupPointId._id || r.pickupPointId) : "",
        submittedData: r.submittedData || {},
        leaderRemark: r.leaderRemark || "",
        adminRemark: r.adminRemark || "",
        reviewedAt: r.reviewedAt || null,
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    console.error("GET /api/admin/pickups/change-requests error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "加载申请列表失败"
    });
  }
});

// =========================
// 管理员：审核通过
// =========================
router.post("/change-requests/:id/approve", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminRemark = "" } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "申请ID不合法"
      });
    }

    const reqDoc = await LeaderPickupChangeRequest.findById(id);
    if (!reqDoc) {
      return res.status(404).json({
        ok: false,
        success: false,
        message: "申请不存在"
      });
    }

    if (reqDoc.status !== "pending") {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "该申请已处理"
      });
    }

    const d = reqDoc.submittedData || {};
    let point = null;

    const leaderUser = await User.findById(reqDoc.leaderUserId)
      .select("name phone")
      .lean();

    const businessHours = Array.isArray(d.businessHours) ? d.businessHours : [];
    const pickupTimeText = formatBusinessHoursText(businessHours);

    let lat = d.lat ?? null;
let lng = d.lng ?? null;
let zip = d.zip || "";
let fullAddress = d.fullAddress || "";

if (lat === null || lng === null) {
  const geo = await geocodeAddress(
    [
      d.addressLine1,
      d.addressLine2,
      d.city,
      d.state,
      d.zip
    ]
      .filter(Boolean)
      .join(", ")
  );

  if (geo) {
    lat = geo.lat ?? null;
    lng = geo.lng ?? null;

    // ✅ 自动修正 zip
    if (geo.zip) {
      zip = geo.zip;
    }

    // ✅ 使用 Google 标准地址
    if (geo.formattedAddress) {
      fullAddress = geo.formattedAddress;
    }
  }
}

    if (reqDoc.requestType === "add") {
      point = await PickupPoint.create({
        enabled: true,
        status: "active",

        name: d.name || "",
        code: "",
        note: "",

        leaderUserId: new mongoose.Types.ObjectId(String(reqDoc.leaderUserId)),
        leaderName: leaderUser?.name || "",
        leaderPhone: leaderUser?.phone || "",

        contactName: d.contactName || "",
        contactPhone: d.contactPhone || "",

        addressLine1: d.addressLine1 || "",
        addressLine2: d.addressLine2 || "",
        city: d.city || "",
        state: d.state || "NY",
        zip,
fullAddress,

        displayArea: d.displayArea || d.city || "",
        nearStreet: d.nearStreet || "",
        maskedAddress: d.maskedAddress || "",

        lat,
        lng,

        serviceZips: d.zip ? [String(d.zip)] : [],
        pickupTimeText,
        minOrderAmount: 0,
        pickupFee: 0,
        businessHours,

        revealFullAddressAfterOrder: false
      });

      reqDoc.pickupPointId = point._id;
    } else {
      point = await PickupPoint.findById(reqDoc.pickupPointId);
      if (!point) {
        return res.status(404).json({
          ok: false,
          success: false,
          message: "正式自提点不存在"
        });
      }

      point.enabled = true;
      point.status = "active";

      point.name = d.name || "";
      point.leaderUserId = new mongoose.Types.ObjectId(String(reqDoc.leaderUserId));
      point.leaderName = leaderUser?.name || point.leaderName || "";
      point.leaderPhone = leaderUser?.phone || point.leaderPhone || "";

      point.contactName = d.contactName || "";
      point.contactPhone = d.contactPhone || "";

      point.addressLine1 = d.addressLine1 || "";
      point.addressLine2 = d.addressLine2 || "";
      point.city = d.city || "";
      point.state = d.state || "NY";
      point.zip = zip;
point.fullAddress = fullAddress;

      point.displayArea = d.displayArea || d.city || "";
      point.nearStreet = d.nearStreet || "";
      point.maskedAddress = d.maskedAddress || "";

      point.lat = lat;
      point.lng = lng;

      point.serviceZips = d.zip
        ? [String(d.zip)]
        : (Array.isArray(point.serviceZips) ? point.serviceZips : []);

      point.pickupTimeText = pickupTimeText;
      point.businessHours = businessHours;

      await point.save();
    }

    reqDoc.status = "approved";
    reqDoc.adminRemark = String(adminRemark).trim();
    reqDoc.reviewedBy = req.user?._id || null;
    reqDoc.reviewedAt = new Date();
    await reqDoc.save();

    return res.json({
      ok: true,
      success: true,
      message: "审核通过",
      pickupPointId: point ? String(point._id) : ""
    });
  } catch (err) {
    console.error("POST /api/admin/pickups/change-requests/:id/approve error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "审核失败"
    });
  }
});

// =========================
// 管理员：审核拒绝
// =========================
router.post("/change-requests/:id/reject", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminRemark = "" } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "申请ID不合法"
      });
    }

    const reqDoc = await LeaderPickupChangeRequest.findById(id);
    if (!reqDoc) {
      return res.status(404).json({
        ok: false,
        success: false,
        message: "申请不存在"
      });
    }

    if (reqDoc.status !== "pending") {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "该申请已处理"
      });
    }

    reqDoc.status = "rejected";
    reqDoc.adminRemark = String(adminRemark).trim();
    reqDoc.reviewedBy = req.user?._id || null;
    reqDoc.reviewedAt = new Date();
    await reqDoc.save();

    return res.json({
      ok: true,
      success: true,
      message: "已拒绝"
    });
  } catch (err) {
    console.error("POST /api/admin/pickups/change-requests/:id/reject error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "操作失败"
    });
  }
});
// =========================
// 管理员：自提点真实列表
// =========================
router.get("/", requireAdmin, async (req, res) => {
  try {
    const list = await PickupPoint.find({})
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      success: true,
      items: list.map((p, idx) => ({
        _id: String(p._id),
        pickupId: p.code || `PUP-${String(idx + 1).padStart(3, "0")}`,
        name: p.name || "",
        leaderName: p.leaderName || "",
        leaderPhone: p.leaderPhone || "",
        contactName: p.contactName || "",
        contactPhone: p.contactPhone || "",
        address:
          p.maskedAddress ||
          p.fullAddress ||
          [p.addressLine1, p.addressLine2, p.city, p.state, p.zip]
            .filter(Boolean)
            .join(", "),
        pickupTimeText: p.pickupTimeText || "",
        zip: p.zip || "",
        city: p.city || "",
        status: p.status || (p.enabled ? "active" : "disabled"),
        enabled: !!p.enabled,
        serviceZips: Array.isArray(p.serviceZips) ? p.serviceZips : [],
        businessHours: Array.isArray(p.businessHours) ? p.businessHours : [],
        createdAt: p.createdAt
      })),
      summary: {
        total: list.length,
        active: list.filter((x) => x.enabled !== false && (x.status || "active") === "active").length,
        pending: list.filter((x) => (x.status || "") === "pending").length
      }
    });
  } catch (err) {
    console.error("GET /api/admin/pickups error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "加载自提点失败"
    });
  }
});
export default router;