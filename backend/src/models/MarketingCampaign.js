import mongoose from "mongoose";

const marketingCampaignSchema = new mongoose.Schema(
  {
    title: String,
    type: {
      type: String,
      enum: ["deals", "discount", "announcement"],
      required: true,
    },

    enabled: { type: Boolean, default: true },

    startAt: Date,
    endAt: Date,

    content: mongoose.Schema.Types.Mixed, 
    // 比如：爆品SKU、折扣规则、文案

    createdBy: { type: String }, // admin
  },
  { timestamps: true }
);

export default mongoose.model("MarketingCampaign", marketingCampaignSchema);
