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
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    legacyProductId: { type: String, default: "" },
    name: { type: String, default: "" },
    sku: { type: String, default: "" },
    price: { type: Number, default: 0 },
    qty: { type: Number, default: 1 },
    image: { type: String, default: "" },
    lineTotal: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    hasTax: { type: Boolean, default: false },

    // ✅ 兼容旧字段（有些前端会传 taxable / isSpecial 等）
    taxable: { type: Boolean, default: false },
    isSpecial: { type: Boolean, default: false },
    tag: { type: String, default: "" },
    type: { type: String, default: "" },
  },
  { _id: false }
);

// =========================
// 主 Schema
// =========================
const orderSchema = new mongoose.Schema(
  {
    orderNo: { type: String, index: true },

    // ✅ 用户归属（用户中心“我的订单”靠它）
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "", index: true },

    deliveryType: { type: String, default: "home", index: true },

    deliveryMode: {
      type: String,
      enum: ["normal", "groupDay", "dealsDay", "friendGroup"],
      default: "normal",
      index: true,
    },

    fulfillment: {
      groupType: {
        type: String,
        enum: ["none", "zone_group"],
        default: "none",
        index: true,
      },
      zoneId: { type: String, default: "", index: true },
      batchKey: { type: String, default: "", index: true },
      batchName: { type: String, default: "" },
    },

    dispatch: {
      zoneId: { type: String, default: "", index: true },
      batchKey: { type: String, default: "", index: true },
      batchName: { type: String, default: "" },
    },

    status: {
      type: String,
      enum: ["pending", "paid", "packing", "shipping", "done", "completed", "cancel", "cancelled"],
      default: "pending",
      index: true,
    },

    // =========================================================
    // ✅ 统一支付结构（唯一）
    // =========================================================
    payment: {
      status: {
        type: String,
        // ✅ 扩展：Stripe 分阶段状态
        enum: [
          "unpaid",
          "requires_payment_method",
          "requires_action",
          "processing",
          "failed",
          "paid",
          "refunded",
        ],
        default: "unpaid",
        index: true,
      },

      method: {
        type: String,
        enum: ["stripe", "wallet", "zelle", "none"],
        default: "none",
        index: true,
      },

      // ✅ 幂等键（你前端 intentKey 推荐存到这）
      idempotencyKey: { type: String, default: "", index: true },

      // ✅ 更语义化的字段（建议和 idempotencyKey 同步写）
      intentKey: { type: String, default: "", index: true },

      // ✅ 金额总额（支付快照 + 对账）
      amountTotal: { type: Number, default: 0 },
      paidTotal: { type: Number, default: 0 },

      // ✅ Stripe 补全字段（你 pay_stripe.js / webhook 用得到）
      stripePaymentIntentId: { type: String, default: "", index: true },
      stripeClientSecret: { type: String, default: "" },
      stripeChargeId: { type: String, default: "" },

      // ✅ 兼容你原先的 stripe 子结构（保留不破坏历史数据）
      stripe: {
        intentId: { type: String, default: "", index: true },
        paid: { type: Number, default: 0 },
      },

      wallet: {
        paid: { type: Number, default: 0 },
      },

      zelle: {
        paid: { type: Number, default: 0 },
        reference: { type: String, default: "" },
        confirmedBy: { type: String, default: "" },
        confirmedAt: Date,
      },

      // ✅ 错误信息
      lastError: { type: String, default: "" },

      // ✅ 支付时间（payment 内也留一份）
      paidAt: Date,

      // 金额快照（由 pre-validate 自动写入）
      amountSubtotal: { type: Number, default: 0 },
      amountDeliveryFee: { type: Number, default: 0 },
      amountTax: { type: Number, default: 0 },
      amountPlatformFee: { type: Number, default: 0 },
      amountTip: { type: Number, default: 0 },
      amountDiscount: { type: Number, default: 0 },
    },

    // ✅ 根字段 paidAt（你现有代码在用）
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

    subtotal: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },

    taxableSubtotal: { type: Number, default: 0 },
    salesTax: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    tipFee: { type: Number, default: 0 },
    salesTaxRate: { type: Number, default: 0 },

    addressText: { type: String, default: "" },
    note: { type: String, default: "" },

    packBatchId: { type: String, default: "", index: true },
    packedAt: { type: Date, index: true },

    address: {
      fullText: { type: String, default: "" },
      zip: { type: String, default: "", index: true },
      zoneId: { type: String, default: "", index: true },
      lat: Number,
      lng: Number,
    },

    items: { type: [orderItemSchema], default: [] },

    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    assignedAt: { type: Date, index: true },
    leaderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    deliveryDate: { type: Date, index: true },

    deliveryStatus: {
      type: String,
      enum: ["pending", "delivering", "delivered"],
      default: "pending",
      index: true,
    },

    deliveredAt: { type: Date, index: true },

    settlementGenerated: { type: Boolean, default: false, index: true },
    settlementId: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement", index: true },
  },
  { timestamps: true }
);

