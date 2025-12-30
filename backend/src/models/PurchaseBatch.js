// backend/src/models/PurchaseBatch.js
import mongoose from "mongoose";

const purchaseBatchSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },

    boxPrice: { type: Number, required: true }, // 整箱价（每箱）
    boxCount: { type: Number, required: true }, // 本次进货箱数
    unitsPerBox: { type: Number, required: true }, // 每箱多少包

    unitCost: { type: Number, required: true }, // 单包成本
    totalQty: { type: Number, required: true }, // 本次进货总数量
    totalCost: { type: Number, required: true }, // 本次总成本

    retailPrice: { type: Number, required: true }, // 当时核算出的零售价
    marginPercent: { type: Number, default: 40 }, // 目标毛利率

    supplier: { type: String, default: "" }, // 供应商
    expiryDate: { type: Date }, // 该批次过期时间

    remainingQty: { type: Number, required: true }, // 该批次未售完库存（默认 = totalQty）
  },
  { timestamps: true }
);

const PurchaseBatch = mongoose.model("PurchaseBatch", purchaseBatchSchema);
export default PurchaseBatch;
