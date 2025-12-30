import mongoose from "mongoose";

const flashSaleSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true }, // 原商品
    clonedProductId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true }, // 克隆爆品

    flashPrice: { type: Number, required: true },
    limitQty: { type: Number, default: 0 },

    start: { type: Date, default: null },
    end: { type: Date, default: null },

    enabled: { type: Boolean, default: true },
    tag: { type: String, default: "爆品日" },
  },
  { timestamps: true }
);

export default mongoose.model("FlashSale", flashSaleSchema);
