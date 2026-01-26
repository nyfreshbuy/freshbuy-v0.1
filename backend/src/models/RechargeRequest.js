import mongoose from "mongoose";

const RechargeRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    method: { type: String, enum: ["zelle"], default: "zelle" },
    amount: { type: Number, required: true },
    ref: { type: String, default: "" }, // 用户填写的参考信息
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("RechargeRequest", RechargeRequestSchema);
