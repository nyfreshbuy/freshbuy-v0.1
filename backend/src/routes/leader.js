import express from "express";
import mongoose from "mongoose";
import User from "../models/user.js";
import Order from "../models/order.js";
import Wallet from "../models/Wallet.js";
import { requireLogin } from "../middlewares/auth.js";
import PickupPoint from "../models/PickupPoint.js";
import LeaderPickupChangeRequest from "../models/LeaderPickupChangeRequest.js";
const router = express.Router();
router.use(express.json());
router.use(requireLogin);

// =========================
// 小工具
// =========================
function money(n) {
  const x = Number(n || 0);
  return Math.round(x * 100) / 100;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function maskPhone(phone) {
  const s = String(phone || "").replace(/[^\d]/g, "");
  if (s.length < 7) return phone || "";
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function normalizeOrderStatus(o) {
  const raw =
    o.status ||
    o.orderStatus ||
    o.fulfillmentStatus ||
    "";

  if (["delivered", "completed", "picked", "picked_up"].includes(raw)) return "已完成";
  if (["ready", "ready_for_pickup"].includes(raw)) return "待自提";
  if (["notified"].includes(raw)) return "已通知";
  if (["paid", "confirmed", "processing", "packing"].includes(raw)) return "处理中";
  if (["cancelled", "canceled"].includes(raw)) return "已取消";
  return raw || "待处理";
}

function getOrderTotal(o) {
  return money(
    o.totalAmount ??
      o.grandTotal ??
      o.total ??
      o.payableAmount ??
      0
  );
}

function getOrderNo(o) {
  return (
    o.orderNo ||
    o.orderNumber ||
    o.displayOrderNo ||
    String(o._id)
  );
}

function getCustomerName(o) {
  return (
    o.customerName ||
    o.contactName ||
    o.receiverName ||
    o.userName ||
    "客户"
  );
}

function getPickupCode(o) {
  return o.pickupCode || o.selfPickupCode || o.verifyCode || "";
}

function getReqUserId(req) {
  return req.user?._id || req.user?.id || null;
}

// =========================
// 权限校验
// =========================
async function getLeaderMe(userId) {
  return await User.findById(userId).select(
    [
      "role",
      "name",
      "phone",
      "leaderCode",
      "leaderCommissionBalance",
      "leaderTotalCommissionEarned",
      "pickupPointName",
      "pickupAddress",
      "pickupAddressMasked",
      "leaderStatus",
      "accountSettings.displayName",
    ].join(" ")
  );
}

async function ensureLeader(req, res, next) {
  const userId = getReqUserId(req);

  if (!userId) {
    return res.status(401).json({
      ok: false,
      success: false,
      message: "未登录（缺少用户ID）"
    });
  }

  const me = await getLeaderMe(userId);

  if (!me) {
    return res.status(404).json({
      ok: false,
      success: false,
      message: "User not found"
    });
  }

  if (me.role !== "leader") {
    return res.status(403).json({
      ok: false,
      success: false,
      message: "Not a leader"
    });
  }

  req.leader = me;
  next();
}

// =========================
// 团长中心：我的信息
// =========================
router.get("/me", async (req, res) => {
  try {
    const userId = getReqUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        success: false,
        message: "未登录（缺少用户ID）"
      });
    }

    const me = await User.findById(userId).select(
      "role name phone leaderCode leaderCommissionBalance leaderTotalCommissionEarned pickupPointName pickupAddress pickupAddressMasked leaderStatus accountSettings.displayName"
    );

    if (!me) {
      return res.status(404).json({
        ok: false,
        success: false,
        message: "User not found"
      });
    }

    const isLeader = me.role === "leader";

    if (!isLeader) {
      return res.json({
        ok: true,
        success: true,
        isLeader: false,
        message: "Current user is not a leader"
      });
    }

    const teamCount = await User.countDocuments({ invitedByLeaderId: me._id });

    let wallet = null;
    try {
      wallet = await Wallet.findOne({ userId: me._id }).select("balance").lean();
    } catch {
      wallet = null;
    }

    return res.json({
      ok: true,
      success: true,
      isLeader: true,

      leaderCode: me.leaderCode || "",
      balance: Number(me.leaderCommissionBalance || 0),
      totalEarned: Number(me.leaderTotalCommissionEarned || 0),
      teamCount,

      leader: {
        _id: String(me._id),
        name:
          me.accountSettings?.displayName ||
          me.name ||
          me.phone ||
          "团长",
        phone: me.phone || "",
        pickupPointName: me.pickupPointName || "",
        pickupAddress: me.pickupAddress || "",
        pickupAddressMasked: me.pickupAddressMasked || "",
        leaderStatus: me.leaderStatus || "active",
        walletBalance: money(wallet?.balance || 0)
      }
    });
  } catch (err) {
    console.error("GET /api/leader/me error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: err?.message || "Server error"
    });
  }
});

