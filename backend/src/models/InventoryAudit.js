// backend/src/models/InventoryAudit.js
import mongoose from "mongoose";

const inventoryAuditItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", index: true },
    productName: { type: String, default: "" },
    sku: { type: String, default: "" },

    systemStock: { type: Number, default: 0 },
    actualStock: { type: Number, default: 0 },
    diffQty: { type: Number, default: 0 },

    avgUnitCost: { type: Number, default: 0 },
    diffAmount: { type: Number, default: 0 },

    note: { type: String, default: "" },
  },
  { _id: false }
);

const inventoryAuditSchema = new mongoose.Schema(
  {
    auditNo: { type: String, default: "", index: true },
    auditDate: { type: Date, default: Date.now, index: true },

    items: { type: [inventoryAuditItemSchema], default: [] },

    totalDiffQty: { type: Number, default: 0 },
    totalDiffAmount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    createdByName: { type: String, default: "" },

    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.models.InventoryAudit ||
  mongoose.model("InventoryAudit", inventoryAuditSchema);