import mongoose from "mongoose";

const marketingConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true }, 
    // 例：dealsDay, groupBuy, freeShipping, announcement

    enabled: { type: Boolean, default: false },

    value: mongoose.Schema.Types.Mixed, 
    // 可存字符串 / 数字 / 对象

    desc: String,
  },
  { timestamps: true }
);

export default mongoose.model("MarketingConfig", marketingConfigSchema);
