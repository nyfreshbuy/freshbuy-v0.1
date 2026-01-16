// backend/src/routes/admin_orders.js
import express from "express";
import mongoose from "mongoose";
import Order from "../models/order.js";
import { requireLogin } from "../middlewares/auth.js";
const router = express.Router();
router.use(express.json());
router.use(requireLogin); // ✅ 让后面所有路由都有 req.user
console.log("✅ admin_orders.js loaded ✅  VERSION=2026-01-15");
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "需要管理员权限" });
  next();
}
// ===== 工具函数 =====
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}
function modeLabel(m) {
  return (
    {
      normal: "次日配送",
      groupDay: "区域团",
      dealsDay: "爆品日",
      friendGroup: "好友拼单",
    }[m] || "次日配送"
  );
}

// ✅ 中文/旧值/别名兼容 -> 归一到 DB deliveryMode
function normalizeDeliveryModeParam(v) {
  const x = String(v || "").trim();
  const low = x.toLowerCase();

  if (x === "次日配送" || low === "nextday" || low === "next_day" || low === "normaldelivery") return "normal";
  if (x === "区域团" || low === "areagroup" || low === "area_group" || low === "group") return "groupDay";
  if (x === "爆品日" || low === "deals" || low === "dealsday" || low === "deals_day") return "dealsDay";
  if (x === "好友拼单" || low === "friend" || low === "friendgroup" || low === "friend_group") return "friendGroup";

  return x;
}

// ✅ 安全合并条件：把一个 OR 条件塞进 $and（避免覆盖已有 $or）
function addAndOr(filter, orArr) {
  if (!orArr || !orArr.length) return;

  // 如果 filter 里已经有 $or（比如 zone 筛选），先把它也包进 $and
  if (filter.$or) {
    const oldOr = filter.$or;
    delete filter.$or;
    filter.$and = [...(filter.$and || []), { $or: oldOr }];
  }
  filter.$and = [...(filter.$and || []), { $or: orArr }];
}

function normalizeOrder(o) {
  const userName = o.userName || o.customerName || "";
  const userPhone = o.userPhone || o.customerPhone || o.phone || "";
  const address =
    o.fullAddress ||
    o.addressText ||
    o.address?.fullText ||
    o.pickupPointName ||
    "";

  let deliveryMode = String(o.deliveryMode || "").trim();

  // 旧订单兜底：用 orderType 推断
  if (!deliveryMode) {
    if (o.orderType === "area_group") deliveryMode = "groupDay";
    else if (o.orderType === "friend_group") deliveryMode = "friendGroup";
    else deliveryMode = "normal";
  }
  if (!deliveryMode) deliveryMode = "normal";

  const deliveryTypeRaw = o.deliveryType || "home";
  const deliveryTypeText = deliveryTypeRaw === "pickup" ? "自提" : "送货上门";

  return {
    ...o,
    _id: o._id,
    id: o._id?.toString?.() || o.id,
    orderNo: o.orderNo || o._id?.toString?.(),

    deliveryMode,
    deliveryModeLabel: modeLabel(deliveryMode),

    shippingMethod: deliveryMode,
    shippingMode: deliveryMode,

    deliveryType: deliveryTypeRaw,
    deliveryTypeText,

    totalAmount: o.totalAmount ?? o.total ?? o.payment?.amountTotal ?? 0,
    shippingFee: o.deliveryFee ?? o.shippingFee ?? o.shipping ?? 0,

    fulfillment: o.fulfillment || null,
    deliveryStatus: o.deliveryStatus || "",

    userName,
    userPhone,
    address,
  };
}

