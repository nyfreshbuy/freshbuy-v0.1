// backend/src/routes/driver_orders.js
import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import multer from "multer";
import Twilio from "twilio";
import Order from "../models/order.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();

// JSON 只影响 application/json，不影响 multipart 上传
router.use(express.json());

// ✅ 全局要求登录（你也可以不全局用，下面我每个路由都加了 requireLogin，二选一）
// router.use(requireLogin);

console.log("🚚 driver_orders.js loaded ✅ VERSION=2026-01-15-FINAL");

// =====================================================
// ✅ Twilio + 公网链接（短信里必须是完整 URL）
// 环境变量：
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN
// - TWILIO_FROM
// - APP_BASE_URL   例：https://nyfreshbuy.com
// =====================================================
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_FROM || "";
const APP_BASE_URL = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// US 电话转 E164：+1XXXXXXXXXX
function toE164US(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return "";
}

// 相对路径 -> 绝对 URL（短信用）
function absUrl(maybePath) {
  const s = String(maybePath || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (!APP_BASE_URL) return s;
  return APP_BASE_URL + (s.startsWith("/") ? s : "/" + s);
}

// =====================================================
// ✅ 上传：送达照片（存本地 uploads/delivery）
// 你 server.js 已经有：app.use("/uploads", express.static(...)) ✅
// =====================================================
const UPLOAD_DIR = path.resolve("uploads/delivery");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const extRaw = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(extRaw) ? extRaw : ".jpg";
    cb(null, `proof_${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`);
  },
});
const upload = multer({ storage });

// =====================================================
// 权限：司机（或管理员）
// =====================================================
function requireDriver(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "未登录" });
  if (req.user.role !== "driver" && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "需要司机权限" });
  }
  next();
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

function oid(id) {
  return new mongoose.Types.ObjectId(String(id));
}