// =========================
// 团长中心：我的团队列表
// =========================
router.get("/team", ensureLeader, async (req, res) => {
  const list = await User.find({ invitedByLeaderId: req.leader._id })
    .select("phone name accountSettings.displayName createdAt")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return res.json({
    ok: true,
    list: list.map((u) => ({
      _id: String(u._id),
      name: u.accountSettings?.displayName || u.name || "用户",
      phone: u.phone || "",
      phoneMasked: maskPhone(u.phone || ""),
      createdAt: u.createdAt,
    })),
  });
});

// =========================
// 团长首页统计
// =========================
router.get("/dashboard/stats", ensureLeader, async (req, res) => {
  const leaderId = req.leader._id;
  const today = startOfToday();
  const weekStart = startOfWeek();

  const todayOrders = await Order.countDocuments({
    leaderId,
    createdAt: { $gte: today },
  });

  const pendingPickupOrders = await Order.countDocuments({
    leaderId,
    status: { $in: ["ready", "ready_for_pickup", "notified", "paid", "confirmed", "processing", "packing"] },
  }).catch(async () => {
    return await Order.countDocuments({
      leaderId,
      createdAt: { $gte: today },
    });
  });

  const totalCustomers = await User.countDocuments({
    invitedByLeaderId: leaderId,
  });

  let weekCommission = 0;
  try {
    const agg = await Order.aggregate([
      {
        $match: {
          leaderId: new mongoose.Types.ObjectId(String(leaderId)),
          createdAt: { $gte: weekStart },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $ifNull: ["$leaderCommissionAmount", 0],
            },
          },
        },
      },
    ]);
    weekCommission = money(agg?.[0]?.total || 0);
  } catch {
    weekCommission = 0;
  }

  return res.json({
    ok: true,
    stats: {
      todayOrders,
      pendingPickupOrders,
      weekCommission,
      totalCustomers,
      totalEarned: money(req.leader.leaderTotalCommissionEarned || 0),
      balance: money(req.leader.leaderCommissionBalance || 0),
    },
  });
});

// =========================
// 团长订单列表
// =========================
router.get("/orders", ensureLeader, async (req, res) => {
  const leaderId = req.leader._id;

  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const skip = (page - 1) * pageSize;
  const status = String(req.query.status || "").trim();

  const q = { leaderId };

  if (status === "pending") {
    q.status = { $in: ["paid", "confirmed", "processing", "packing", "notified", "ready", "ready_for_pickup"] };
  } else if (status === "ready") {
    q.status = { $in: ["ready", "ready_for_pickup"] };
  } else if (status === "completed") {
    q.status = { $in: ["delivered", "completed", "picked", "picked_up"] };
  } else if (status === "cancelled") {
    q.status = { $in: ["cancelled", "canceled"] };
  }

  const [items, total] = await Promise.all([
    Order.find(q).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Order.countDocuments(q),
  ]);

  return res.json({
    ok: true,
    page,
    pageSize,
    total,
    items: items.map((o) => ({
      _id: String(o._id),
      orderNo: getOrderNo(o),
      customerName: getCustomerName(o),
      customerPhoneMasked: maskPhone(o.customerPhone || o.phone || ""),
      total: getOrderTotal(o),
      itemCount: Number(o.itemCount || o.totalQty || 0),
      pickupCode: getPickupCode(o),
      status: o.status || "",
      statusText: normalizeOrderStatus(o),
      createdAt: o.createdAt,
      pickupTime:
        o.pickupTime ||
        o.pickupAt ||
        o.deliveryDate ||
        null,
      leaderCommissionAmount: money(o.leaderCommissionAmount || 0),
    })),
  });
});

