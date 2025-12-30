import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, default: "general" }, // deals/coupon/referral...
    status: { type: String, enum: ["draft", "running", "paused", "ended"], default: "draft" },
    startAt: Date,
    endAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("Campaign", campaignSchema);