// =========================
// 索引
// =========================
orderSchema.index({ deliveryDate: 1, status: 1 });
orderSchema.index({ "dispatch.batchKey": 1, deliveryDate: 1, status: 1 });
orderSchema.index({ "dispatch.zoneId": 1, deliveryDate: 1, status: 1 });
orderSchema.index({ "payment.status": 1, createdAt: -1 });
orderSchema.index({ "payment.method": 1, createdAt: -1 });

// ✅ Stripe 两套字段都建索引（兼容历史 + 新版）
orderSchema.index({ "payment.stripe.intentId": 1 });
orderSchema.index({ "payment.stripePaymentIntentId": 1 });
orderSchema.index({ "payment.idempotencyKey": 1 });
orderSchema.index({ "payment.intentKey": 1 });

// =========================
// pre-validate：金额 / 批次 / 派单统一
// =========================
orderSchema.pre("validate", function () {
  // ✅ paid 且已有 packBatchId => packing
  if (this.packBatchId && this.status === "paid") {
    this.status = "packing";
  }

  // ✅ deliveryDate 默认次日，统一归零点
  if (!this.deliveryDate) {
    this.deliveryDate = startOfDay(addDays(new Date(), 1));
  } else {
    this.deliveryDate = startOfDay(this.deliveryDate);
  }

  // ✅ zoneId：dispatch/fulfillment/address 三者统一
  const zoneId = this.dispatch?.zoneId || this.fulfillment?.zoneId || this.address?.zoneId || "";

  const ymd = toDateOnlyYMD(this.deliveryDate);
  const batchKey = `${ymd}|zone:${zoneId || ""}`;
  const batchName = zoneId ? `${ymd} ${zoneId}` : ymd;

  this.dispatch ||= {};
  this.dispatch.zoneId = zoneId;
  this.dispatch.batchKey = batchKey;
  this.dispatch.batchName ||= batchName;

  this.fulfillment ||= {};
  this.fulfillment.zoneId = zoneId;
  this.fulfillment.batchKey = batchKey;
  this.fulfillment.batchName ||= batchName;

  // ✅ items 重算
  let subtotal = 0;
  let taxableSubtotal = 0;

  for (const it of this.items || []) {
    const qty = Math.max(1, Number(it.qty || 1));
    it.qty = qty;
    it.lineTotal = round2(Number(it.price || 0) * qty);
    subtotal += it.lineTotal;

    // hasTax 优先，其次 taxable 兼容
    const hasTax = !!it.hasTax || !!it.taxable;
    it.hasTax = hasTax;
    if (hasTax) taxableSubtotal += it.lineTotal;
  }

  this.subtotal = round2(subtotal);
  this.taxableSubtotal = round2(taxableSubtotal);

  // ✅ salesTax
  this.salesTax = round2(this.taxableSubtotal * Number(this.salesTaxRate || 0));

  // ✅ platformFee：只要是 stripe 就收 2%
  const method = this.payment?.method || "none";
  const shouldPlatformFee = method === "stripe";

  if (shouldPlatformFee) {
    const base = this.subtotal + this.deliveryFee + this.salesTax - this.discount;
    this.platformFee = round2(base * 0.02);
  } else {
    this.platformFee = round2(this.platformFee || 0);
  }

  this.tipFee = round2(this.tipFee || 0);

  // ✅ 总额
  this.totalAmount = round2(
    this.subtotal + this.deliveryFee + this.salesTax + this.platformFee + this.tipFee - this.discount
  );

  // ✅ payment 快照
  this.payment ||= {};
  this.payment.amountSubtotal = this.subtotal;
  this.payment.amountDeliveryFee = this.deliveryFee;
  this.payment.amountTax = this.salesTax;
  this.payment.amountPlatformFee = this.platformFee;
  this.payment.amountTip = this.tipFee;
  this.payment.amountDiscount = this.discount;
  this.payment.amountTotal = this.totalAmount;

  // ✅ 同步 intentKey <-> idempotencyKey（可选但强烈建议）
  if (!this.payment.intentKey && this.payment.idempotencyKey) {
    this.payment.intentKey = this.payment.idempotencyKey;
  }
  if (!this.payment.idempotencyKey && this.payment.intentKey) {
    this.payment.idempotencyKey = this.payment.intentKey;
  }

  // ✅ 同步 stripePaymentIntentId <-> stripe.intentId（兼容两套字段）
  if (!this.payment.stripePaymentIntentId && this.payment.stripe?.intentId) {
    this.payment.stripePaymentIntentId = this.payment.stripe.intentId;
  }
  if (this.payment.stripePaymentIntentId && (!this.payment.stripe || !this.payment.stripe.intentId)) {
    this.payment.stripe ||= {};
    this.payment.stripe.intentId = this.payment.stripePaymentIntentId;
  }
});

// =========================
// 导出
// =========================
export default mongoose.models.Order || mongoose.model("Order", orderSchema);
