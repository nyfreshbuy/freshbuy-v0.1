// backend/src/models/Coupon.js
import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    // 绑定到用户（你路由里用 req.user.id 来查）
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },

    // 你的 routes/coupons.js 里用的是 value/title/tag/scope/condition/minSpend/expiresAt/status
    value: { type: Number, required: true },
    title: { type: String, default: "优惠券" },
    tag: { type: String, default: "" }, // 如 "新客"
    scope: { type: String, default: "all" }, // all / dealsDay / groupDay ...
    condition: { type: String, default: "无门槛" },
    minSpend: { type: Number, default: 0 },

    // ✅ 注意这里字段名要叫 expiresAt（和你 routes/coupons.js 一致）
    expiresAt: { type: Date, default: null },

    // active / used / expired
    status: { type: String, default: "active", index: true },
  },
  { timestamps: true }
);

// ✅ 防止开发环境热重载重复注册
export default mongoose.models.Coupon || mongoose.model("Coupon", couponSchema);
