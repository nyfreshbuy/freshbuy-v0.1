import mongoose from "mongoose";

const couponRedeemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    couponCode: { type: String, required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    redeemedAt: { type: Date, default: Date.now, index: true },
    amountOff: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("CouponRedeem", couponRedeemSchema);