// =========================
// 团长订单详情
// =========================
router.get("/orders/:id", ensureLeader, async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return res.status(400).json({ ok: false, message: "Invalid order id" });
  }

  const o = await Order.findOne({
    _id: id,
    leaderId: req.leader._id,
  }).lean();

  if (!o) {
    return res.status(404).json({ ok: false, message: "Order not found" });
  }

  return res.json({
    ok: true,
    item: {
      _id: String(o._id),
      orderNo: getOrderNo(o),
      customerName: getCustomerName(o),
      customerPhoneMasked: maskPhone(o.customerPhone || o.phone || ""),
      total: getOrderTotal(o),
      pickupCode: getPickupCode(o),
      status: o.status || "",
      statusText: normalizeOrderStatus(o),
      remark: o.remark || o.note || "",
      createdAt: o.createdAt,
      items: Array.isArray(o.items) ? o.items : [],
      leaderCommissionAmount: money(o.leaderCommissionAmount || 0),
    },
  });
});

// =========================
// 今日自提列表
// =========================
router.get("/pickups/today", ensureLeader, async (req, res) => {
  const leaderId = req.leader._id;
  const today = startOfToday();
  const todayEnd = endOfToday();

  const orders = await Order.find({
    leaderId,
    createdAt: { $gte: today, $lte: todayEnd },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return res.json({
    ok: true,
    items: orders.map((o) => ({
      _id: String(o._id),
      orderNo: getOrderNo(o),
      customerName: getCustomerName(o),
      customerPhoneMasked: maskPhone(o.customerPhone || o.phone || ""),
      pickupCode: getPickupCode(o),
      total: getOrderTotal(o),
      status: o.status || "",
      statusText: normalizeOrderStatus(o),
      createdAt: o.createdAt,
    })),
  });
});

// =========================
// 团长收益摘要
// =========================
router.get("/earnings/summary", ensureLeader, async (req, res) => {
  const weekStart = startOfWeek();

  let weekCommission = 0;
  try {
    const agg = await Order.aggregate([
      {
        $match: {
          leaderId: new mongoose.Types.ObjectId(String(req.leader._id)),
          createdAt: { $gte: weekStart },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $ifNull: ["$leaderCommissionAmount", 0],
            },
          },
        },
      },
    ]);
    weekCommission = money(agg?.[0]?.total || 0);
  } catch {
    weekCommission = 0;
  }

  return res.json({
    ok: true,
    summary: {
      balance: money(req.leader.leaderCommissionBalance || 0),
      totalEarned: money(req.leader.leaderTotalCommissionEarned || 0),
      weekCommission,
    },
  });
});
router.get("/pickup-points", ensureLeader, async (req, res) => {
  try {
    const list = await PickupPoint.find({
      leaderUserId: req.leader._id
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      success: true,
      items: list.map((p) => ({
        _id: String(p._id),
        name: p.name || "",
        code: p.code || "",
        leaderName: p.leaderName || "",
        leaderPhone: p.leaderPhone || "",
        contactName: p.contactName || "",
        contactPhone: p.contactPhone || "",
        addressLine1: p.addressLine1 || "",
        addressLine2: p.addressLine2 || "",
        city: p.city || "",
        state: p.state || "",
        zip: p.zip || "",
        fullAddress: p.fullAddress || "",
        maskedAddress: p.maskedAddress || "",
        pickupTimeText: p.pickupTimeText || "",
        businessHours: Array.isArray(p.businessHours) ? p.businessHours : [],
        status: p.status || "active",
        enabled: !!p.enabled,
        createdAt: p.createdAt
      }))
    });
  } catch (err) {
    console.error("GET /api/leader/pickup-points error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "加载自提点失败"
    });
  }
});
router.get("/pickup-change-requests", ensureLeader, async (req, res) => {
  try {
    const list = await LeaderPickupChangeRequest.find({
      leaderUserId: req.leader._id
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      success: true,
      items: list.map((r) => ({
        _id: String(r._id),
        requestType: r.requestType || "add",
        pickupPointId: r.pickupPointId ? String(r.pickupPointId) : "",
        submittedData: r.submittedData || {},
        status: r.status || "pending",
        leaderRemark: r.leaderRemark || "",
        adminRemark: r.adminRemark || "",
        reviewedAt: r.reviewedAt || null,
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    console.error("GET /api/leader/pickup-change-requests error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "加载申请记录失败"
    });
  }
});
router.post("/pickup-change-requests", ensureLeader, async (req, res) => {
  try {
    const {
      requestType = "add",
      pickupPointId = "",
      name = "",
      contactName = "",
      contactPhone = "",
      addressLine1 = "",
      addressLine2 = "",
      city = "",
      state = "NY",
      zip = "",
      fullAddress = "",
      displayArea = "",
      nearStreet = "",
      maskedAddress = "",
      lat = null,
      lng = null,
      pickupTimeText = "",
      businessHours = [],
      leaderRemark = ""
    } = req.body || {};

    if (!["add", "edit"].includes(String(requestType))) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "requestType 不合法"
      });
    }

    if (!String(name).trim()) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "自提点名称不能为空"
      });
    }

    if (!String(fullAddress).trim()) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "完整地址不能为空"
      });
    }

    if (requestType === "edit") {
      if (!pickupPointId || !mongoose.Types.ObjectId.isValid(String(pickupPointId))) {
        return res.status(400).json({
          ok: false,
          success: false,
          message: "pickupPointId 不合法"
        });
      }

      const oldPoint = await PickupPoint.findOne({
        _id: pickupPointId,
        leaderUserId: req.leader._id
      }).lean();

      if (!oldPoint) {
        return res.status(404).json({
          ok: false,
          success: false,
          message: "自提点不存在"
        });
      }
    }

    const existingPending = await LeaderPickupChangeRequest.findOne({
      leaderUserId: req.leader._id,
      pickupPointId: requestType === "edit" ? pickupPointId : null,
      status: "pending"
    }).lean();

    if (existingPending) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "你已有待审核申请，请先等待管理员处理"
      });
    }

    const pointCount = await PickupPoint.countDocuments({
      leaderUserId: req.leader._id
    });

    if (requestType === "add" && pointCount >= 20) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "最多只能管理20个自提点"
      });
    }

    const doc = await LeaderPickupChangeRequest.create({
      leaderUserId: req.leader._id,
      requestType,
      pickupPointId: requestType === "edit" ? pickupPointId : null,
      submittedData: {
        name: String(name).trim(),
        contactName: String(contactName).trim(),
        contactPhone: String(contactPhone).trim(),
        addressLine1: String(addressLine1).trim(),
        addressLine2: String(addressLine2).trim(),
        city: String(city).trim(),
        state: String(state || "NY").trim(),
        zip: String(zip).trim(),
        fullAddress: String(fullAddress).trim(),
        displayArea: String(displayArea).trim(),
        nearStreet: String(nearStreet).trim(),
        maskedAddress: String(maskedAddress).trim(),
        lat: lat === null || lat === "" ? null : Number(lat),
        lng: lng === null || lng === "" ? null : Number(lng),
        pickupTimeText: String(pickupTimeText).trim(),
        businessHours: Array.isArray(businessHours) ? businessHours : []
      },
      leaderRemark: String(leaderRemark).trim(),
      status: "pending"
    });

    return res.json({
      ok: true,
      success: true,
      message: "提交成功，等待管理员审核",
      item: doc
    });
  } catch (err) {
    console.error("POST /api/leader/pickup-change-requests error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "提交申请失败"
    });
  }
});
router.post("/pickup-change-requests/:id/cancel", ensureLeader, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: "申请ID不合法"
      });
    }

    const doc = await LeaderPickupChangeRequest.findOne({
      _id: id,
      leaderUserId: req.leader._id,
      status: "pending"
    });

    if (!doc) {
      return res.status(404).json({
        ok: false,
        success: false,
        message: "待审核申请不存在"
      });
    }

    doc.status = "rejected";
    doc.adminRemark = "团长主动取消";
    doc.reviewedAt = new Date();
    await doc.save();

    return res.json({
      ok: true,
      success: true,
      message: "已取消申请"
    });
  } catch (err) {
    console.error("POST /api/leader/pickup-change-requests/:id/cancel error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "取消失败"
    });
  }
});
export default router;