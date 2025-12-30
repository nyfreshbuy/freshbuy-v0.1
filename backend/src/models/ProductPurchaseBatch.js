import mongoose from "mongoose";

const batchSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    supplierName: { type: String, default: "" },

    boxPrice: { type: Number, required: true },
    boxCount: { type: Number, required: true },
    unitsPerBox: { type: Number, required: true },

    unitCost: { type: Number, required: true },
    totalUnits: { type: Number, required: true },
    totalCost: { type: Number, required: true },

    grossMarginPercent: { type: Number, default: 0 },
    retailPrice: { type: Number, required: true },

    expireAt: { type: Date, default: null },
    remainingUnits: { type: Number, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("ProductPurchaseBatch", batchSchema);
