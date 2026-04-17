import express from "express";
import mongoose from "mongoose";
import PickupPoint from "../models/PickupPoint.js";
import LeaderPickupChangeRequest from "../models/LeaderPickupChangeRequest.js";
import { requireLogin } from "../middlewares/auth.js";

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

    if (reqDoc.requestType === "add") {
      point = await PickupPoint.create({
        enabled: true,
        status: "active",

        name: d.name || "",
        code: "",
        note: "",

        leaderUserId: reqDoc.leaderUserId,
        leaderName: "",
        leaderPhone: "",

        contactName: d.contactName || "",
        contactPhone: d.contactPhone || "",

        addressLine1: d.addressLine1 || "",
        addressLine2: d.addressLine2 || "",
        city: d.city || "",
        state: d.state || "NY",
        zip: d.zip || "",
        fullAddress: d.fullAddress || "",

        displayArea: d.displayArea || "",
        nearStreet: d.nearStreet || "",
        maskedAddress: d.maskedAddress || "",

        lat: d.lat ?? null,
        lng: d.lng ?? null,

        serviceZips: [],
        pickupTimeText: d.pickupTimeText || "",
        minOrderAmount: 0,
        pickupFee: 0,
        businessHours: Array.isArray(d.businessHours) ? d.businessHours : [],

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

      point.name = d.name || "";
      point.contactName = d.contactName || "";
      point.contactPhone = d.contactPhone || "";
      point.addressLine1 = d.addressLine1 || "";
      point.addressLine2 = d.addressLine2 || "";
      point.city = d.city || "";
      point.state = d.state || "NY";
      point.zip = d.zip || "";
      point.fullAddress = d.fullAddress || "";
      point.displayArea = d.displayArea || "";
      point.nearStreet = d.nearStreet || "";
      point.maskedAddress = d.maskedAddress || "";
      point.lat = d.lat ?? null;
      point.lng = d.lng ?? null;
      point.pickupTimeText = d.pickupTimeText || "";
      point.businessHours = Array.isArray(d.businessHours) ? d.businessHours : [];
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
      message: "审核通过"
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

export default router;