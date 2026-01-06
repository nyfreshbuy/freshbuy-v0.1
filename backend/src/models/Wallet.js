import mongoose from "mongoose";

const WalletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, default: 0 },
    totalRecharge: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ✅ 注意：这里必须是 "Wallet"，不能是 wallet
export default mongoose.models.Wallet ||
  mongoose.model("Wallet", WalletSchema);
