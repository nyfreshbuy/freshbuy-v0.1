// backend/src/models/Address.js
import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 收货人：名 / 姓
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },

    // 电话（可选）
    phone: { type: String, trim: true },

    // 美国地址
    street1: { type: String, required: true, trim: true }, // Street Address
    apt: { type: String, trim: true, default: "" },        // Apt/Suite (optional)
    city: { type: String, required: true, trim: true },
    state: {
      type: String,
      required: true,
      trim: true,
      uppercase: true, // ✅ 自动转大写 NY/NJ
      validate: {
        validator: (v) => /^[A-Z]{2}$/.test(String(v || "").trim()),
        message: "state 必须是两位州缩写（如 NY）",
      },
    },
    zip: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => /^\d{5}(-\d{4})?$/.test(String(v || "").trim()),
        message: "ZIP 格式不正确（应为 11365 或 11365-1234）",
      },
    },

    // ✅ 地址验证信息（结算页 Places 选择后写入）
    placeId: { type: String, trim: true, default: "", index: true },
    formattedAddress: { type: String, trim: true, default: "" },

    isDefault: { type: Boolean, default: false, index: true },

    // 可选扩展字段（以后接 Google geocode / 司机路线）
    lat: { type: Number },
    lng: { type: Number },

    // 备注（保持兼容你原逻辑）
    note: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// ✅ 常用查询：我的地址 + 默认优先 + 最近更新
addressSchema.index({ userId: 1, isDefault: -1, updatedAt: -1 });

// ✅ 去重/加速：同一用户同一 placeId（不强制唯一，避免不同人/同人重复 placeId 的边缘情况）
addressSchema.index({ userId: 1, placeId: 1 });

// ✅ 可选：同一用户同一地址文本（用于你现有 where 组合的加速）
addressSchema.index({ userId: 1, street1: 1, apt: 1, city: 1, state: 1, zip: 1 });

export default mongoose.models.Address || mongoose.model("Address", addressSchema);

