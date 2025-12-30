// backend/src/models/Coupon.js
import mongoose from "mongoose";

const CouponSchema = new mongoose.Schema(
  {
    // ✅ 发给谁（我的优惠券 /api/coupons/my 用到）
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: false, // 后台通用券/营销券可以不填
    },

    // 展示字段
    title: { type: String, default: "优惠券" },
    tag: { type: String, default: "" }, // 比如 新客 / 爆品日 / 充值赠送
    scope: { type: String, default: "all" }, // all / friday / category / product
    condition: { type: String, default: "无门槛" },

    // ✅ 金额券
    value: { type: Number, default: 0, min: 0 },     // 你 /api/coupons/my 用 value
    minSpend: { type: Number, default: 0, min: 0 },  // 你 /api/coupons/my 用 minSpend

    // 状态：active/used/expired/disabled
    status: { type: String, default: "active", index: true },

    // 过期时间（你 routes/coupons.js 用 expiresAt）
    expiresAt: { type: Date, default: null, index: true },

    // 使用信息
    usedAt: { type: Date, default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  },
  { timestamps: true }
);

// ✅ 关键：一定要导出 mongoose model（否则 Coupon.find 不是函数）
export default mongoose.models.Coupon || mongoose.model("Coupon", CouponSchema);
