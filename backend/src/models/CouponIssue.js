import mongoose from "mongoose";

const couponIssueSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    couponCode: { type: String, required: true, index: true },
    issuedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export default mongoose.model("CouponIssue", couponIssueSchema);
