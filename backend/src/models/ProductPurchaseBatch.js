import mongoose from "mongoose";

const batchSchema = new mongoose.Schema(
  {
    // =========================
    // 基础
    // =========================
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },

    supplierName: { type: String, default: "" },

    // ✅ 新增（关键）
    batchNo: { type: String, default: "" }, // 批次号
    purchaseDate: { type: Date, default: Date.now }, // FIFO排序用

    // =========================
    // 采购信息
    // =========================
    boxPrice: { type: Number, required: true },
    boxCount: { type: Number, required: true },
    unitsPerBox: { type: Number, required: true },

    // =========================
    // 数量
    // =========================
    totalUnits: { type: Number, required: true },
    remainingUnits: { type: Number, required: true },

    // =========================
    // 成本（核心）
    // =========================
    unitCost: { type: Number, required: true }, // 原始单位成本
    totalCost: { type: Number, required: true },

    // ✅ 新增（非常关键）
    extraCostTotal: { type: Number, default: 0 }, // 运费/杂费
    finalUnitCost: { type: Number, required: true }, // 真正成本

    // =========================
    // 销售参考（非财务核心）
    // =========================
    retailPrice: { type: Number, required: true },
    grossMarginPercent: { type: Number, default: 0 },

    // =========================
    // 状态
    // =========================
    status: {
      type: String,
      enum: ["active", "depleted", "locked"],
      default: "active"
    },

    // =========================
    // 其他
    // =========================
    expireAt: { type: Date, default: null },
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

export default mongoose.model("ProductPurchaseBatch", batchSchema);