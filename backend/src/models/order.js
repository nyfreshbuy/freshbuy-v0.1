// backend/src/models/order.js
import mongoose from "mongoose";
// =========================
// 工具函数
// =========================
function toDateOnlyYMD(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d) {
  const dt = d instanceof Date ? new Date(d) : new Date(d);
  if (Number.isNaN(dt.getTime())) return new Date();
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function addDays(d, n) {
  const dt = d instanceof Date ? new Date(d) : new Date(d);
  if (Number.isNaN(dt.getTime())) return new Date();
  dt.setDate(dt.getDate() + n);
  return dt;
}

function round2(n) {
  const x = Number(n || 0);
  return Math.round(x * 100) / 100;
}

// =========================
// 子 Schema
// =========================
const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" }, // DB _id
    legacyProductId: { type: String, default: "" }, // 兼容旧 products.js 的 id
    name: { type: String, default: "" },
    sku: { type: String, default: "" },
    price: { type: Number, default: 0 },
    qty: { type: Number, default: 1 },
    image: { type: String, default: "" },

    lineTotal: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },

    // ✅ 是否应税（用于 salesTax 计算）
    hasTax: { type: Boolean, default: false },
  },
  { _id: false }
);

// =========================
// 主 Schema
// =========================
const orderSchema = new mongoose.Schema(
  {
    orderNo: { type: String, index: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },

    deliveryType: { type: String, default: "home", index: true },

    // ✅ 配送方式（营销/前端展示，对应 mode）
    // normal / groupDay / dealsDay / friendGroup
    deliveryMode: {
      type: String,
      enum: ["normal", "groupDay", "dealsDay", "friendGroup"],
      default: "normal",
      index: true,
    },

    // ✅ 履约归类（兼容旧逻辑：爆品/区域团）
    fulfillment: {
      groupType: {
        type: String,
        enum: ["none", "zone_group"],
        default: "none",
        index: true,
      },
      zoneId: { type: String, default: "", index: true },
      batchKey: { type: String, default: "", index: true }, // e.g. 2025-12-28|zone:FM
      batchName: { type: String, default: "" },
    },

    // ✅ 新增：派单归类（用于“混合筛选 -> 路线 -> 派单”）
    // 任何 mode 只要能识别 zoneId，都能进入批次
    dispatch: {
      zoneId: { type: String, default: "", index: true },
      batchKey: { type: String, default: "", index: true }, // e.g. 2025-12-28|zone:FM
      batchName: { type: String, default: "" },
    },

    // ✅ 订单流转状态（物流/履约）
    status: {
      type: String,
      enum: ["pending", "paid", "packing", "shipping", "done", "completed", "cancel", "cancelled"],
      default: "pending",
      index: true,
    },

    orderType: {
      type: String,
      enum: ["normal", "area_group", "friend_group"],
      default: "normal",
      index: true,
    },

    // =========================================================
    // ✅ 支付系统字段
    // =========================================================
    payment: {
      status: {
        type: String,
        enum: ["unpaid", "requires_action", "paid", "failed", "refunded", "partial_refunded"],
        default: "unpaid",
        index: true,
      },

      method: {
        type: String,
        enum: ["none", "wallet", "stripe"],
        default: "none",
        index: true,
      },

      currency: { type: String, default: "USD" },

      // 金额快照（下单时锁定）
      amountSubtotal: { type: Number, default: 0 },
      amountDeliveryFee: { type: Number, default: 0 },

      // 税/平台费/小费
      amountTax: { type: Number, default: 0 },
      amountPlatformFee: { type: Number, default: 0 },
      amountTip: { type: Number, default: 0 },

      amountDiscount: { type: Number, default: 0 },
      amountTotal: { type: Number, default: 0 },

      // 实际支付记录
      paidTotal: { type: Number, default: 0 },
      walletPaid: { type: Number, default: 0 },
      stripePaid: { type: Number, default: 0 },

      // Stripe 相关
    
      stripeChargeId: { type: String, default: "" },
      stripeClientSecret: { type: String, default: "" },

      idempotencyKey: { type: String, default: "", index: true },

      paidAt: { type: Date, index: true },

      lastError: { type: String, default: "" },

      refundedTotal: { type: Number, default: 0 },
      refundedAt: { type: Date },
      refundReason: { type: String, default: "" },
      stripeRefundId: { type: String, default: "" },
    },

    // ✅ 兼容旧字段：paidAt（建议以后统一用 payment.paidAt）
    paidAt: { type: Date, index: true },

    marketing: {
      source: {
        type: String,
        enum: ["none", "coupon", "referral", "share", "campaign"],
        default: "none",
        index: true,
      },
      campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
      couponCode: { type: String, default: "" },
      referralCode: { type: String, default: "" },
    },

    // ✅ 订单金额（保留）
    subtotal: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },

    // ✅ 税/平台费/小费/应税小计（用于明细展示 & 对账）
    taxableSubtotal: { type: Number, default: 0 }, // 仅 hasTax=true 的商品小计
    salesTax: { type: Number, default: 0 }, // NY Sales Tax
    platformFee: { type: Number, default: 0 }, // 2% 平台服务费（仅 Stripe 时）
    tipFee: { type: Number, default: 0 }, // 小费

    // ✅ 可选：把税率留在订单上（方便对账）
    salesTaxRate: { type: Number, default: 0 }, // e.g. 0.08875

    // 兼容旧字段
    addressText: { type: String, default: "" },
    note: { type: String, default: "" },
// ✅ 打包/配货批次（用于“筛选 -> 打包 -> 打印贴纸/分配司机”）
packBatchId: { type: String, default: "", index: true }, // 例如 PK20260107-ABCD
packedAt: { type: Date, index: true },

    // ✅ 结构化地址
    address: {
      fullText: { type: String, default: "" },
      zip: { type: String, default: "", index: true },
      zoneId: { type: String, default: "", index: true },
      lat: { type: Number },
      lng: { type: Number },
    },

    items: { type: [orderItemSchema], default: [] },

    pickupPointName: { type: String, default: "" },

    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedAt: { type: Date, index: true }, // ✅ 管理员分配司机的时间
    leaderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    // ✅ 核心：实际配送日（路线/分批/派单只看这一天）
    deliveryDate: { type: Date, index: true },

    // ✅ 司机配送过程
    deliveryStatus: {
      type: String,
      enum: ["pending", "delivering", "delivered"],
      default: "pending",
      index: true,
    },
    startedAt: { type: Date, index: true },
    deliveryNote: { type: String, default: "" },
    deliveryPhotoUrl: { type: String, default: "" },

    deliveredAt: { type: Date, index: true },

    settlementGenerated: { type: Boolean, default: false, index: true },
    settlementId: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement", index: true },

    settlementSnapshot: {
      driverPay: { type: Number, default: 0 },
      leaderCommission: { type: Number, default: 0 },
      platformTake: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// =========================
// 索引
// =========================
orderSchema.index({ deliveryDate: 1, deliveryType: 1, status: 1 });
orderSchema.index({ driverId: 1, deliveryDate: 1, deliveryStatus: 1 });
orderSchema.index({ "address.zoneId": 1, deliveryDate: 1, status: 1 });

orderSchema.index({ deliveryMode: 1, createdAt: -1 });
orderSchema.index({ "fulfillment.batchKey": 1, deliveryDate: 1, status: 1 });
orderSchema.index({ "fulfillment.zoneId": 1, deliveryDate: 1, status: 1 });

// ✅ 新增：混合派单批次索引（强烈建议 admin_dispatch 用这个）
orderSchema.index({ "dispatch.batchKey": 1, deliveryDate: 1, status: 1 });
orderSchema.index({ "dispatch.zoneId": 1, deliveryDate: 1, status: 1 });

orderSchema.index({ "payment.status": 1, createdAt: -1 });
orderSchema.index({ "payment.method": 1, createdAt: -1 });
orderSchema.index({ "payment.stripePaymentIntentId": 1 });
orderSchema.index({ packBatchId: 1, status: 1, deliveryDate: 1 });

// =========================
// ✅ 核心：自动计算 deliveryDate + batchKey + 金额对齐
// =========================
// =========================
// ✅ 核心：自动计算 deliveryDate + batchKey + 金额对齐
// =========================
orderSchema.pre("validate", function () {
    // ✅ 如果已经被打包，强制保持 packing（避免后续 save 被别的逻辑覆盖）
  if (this.packBatchId && this.status === "paid") {
    this.status = "packing";
  }
  // 1) deliveryDate 规则
  if (!this.deliveryDate) {
    if (this.deliveryMode === "groupDay") {
      throw new Error("groupDay 订单必须指定 deliveryDate（区域团固定配送日）");
    }
    // normal / friendGroup / dealsDay：默认次日配送
    this.deliveryDate = startOfDay(addDays(new Date(), 1));
  } else {
    // 统一归零点（避免同一天不同时间导致筛选/分批出错）
    this.deliveryDate = startOfDay(this.deliveryDate);
  }

  // 2) zoneId 优先级：dispatch.zoneId / fulfillment.zoneId / address.zoneId
  const addrZone = String(this.address?.zoneId || "").trim();
  const zDispatch = String(this.dispatch?.zoneId || "").trim();
  const zFulfill = String(this.fulfillment?.zoneId || "").trim();
  const zoneId = zDispatch || zFulfill || addrZone || "";

  // 3) 统一生成 batchKey（派单/路线）
  const ymd = toDateOnlyYMD(this.deliveryDate);
  const batchKey = zoneId ? `${ymd}|zone:${zoneId}` : `${ymd}|zone:`;
  const batchName = zoneId ? `${ymd} ${zoneId}` : `${ymd}`;

  // 4) 写入 dispatch（✅ 所有订单都写，保证“混合”能看到）
  if (!this.dispatch) this.dispatch = {};
  this.dispatch.zoneId = zoneId;
  this.dispatch.batchKey = batchKey;
  if (!this.dispatch.batchName) this.dispatch.batchName = batchName;

  // 5) fulfillment（兼容旧逻辑 + 给你现在页面用）
  if (!this.fulfillment) this.fulfillment = {};
  this.fulfillment.zoneId = zoneId;

  if (zoneId && (this.deliveryMode === "dealsDay" || this.deliveryMode === "groupDay")) {
    this.fulfillment.groupType = "zone_group";
    this.fulfillment.batchKey = batchKey;
    if (!this.fulfillment.batchName) this.fulfillment.batchName = batchName;
  } else {
    this.fulfillment.groupType = "none";
    // 你原来选择 A：normal/friendGroup 也写 batchKey，方便前端不改
    this.fulfillment.batchKey = batchKey;
    if (!this.fulfillment.batchName) this.fulfillment.batchName = batchName;
  }

  // 6) items lineTotal & subtotal / taxableSubtotal
  let subtotal = 0;
  let taxableSubtotal = 0;

  for (const it of this.items || []) {
    const price = Number(it.price || 0);
    const qty = Math.max(1, Number(it.qty || 1));
    it.qty = qty;

    const lineTotal = round2(price * qty);
    it.lineTotal = lineTotal;

    subtotal += lineTotal;
    if (it.hasTax) taxableSubtotal += lineTotal;
  }

  this.subtotal = round2(subtotal);
  this.taxableSubtotal = round2(taxableSubtotal);

  // 7) salesTax（按 salesTaxRate）
  const rate = Number(this.salesTaxRate || 0);
  this.salesTax = round2(this.taxableSubtotal * rate);

  // 8) platformFee（只在 stripe 才收 2%）
  const method = String(this.payment?.method || "none");
  const shouldPlatformFee = method === "stripe";

  if (!Number.isFinite(Number(this.platformFee))) this.platformFee = 0;
  if (shouldPlatformFee) {
    const base =
      Number(this.subtotal || 0) +
      Number(this.deliveryFee || 0) +
      Number(this.salesTax || 0) -
      Number(this.discount || 0);
    this.platformFee = round2(Math.max(0, base) * 0.02);
  } else {
    this.platformFee = round2(Number(this.platformFee || 0));
  }

  // 9) tipFee
  this.tipFee = round2(Number(this.tipFee || 0));

  // 10) totalAmount
  const total =
    Number(this.subtotal || 0) +
    Number(this.deliveryFee || 0) +
    Number(this.salesTax || 0) +
    Number(this.platformFee || 0) +
    Number(this.tipFee || 0) -
    Number(this.discount || 0);

  this.totalAmount = round2(Math.max(0, total));

  // 11) payment 金额快照对齐
  if (!this.payment) this.payment = {};
  this.payment.amountSubtotal = round2(this.subtotal);
  this.payment.amountDeliveryFee = round2(this.deliveryFee);
  this.payment.amountTax = round2(this.salesTax);
  this.payment.amountPlatformFee = round2(this.platformFee);
  this.payment.amountTip = round2(this.tipFee);
  this.payment.amountDiscount = round2(this.discount);
  this.payment.amountTotal = round2(this.totalAmount);
});
// =========================
// 导出（防止 OverwriteModelError）
// =========================
export default mongoose.models.Order || mongoose.model("Order", orderSchema);