// =====================================================
// 工具：YYYY-MM-DD -> 当天范围（本地时区）
// =====================================================
function parseYMDToRange(dateStr) {
  const s = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const start = new Date(s + "T00:00:00.000");
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function toYMD(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// =====================================================
// 兼容：routeIndex 读取（你说要“送货先后顺序序列号”）
// =====================================================
function getRouteIndexFromOrder(o) {
  const v =
    o?.dispatch?.routeIndex ??
    o?.fulfillment?.routeIndex ??
    o?.routeIndex ??
    o?.route_index ??
    o?.routeSeq ??
    o?.sequenceNumber ??
    o?.sequenceNo ??
    o?.seq ??
    null;

  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 兜底路线排序：先 lng 再 lat（简易，足够用于“序号”）
function sortForRouteFallback(orders) {
  return [...orders].sort((a, b) => {
    const alng = Number(a?.address?.lng ?? a?.lng ?? 0);
    const blng = Number(b?.address?.lng ?? b?.lng ?? 0);
    if (alng !== blng) return alng - blng;

    const alat = Number(a?.address?.lat ?? a?.lat ?? 0);
    const blat = Number(b?.address?.lat ?? b?.lat ?? 0);
    return alat - blat;
  });
}

// 有 routeIndex 就按 routeIndex；否则 fallback
function sortForRoute(orders) {
  const withIdx = orders.map((o) => ({ o, idx: getRouteIndexFromOrder(o) }));
  const hasAnyIdx = withIdx.some((x) => x.idx != null);

  if (hasAnyIdx) {
    return withIdx
      .sort((a, b) => {
        const ai = a.idx ?? 999999;
        const bi = b.idx ?? 999999;
        if (ai !== bi) return ai - bi;
        const at = new Date(a.o?.createdAt || 0).getTime();
        const bt = new Date(b.o?.createdAt || 0).getTime();
        return at - bt;
      })
      .map((x) => x.o);
  }
  return sortForRouteFallback(orders);
}

// =====================================================
// ✅ driver 匹配（兼容 driverId/dispatch/fulfillment/phone/name）
// =====================================================
function buildDriverMatch(req) {
  const uid = String(req.user?.id || req.user?._id || "").trim();
  const phone = String(req.user?.phone || req.user?.mobile || "").trim();
  const name = String(req.user?.name || req.user?.nickname || req.user?.nick || "").trim();

  const or = [];

  // driverId as ObjectId
  if (isValidObjectId(uid)) {
    const o = oid(uid);
    or.push({ driverId: o }, { "dispatch.driverId": o }, { "fulfillment.driverId": o });
  }

  // driverId as string
  if (uid) {
    or.push({ driverId: uid }, { "dispatch.driverId": uid }, { "fulfillment.driverId": uid });
  }

  // phone
  if (phone) {
    or.push({ driverPhone: phone }, { "dispatch.driverPhone": phone }, { "fulfillment.driverPhone": phone });
  }

  // name
  if (name) {
    or.push({ driverName: name }, { "dispatch.driverName": name }, { "fulfillment.driverName": name });
  }

  return or.length ? { $or: or } : null;
}

// =====================================================
// 输出格式（给前端用）
// =====================================================
function normalizeOrderOut(o, routeIndexComputed = null) {
  const storedRouteIndex = getRouteIndexFromOrder(o);

  return {
    id: String(o._id),
    orderNo: o.orderNo || String(o._id),

    status: o.status || "",
    deliveryStatus: o.deliveryStatus || "",

    deliveryMode: o.deliveryMode || "",
    fulfillment: o.fulfillment || null,
    dispatch: o.dispatch || null,
    deliveryDate: o.deliveryDate || null,

    customerName: o.customerName || o.userName || "",
    customerPhone: o.customerPhone || o.userPhone || o.phone || "",

    address: o.address || null,
    addressText: o.addressText || o.fullAddress || "",
    note: o.note || "",

    totalAmount: Number(o.totalAmount ?? o.total ?? o.payment?.amountTotal ?? 0),

    // ⭐ 送货先后顺序序号：routeIndex
    routeIndex: storedRouteIndex ?? routeIndexComputed,

    deliveredAt: o.deliveredAt || null,

    // proofPhotos: [{url,uploadedAt,uploadedBy}] 或 string 兼容
    proofPhotos: Array.isArray(o.proofPhotos) ? o.proofPhotos : [],
  };
}

// =====================================================
// 0) ping（排查用）
// GET /api/driver/orders/ping
// =====================================================
router.get("/ping", requireLogin, requireDriver, (req, res) => {
  res.json({ success: true, message: "driver_orders ping ok", user: { id: String(req.user?._id || ""), role: req.user?.role } });
});

// =====================================================
// 1) 上传送达照片
// POST /api/driver/orders/:id/proof-photo
// form-data: file
// =====================================================
router.post("/:id/proof-photo", requireLogin, requireDriver, upload.single("file"), async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    if (!isValidObjectId(orderId)) return res.status(400).json({ success: false, message: "订单ID不合法" });
    if (!req.file) return res.status(400).json({ success: false, message: "缺少图片文件 file" });

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const urlPath = `/uploads/delivery/${req.file.filename}`;

    const updated = await Order.findOneAndUpdate(
      { _id: oid(orderId), ...driverMatch },
      {
        $push: {
          proofPhotos: {
            url: urlPath,
            uploadedAt: new Date(),
            uploadedBy: req.user._id,
          },
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ success: false, message: "订单不存在或无权限" });

    return res.json({
      success: true,
      orderId,
      url: urlPath,
      absoluteUrl: absUrl(urlPath),
    });
  } catch (err) {
    console.error("POST /api/driver/orders/:id/proof-photo error:", err);
    return res.status(500).json({ success: false, message: "上传失败" });
  }
});

// =====================================================
// 2) 标记送达（并自动短信通知客户）
// PATCH /api/driver/orders/:id/mark-delivered
// body: { note?: string }
// =====================================================
async function markDeliveredCore(req, res) {
  const orderId = String(req.params.id || "").trim();
  if (!isValidObjectId(orderId)) return res.status(400).json({ success: false, message: "订单ID不合法" });

  const driverMatch = buildDriverMatch(req);
  if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

  const note = String(req.body?.note || "").trim();

  const o = await Order.findOne({ _id: oid(orderId), ...driverMatch });
  if (!o) return res.status(404).json({ success: false, message: "订单不存在或无权限" });

  const prevStatus = String(o.status || "").toLowerCase();
  const alreadyDelivered = ["delivered", "done", "completed"].includes(prevStatus);

  // ✅ 写入送达（后台同步）
  o.status = "done";                 // 统一 done
  o.deliveryStatus = "delivered";
  o.deliveredAt = new Date();
  o.deliveredBy = req.user._id;
  if (note) o.deliveryNote = note;

  await o.save();

    // ✅ 送达后再从 DB 重新读一次（确保拿到最新 proofPhotos）
  const fresh = await Order.findById(o._id).select("proofPhotos").lean();

  const proofArr = Array.isArray(fresh?.proofPhotos) ? fresh.proofPhotos : [];
  const last = proofArr.length ? proofArr[proofArr.length - 1] : null;

  // ✅ 强制要求先上传送达照片，否则不允许标记送达（保证短信一定带链接）
  if (!last) {
    return res.status(400).json({
      success: false,
      message: "请先上传送达照片，再点击已送达（短信会自动带照片链接）",
    });
  }

  // 兼容 last 可能是 string 或 {url:...}
  const lastUrl = typeof last === "string" ? last : (last?.url || "");
  const photoUrl = absUrl(lastUrl);
  // 客户手机号（兼容字段）
  const rawPhone =
    o?.user?.phone ||
    o?.customerPhone ||
    o?.userPhone ||
    o?.phone ||
    (o?.shippingAddress && o.shippingAddress.phone) ||
    (o?.address && o.address.phone) ||
    "";

  const to = toE164US(rawPhone);

  let smsSent = false;
  let smsError = "";

  // ✅ 防重复：已经送达过就不再发短信
  if (!alreadyDelivered && twilioClient && TWILIO_FROM && to) {
    const orderNo = o.orderNo || o.no || String(o._id || "").slice(-6);
    const addr =
      (typeof o.address === "string" && o.address) ||
      o.addressText ||
      o.fullAddress ||
      (o.address && o.address.fullText) ||
      "";

    const text =
  `【在鲜购 Freshbuy】您的订单已送达 ✅\n` +
  `订单号：${orderNo}\n` +
  (addr ? `地址：${addr}\n` : "") +
  (photoUrl ? `送达照片：${photoUrl}\n` : "") +
  `回复 STOP 退订，HELP 获取帮助。Msg&Data rates may apply.`;
    try {
      await twilioClient.messages.create({
        from: TWILIO_FROM,
        to,
        body: text,
        // 如果你用的是支持彩信的号码，可打开：
        // mediaUrl: photoUrl ? [photoUrl] : undefined,
      });

      smsSent = true;
      o.deliverySms = o.deliverySms || {};
      o.deliverySms.sentAt = new Date();
      o.deliverySms.to = to;
      o.deliverySms.photoUrl = photoUrl;
      await o.save().catch(() => {});
    } catch (err) {
      smsError = err?.message || "send sms failed";
      console.error("❌ delivery sms failed:", smsError);
    }
  }

  return res.json({
    success: true,
    orderId,
    status: o.status,
    deliveryStatus: o.deliveryStatus,
    deliveredAt: o.deliveredAt,
    photoUrl,
    smsSent,
    smsError,
  });
}

router.patch("/:id/mark-delivered", requireLogin, requireDriver, async (req, res) => {
  try {
    return await markDeliveredCore(req, res);
  } catch (err) {
    console.error("PATCH /api/driver/orders/:id/mark-delivered error:", err);
    return res.status(500).json({ success: false, message: "标记送达失败" });
  }
});

// =====================================================
// 3) 批次列表（当天）
// GET /api/driver/orders/batches?date=YYYY-MM-DD&status=...
// =====================================================
router.get("/batches", requireLogin, requireDriver, async (req, res) => {
  try {
    const date = String(req.query.date || "").trim() || toYMD(new Date());
    const range = parseYMDToRange(date);
    if (!range) return res.status(400).json({ success: false, message: "date 必须是 YYYY-MM-DD" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping", "delivering", "delivered", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const rows = await Order.aggregate([
      {
        $match: {
          ...driverMatch,
          status: { $in: statusList },
          $or: [
            { deliveryDate: { $gte: range.start, $lt: range.end } },
            { deliveryDate: { $exists: false }, createdAt: { $gte: range.start, $lt: range.end } },
            { deliveryDate: null, createdAt: { $gte: range.start, $lt: range.end } },
          ],
        },
      },
      {
        $project: {
          batchKey: {
            $ifNull: ["$batchId", { $ifNull: ["$dispatch.batchKey", "$fulfillment.batchKey"] }],
          },
        },
      },
      { $match: { batchKey: { $type: "string", $ne: "" } } },
      { $group: { _id: "$batchKey", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const batches = rows.map((r) => ({ batchKey: String(r._id), count: Number(r.count || 0) }));
    return res.json({ success: true, date, total: batches.length, batches });
  } catch (err) {
    console.error("GET /api/driver/orders/batches error:", err);
    return res.status(500).json({ success: false, message: "获取批次失败" });
  }
});

// =====================================================
// 4) 按批次拉单
// GET /api/driver/orders/batch/orders?batchKey=...&status=...
// =====================================================
router.get("/batch/orders", requireLogin, requireDriver, async (req, res) => {
  try {
    const batchKey = String(req.query.batchKey || "").trim();
    if (!batchKey) return res.status(400).json({ success: false, message: "batchKey 必填" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping", "delivering", "delivered", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const orders = await Order.find({
      ...driverMatch,
      status: { $in: statusList },
      $or: [{ batchId: batchKey }, { "dispatch.batchKey": batchKey }, { "fulfillment.batchKey": batchKey }],
    })
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders);
    const hasAnyIdx = sorted.some((o) => getRouteIndexFromOrder(o) != null);

    return res.json({
      success: true,
      batchKey,
      total: sorted.length,
      orders: sorted.map((o, i) => normalizeOrderOut(o, hasAnyIdx ? null : i + 1)),
    });
  } catch (err) {
    console.error("GET /api/driver/orders/batch/orders error:", err);
    return res.status(500).json({ success: false, message: "按批次获取失败" });
  }
});

// =====================================================
// 5) 按天任务列表
// GET /api/driver/orders?date=YYYY-MM-DD&status=...
// =====================================================
router.get("/", requireLogin, requireDriver, async (req, res) => {
  try {
    const date = String(req.query.date || "").trim() || toYMD(new Date());
    const range = parseYMDToRange(date);
    if (!range) return res.status(400).json({ success: false, message: "date 必须是 YYYY-MM-DD" });

    const statusRaw = String(req.query.status || "").trim();
    const statusList = statusRaw
      ? statusRaw.split(",").map((x) => x.trim()).filter(Boolean)
      : ["paid", "packing", "shipping", "delivering", "delivered", "done", "completed"];

    const driverMatch = buildDriverMatch(req);
    if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

    const orders = await Order.find({
      ...driverMatch,
      status: { $in: statusList },
      $or: [
        { deliveryDate: { $gte: range.start, $lt: range.end } },
        { deliveryDate: { $exists: false }, createdAt: { $gte: range.start, $lt: range.end } },
        { deliveryDate: null, createdAt: { $gte: range.start, $lt: range.end } },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

    const sorted = sortForRoute(orders);
    const hasAnyIdx = sorted.some((o) => getRouteIndexFromOrder(o) != null);

    return res.json({
      success: true,
      date,
      total: sorted.length,
      orders: sorted.map((o, i) => normalizeOrderOut(o, hasAnyIdx ? null : i + 1)),
    });
  } catch (err) {
    console.error("GET /api/driver/orders error:", err);
    return res.status(500).json({ success: false, message: "获取司机任务失败" });
  }
});

// =====================================================
// 6) 更新订单状态（对齐你前端一直在打的接口）
// PATCH /api/driver/orders/:id/status   { status: "delivering"|"delivered"|"done" }
// 并兼容：PATCH /:id/delivered（旧前端）
// =====================================================
async function driverUpdateStatus(req, res, statusOverride) {
  const orderId = String(req.params.id || "").trim();
  if (!isValidObjectId(orderId)) {
    return res.status(400).json({ success: false, message: "订单ID不合法" });
  }

  const status = String(statusOverride || req.body?.status || "").trim().toLowerCase();
  const ALLOWED = ["delivering", "delivered", "done"];
  if (!ALLOWED.includes(status)) {
    return res.status(400).json({ success: false, message: "不允许的状态：" + status });
  }

  const driverMatch = buildDriverMatch(req);
  if (!driverMatch) return res.status(401).json({ success: false, message: "用户信息异常" });

  const patch = {};

  if (status === "delivering") {
    patch.status = "shipping";
    patch.deliveryStatus = "delivering";
  }

  if (status === "delivered" || status === "done") {
    patch.status = "done";
    patch.deliveryStatus = "delivered";
    patch.deliveredAt = new Date();
  }

  const updated = await Order.findOneAndUpdate(
    { _id: oid(orderId), ...driverMatch },
    { $set: patch },
    { new: true }
  ).lean();

  if (!updated) {
    return res.status(404).json({ success: false, message: "订单不存在或无权限" });
  }

  return res.json({
    success: true,
    message: "司机端状态更新成功",
    data: {
      id: updated._id.toString(),
      status: updated.status,
      deliveryStatus: updated.deliveryStatus || "",
      deliveredAt: updated.deliveredAt || null,
    },
  });
}

router.patch("/:id/status", requireLogin, requireDriver, async (req, res) => {
  try {
    return await driverUpdateStatus(req, res);
  } catch (err) {
    console.error("PATCH /api/driver/orders/:id/status error:", err);
    return res.status(500).json({ success: false, message: "司机更新状态失败" });
  }
});

// 兼容旧前端：PATCH /api/driver/orders/:id/delivered
router.patch("/:id/delivered", requireLogin, requireDriver, async (req, res) => {
  try {
    return await driverUpdateStatus(req, res, "delivered");
  } catch (err) {
    console.error("PATCH /api/driver/orders/:id/delivered error:", err);
    return res.status(500).json({ success: false, message: "司机标记送达失败" });
  }
});

// 兼容旧前端：如果前端打 /:id/status 并传 delivered，你也能用 mark-delivered（发短信）
router.patch("/:id/delivered-and-sms", requireLogin, requireDriver, async (req, res) => {
  try {
    // 这个接口专门为了“送达+发短信”
    return await markDeliveredCore(req, res);
  } catch (err) {
    console.error("PATCH /api/driver/orders/:id/delivered-and-sms error:", err);
    return res.status(500).json({ success: false, message: "标记送达失败" });
  }
});

export default router;
