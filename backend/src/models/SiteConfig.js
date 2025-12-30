import mongoose from "mongoose";

const siteConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, index: true }, // 固定用 "default"
    // 运费/模式开关
    shipping: {
      baseFee: { type: Number, default: 4.99 }, // 单人次日运费
      pickupFee: { type: Number, default: 0.99 },
      freeShipThreshold: { type: Number, default: 49.99 }, // 满免（如果你用）
      enabledModes: {
        single: { type: Boolean, default: true },
        friend: { type: Boolean, default: true },
        area: { type: Boolean, default: true },
        pickup: { type: Boolean, default: true },
      },
    },

    // 好友拼单阶梯
    friendShipping: {
      enabled: { type: Boolean, default: true },
      expireMinutes: { type: Number, default: 15 },
      steps: {
        type: [{ people: Number, price: Number, minSpend: Number }],
        default: [
          { people: 2, price: 2.5, minSpend: 40 },
          { people: 3, price: 2.0, minSpend: 35 },
          { people: 4, price: 0.0, minSpend: 30 },
        ],
      },
    },

    // 区域团（按你项目逻辑）
    areaGroup: {
      enabled: { type: Boolean, default: true },
      minSpend: { type: Number, default: 50 }, // 你常用的最低消费
      freeShip: { type: Boolean, default: true },
    },

    // 平台基础信息（可选）
    meta: {
      brandName: { type: String, default: "在鲜购拼好货" },
      supportPhone: { type: String, default: "" },
      supportWechat: { type: String, default: "" },
      notice: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export default mongoose.model("SiteConfig", siteConfigSchema);
