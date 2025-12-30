import mongoose from "mongoose";

const promotionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    ruleType: { type: String, default: "cart_fullcut" },
    threshold: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    enabled: { type: Boolean, default: true },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Promotion", promotionSchema);