// =============================
// 0) 测试路由
// =============================
router.get("/test-ping", async (req, res) => {
  const total = await Order.countDocuments({});
  const sample = await Order.findOne({}).sort({ createdAt: -1 }).lean();
  res.json({
    success: true,
    message: "admin_orders DB 路由正常工作（使用 MongoDB Order）",
    total,
    sample: sample ? normalizeOrder(sample) : null,
  });
});
// =============================
// ✅ A) 批量打包（生成批次 packBatchId，并把订单状态改为 packing）
// POST /api/admin/orders/batch-pack
// body: { orderIds: [] }
// =============================
router.post("/batch-pack", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { orderIds } = req.body || {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: "orderIds 不能为空" });
    }

    const validIds = orderIds.map(String).filter(isValidObjectId);
    if (!validIds.length) {
      return res.status(400).json({ success: false, message: "orderIds 都不合法" });
    }

    const batchId =
      "PK" +
      new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const r = await Order.updateMany(
      {
        _id: { $in: validIds.map((x) => new mongoose.Types.ObjectId(x)) },
        status: { $in: ["paid", "packing"] }, // 只允许已支付/已在配货中的订单进入批次
      },
      {
        $set: {
          status: "packing",
          packBatchId: batchId,
          packedAt: new Date(),
        },
      }
    );

    return res.json({
      success: true,
      batchId,
      matched: r.matchedCount ?? r.n ?? 0,
      modified: r.modifiedCount ?? r.nModified ?? 0,
    });
  } catch (err) {
    console.error("POST /api/admin/orders/batch-pack 出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});
// =============================
// ✅ B) 按批次读取订单（配货页）
// GET /api/admin/orders/by-batch?batchId=PKxxxx
// =============================
router.get("/by-batch", requireLogin, requireAdmin, async (req, res) => {
  try {
    const batchId = String(req.query.batchId || "").trim();
    if (!batchId) return res.status(400).json({ success: false, message: "batchId 不能为空" });

    const listRaw = await Order.find({ packBatchId: batchId })
      .sort({ createdAt: -1 })
      .lean();

    const list = listRaw.map(normalizeOrder);

    return res.json({ success: true, orders: list, list, total: list.length });
  } catch (err) {
    console.error("GET /api/admin/orders/by-batch 出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});
// =============================
// 1) 订单列表（DB版）
// GET /api/admin/orders
// =============================
router.get("/", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);

    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim();

    const serviceMode = String(req.query.serviceMode || "").trim();
    const areaGroupZone = String(req.query.areaGroupZone || "").trim();
    const zoneId = String(req.query.zoneId || "").trim();
    const batchKey = String(req.query.batchKey || "").trim();
    const onlyZoneGroup = String(req.query.onlyZoneGroup || "").trim();

    const deliveryModeParam = String(req.query.deliveryMode || "").trim();
    const shippingModeParam = String(req.query.shippingMode || "").trim();

    const filter = {};

    // 订单状态
    // ✅ 状态筛选：兼容老字段 status & 新字段 payment.status
if (status) {
  const st = String(status).trim();

  // paid：命中 status=paid 或 payment.status=paid
  if (st === "paid") {
    // 如果你前面可能已经用了 $or（区域筛选），用 $and 包起来避免覆盖
    if (filter.$or) {
      const oldOr = filter.$or;
      delete filter.$or;
      filter.$and = [...(filter.$and || []), { $or: oldOr }];
    }
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ status: "paid" }, { "payment.status": "paid" }] },
    ];
  } else {
    // 其它状态先保持原逻辑（你需要的话我也可以补全映射）
    filter.status = st;
  }
}
    // 1) 收货方式（door/pickup）-> deliveryType
    function applyDeliveryTypeFilter(v) {
      const x = String(v || "").toLowerCase();
      if (x === "door" || x === "delivery" || x === "home") {
        filter.deliveryType = "home";
        return true;
      }
      if (x === "pickup" || x === "leader") {
        filter.deliveryType = "pickup";
        return true;
      }
      return false;
    }

    let usedAsDeliveryType = false;
    if (deliveryModeParam) usedAsDeliveryType = applyDeliveryTypeFilter(deliveryModeParam);

    // 2) ✅ 业务配送方式（关键修复：兼容老订单无 deliveryMode）
    if (!usedAsDeliveryType) {
      const dmRaw = deliveryModeParam || shippingModeParam;
      const dm = normalizeDeliveryModeParam(dmRaw);

      if (["normal", "groupDay", "dealsDay", "friendGroup"].includes(dm)) {
        // 老订单兜底规则
        if (dm === "normal") {
          addAndOr(filter, [
            { deliveryMode: "normal" },
            // 老订单：deliveryMode 不存在/为空，并且 orderType 是 normal 或不存在
            { deliveryMode: { $exists: false }, orderType: { $in: [null, "", "normal"] } },
            { deliveryMode: "", orderType: { $in: [null, "", "normal"] } },
          ]);
        } else if (dm === "groupDay") {
          addAndOr(filter, [
            { deliveryMode: "groupDay" },
            { orderType: "area_group" }, // 老订单
          ]);
        } else if (dm === "friendGroup") {
          addAndOr(filter, [
            { deliveryMode: "friendGroup" },
            { orderType: "friend_group" }, // 老订单
          ]);
        } else if (dm === "dealsDay") {
          addAndOr(filter, [{ deliveryMode: "dealsDay" }]);
        }
      }
    }

    // 3) serviceMode 兼容（也按老订单口径处理）
    // ✅ 安全合并：把 or 条件塞进 $and，避免覆盖已有 $or（比如 zone 筛选）

if (serviceMode) {
  const sm = String(serviceMode).trim();

  if (sm === "areaGroup") {
    addAndOr(filter, [
      { deliveryMode: { $in: ["groupDay", "dealsDay"] } },
      { orderType: "area_group" },
    ]);
  } else if (sm === "friend") {
    addAndOr(filter, [
      { deliveryMode: "friendGroup" },
      { orderType: "friend_group" },
    ]);
  } else if (sm === "normal") {
    addAndOr(filter, [
      { deliveryMode: "normal" },
      { deliveryMode: { $exists: false } },
      { deliveryMode: "" },
      { deliveryMode: null },
    ]);
  } else {
    filter.deliveryMode = sm;
  }
}
    // 4) 只看区域团批次
    if (onlyZoneGroup === "1" || onlyZoneGroup === "true") {
      filter["fulfillment.groupType"] = "zone_group";
    }

    // 5) 区域筛选
    const z = zoneId || areaGroupZone;
    if (z) {
      filter.$or = [
        ...(filter.$or || []),
        { "address.zoneId": z },
        { "fulfillment.zoneId": z },
      ];
    }

    // 6) 批次筛选
    if (batchKey) {
      filter["fulfillment.batchKey"] = batchKey;
    }

    // 7) 关键词搜索（合并 AND）
    if (keyword) {
      const re = new RegExp(escapeRegex(keyword), "i");
      const orKeyword = [
        { orderNo: re },
        { customerName: re },
        { customerPhone: re },
        { addressText: re },
      ];

      if (isValidObjectId(keyword)) {
        orKeyword.push({ _id: new mongoose.Types.ObjectId(keyword) });
      }

      if (filter.$or && Array.isArray(filter.$or) && filter.$or.length) {
        const oldOr = filter.$or;
        delete filter.$or;
        filter.$and = [...(filter.$and || []), { $or: oldOr }, { $or: orKeyword }];
      } else {
        addAndOr(filter, orKeyword);
      }
    }

    const total = await Order.countDocuments(filter);

    const listRaw = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    const list = listRaw.map(normalizeOrder);

    const totalPages = Math.max(Math.ceil(total / pageSize) || 1, 1);

    res.json({
      success: true,
      orders: list,
      list,
      page,
      pageSize,
      total,
      totalPages,
      // ✅ 你要排查时很有用：临时返回 filter 看看到底筛了什么（不想暴露可删）
      // debugFilter: filter,
    });
  } catch (err) {
    console.error("GET /api/admin/orders DB 出错:", err);
    res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

// =============================
// picklist / assign-driver / status / drivers / zones
// 你后面的代码不动，保持原样
// =============================

router.get("/picklist", async (req, res) => {
  try {
    const zoneId = String(req.query.zoneId || req.query.zone || "").trim();
    const batchKey = String(req.query.batchKey || "").trim();
    const week = String(req.query.week || "current").trim();

    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day + 6) % 7;

    const mondayThisWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - diffToMonday,
      0, 0, 0, 0
    );

    let startTime;
    let endTime;

    if (week === "current") {
      startTime = mondayThisWeek;
      endTime = now;
    } else {
      startTime = new Date(mondayThisWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
      endTime = mondayThisWeek;
    }

    const filter = {
      createdAt: { $gte: startTime, $lt: endTime },
      "fulfillment.groupType": "zone_group",
    };

    if (zoneId) {
      filter.$or = [{ "address.zoneId": zoneId }, { "fulfillment.zoneId": zoneId }];
    }
    if (batchKey) {
      filter["fulfillment.batchKey"] = batchKey;
    }

    const orders = await Order.find(filter).select({ items: 1 }).lean();

    const map = new Map();

    orders.forEach((o) => {
      const items = o.items || [];
      items.forEach((it) => {
        const key = it.productId || it.name;
        if (!key) return;

        if (!map.has(key)) {
          map.set(key, {
            productId: it.productId || "",
            name: it.name || "",
            sku: it.sku || "",
            totalQty: 0,
            totalAmount: 0,
          });
        }

        const row = map.get(key);
        const qty = Number(it.qty || 0);
        const price = Number(it.price || 0);

        row.totalQty += qty;
        row.totalAmount += qty * price;
      });
    });

    res.json({ success: true, items: Array.from(map.values()) });
  } catch (err) {
    console.error("GET /api/admin/orders/picklist DB 出错:", err);
    res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

router.patch("/assign-driver", requireAdmin, async (req, res) => {
  try {
    const { orderIds, driverId, deliveryDate, batchId, status } = req.body || {};

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: "orderIds 不能为空" });
    }
    if (!isValidObjectId(driverId)) {
      return res.status(400).json({ success: false, message: "driverId 不合法" });
    }

    // ✅ 批次ID：从前端 payload 传来的 batchId；如果没传，就自动从订单里取（兼容 packBatchId）
    const incomingBatchId = String(batchId || "").trim();

    const date = deliveryDate ? new Date(deliveryDate) : new Date();
    if (isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: "deliveryDate 不合法" });
    }

    const validIds = orderIds.map(String).filter(isValidObjectId);
    const objIds = validIds.map((x) => new mongoose.Types.ObjectId(x));

    // ✅ 如果前端没传 batchId，就从第一条订单里读 packBatchId 兜底
    let finalBatchId = incomingBatchId;
    if (!finalBatchId) {
      const one = await Order.findOne({ _id: { $in: objIds } })
        .select("packBatchId batchId dispatch.batchKey fulfillment.batchKey")
        .lean();
      finalBatchId =
        String(one?.packBatchId || one?.batchId || one?.dispatch?.batchKey || one?.fulfillment?.batchKey || "").trim();
    }

    // ✅ 最终状态
    const finalStatus = String(status || "shipping").trim() || "shipping";

    const result = await Order.updateMany(
      {
        _id: { $in: objIds },
        status: { $nin: ["done", "cancel"] },
        settlementGenerated: { $ne: true },
      },
      {
        $set: {
          // ✅ 司机匹配（你 driver_orders.js 会按这些字段找）
          driverId: new mongoose.Types.ObjectId(driverId),

          // ✅ 日期筛选（司机端按 date 拉单会用）
          deliveryDate: date,

          // ✅ 状态
          status: finalStatus,
          deliveryStatus: "delivering",

          assignedAt: new Date(),
          startedAt: new Date(),

          // ✅ 批次（你后台 by-batch 用的是 packBatchId）
          ...(finalBatchId ? { packBatchId: finalBatchId } : {}),

          // ✅ 司机端批次/订单接口最关键：dispatch 字段
          ...(finalBatchId
            ? {
                dispatch: {
                  batchKey: finalBatchId,
                  driverId: new mongoose.Types.ObjectId(driverId),
                  assignedAt: new Date(),
                },
              }
            : {}),
        },
      }
    );

    return res.json({
      success: true,
      message: "派单成功",
      matched: result.matchedCount ?? result.n ?? 0,
      modified: result.modifiedCount ?? result.nModified ?? 0,
      driverId,
      batchId: finalBatchId || "",
      deliveryDate: date.toISOString(),
    });
  } catch (err) {
    console.error("PATCH /api/admin/orders/assign-driver 出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});
router.patch("/:id/assign-driver", requireAdmin, async (req, res) => {
  try {
    const orderId = String(req.params.id);
    const { driverId, deliveryDate } = req.body || {};

    if (!isValidObjectId(orderId)) {
      return res.status(400).json({ success: false, message: "订单ID格式不正确" });
    }
    if (!isValidObjectId(driverId)) {
      return res.status(400).json({ success: false, message: "driverId 不合法" });
    }

    const date = deliveryDate ? new Date(deliveryDate) : new Date();
    if (isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: "deliveryDate 不合法" });
    }

    const updated = await Order.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(orderId),
        status: { $nin: ["done", "cancel"] },
        settlementGenerated: { $ne: true },
      },
      {
        $set: {
          driverId: new mongoose.Types.ObjectId(driverId),
          deliveryDate: date,

          // ✅ 分配司机后：自动进入配送中
          status: "shipping",
          deliveryStatus: "delivering",
          assignedAt: new Date(),
          startedAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "订单不存在或不可派单" });
    }

    return res.json({ success: true, data: normalizeOrder(updated) });
  } catch (err) {
    console.error("PATCH /api/admin/orders/:id/assign-driver 出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});
// =====================================================
// ✅ 后台：更新订单状态（支持 delivered/delivering 等）
// PATCH /api/admin/orders/:id/status
// body: { status: "delivered" | "done" | ... }
// =====================================================
router.patch("/:id/status", requireAdmin, async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    if (!isValidObjectId(orderId)) {
      return res.status(400).json({ success: false, message: "订单ID格式不正确" });
    }

    const status = String(req.body?.status || "").trim().toLowerCase();

    const VALID_STATUSES = [
      "pending",
      "paid",
      "packing",
      "shipping",
      "delivering",
      "delivered",
      "done",
      "completed",
      "cancel",
      "cancelled",
    ];

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "非法订单状态：" + status });
    }

    const patch = { status };

    // ✅ 送达类状态：写入 deliveredAt（避免前端右上角显示乱）
    if (["delivered", "done", "completed"].includes(status)) {
      patch.deliveredAt = new Date();
      patch.deliveryStatus = "delivered";
    } else if (status === "delivering") {
      patch.deliveryStatus = "delivering";
    }

    const updated = await Order.findByIdAndUpdate(orderId, patch, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: "订单不存在：" + orderId });
    }

    return res.json({
      success: true,
      message: "订单状态更新成功（DB版）",
      order: normalizeOrder(updated),
    });
  } catch (err) {
    console.error("PATCH /api/admin/orders/:id/status DB 出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});
router.get("/drivers", async (req, res) => {
  try {
    const User = (await import("../models/user.js")).default;
    const list = await User.find({ role: "driver" })
      .select("_id name phone")
      .sort({ createdAt: -1 })
      .lean();

    const drivers = list.map((u) => ({
      id: u._id.toString(),
      name: u.name || "",
      phone: u.phone || "",
      label: `${u.name || "司机"} ${u.phone ? `(${u.phone})` : ""}`.trim(),
    }));

    res.json({ success: true, drivers });
  } catch (err) {
    console.error("GET /api/admin/orders/drivers 出错:", err);
    res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

router.get("/zones", async (req, res) => {
  try {
    const a = await Order.distinct("address.zoneId");
    const b = await Order.distinct("fulfillment.zoneId");

    const zones = Array.from(
      new Set([...(a || []), ...(b || [])].map((x) => String(x || "").trim()).filter(Boolean))
    ).sort();

    return res.json({ success: true, zones });
  } catch (err) {
    console.error("GET /api/admin/orders/zones error:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

export default router;
