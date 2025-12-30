// backend/src/models/ShippingConfig.js
import mongoose from "mongoose";

const friendTierSchema = new mongoose.Schema(
  {
    size: Number,   // 人数
    fee: Number,    // 对每个人的运费
  },
  { _id: false }
);

const shippingConfigSchema = new mongoose.Schema(
  {
    // 固定用一个 id，方便直接 findById
    _id: { type: String, default: "default" },

    singleFee: { type: Number, default: 4.99 },    // 普通配送
    pickupFee: { type: Number, default: 0.99 },    // 自提点
    areaFee: { type: Number, default: 0 },         // 区域团免运费

    friendTiers: {
      type: [friendTierSchema],
      default: [
        { size: 2, fee: 2.5 },
        { size: 3, fee: 2.0 },
        { size: 4, fee: 1.5 },
      ],
    },
  },
  { _id: false, timestamps: true }
);

export default mongoose.model("ShippingConfig", shippingConfigSchema, "shipping_config");
