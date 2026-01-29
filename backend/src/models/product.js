// backend/src/models/product.js
import mongoose from "mongoose";

// =========================
// ✅ 规格（单个/整箱）Schema
// 说明：你 MongoDB 里 variants 里已经有很多字段
// 如果 schema 不包含它们，后续保存会被 mongoose 丢字段（默认 strict=true）
// =========================
const productVariantSchema = new mongoose.Schema(
  {
    // single / box12 / box24 ...
    key: { type: String, trim: true, required: true },

    // 展示文案：单个 / 整箱(12个)
    label: { type: String, trim: true, default: "" },

    // ✅ 换算到基础库存单位：单个=1，整箱(12)=12
    unitCount: { type: Number, default: 1, min: 1 },

    // ✅ 这个规格自己的售价（可选；为空就用 product.price / originPrice）
    price: { type: Number, default: null, min: 0 },

    // 是否启用这个规格
    enabled: { type: Boolean, default: true },

    // 可选：排序
    sortOrder: { type: Number, default: 0 },

    // ✅ 你 DB 里 variants 还存在这些字段（全部补齐，避免保存时丢失）
    stock: { type: Number, default: null }, // 如果你未来想做“规格库存”，可用
    minStock: { type: Number, default: null },
    allowZeroStock: { type: Boolean, default: null },

    soldCount: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
    status: { type: String, trim: true, default: "on" }, // on/off
    activeFrom: { type: Date, default: null },
    activeTo: { type: Date, default: null },

    // ✅ 规格级特价（你 DB 里 variants.single 上就有）
    specialEnabled: { type: Boolean, default: false },
    specialPrice: { type: Number, default: null }, // 旧字段兼容
    specialQty: { type: Number, default: 1, min: 1 },
    specialTotalPrice: { type: Number, default: null },
    specialFrom: { type: Date, default: null },
    specialTo: { type: Date, default: null },

    isFlashDeal: { type: Boolean, default: false },
    isSpecial: { type: Boolean, default: false },
    isFamilyMustHave: { type: Boolean, default: false },
    isBestSeller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },

    autoCancelSpecialOnLowStock: { type: Boolean, default: false },
    autoCancelSpecialThreshold: { type: Number, default: 0 },

    // ✅ 规格级押金（可选：有就覆盖产品级 deposit）
    deposit: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // 兼容旧系统的自定义 id（你 admin_products.js 会生成 p_时间戳）
    id: { type: String, index: true },

    // 基础信息
    name: { type: String, required: true, trim: true },
    desc: { type: String, trim: true, default: "" },

    // 价格相关
    price: { type: Number, required: true, min: 0 }, // 当前售卖价
    originPrice: { type: Number, default: 0, min: 0 }, // 单件原价
    cost: { type: Number, default: 0, min: 0 },
    taxable: { type: Boolean, default: false },

    // ✅ 产品级押金（你现在就是用这个）
    deposit: { type: Number, default: 0, min: 0 },

    // 分类
    topCategoryKey: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "" },
    subCategory: { type: String, trim: true, default: "" },

    // 标识/标签
    tag: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "normal" }, // hot/normal...
    labels: [{ type: String, trim: true }],

    // 图片
    images: [{ type: String, trim: true }],
    image: { type: String, trim: true, default: "" },

    // =========================
    // ✅ 规格 variants（单个/整箱）
    // =========================
    variants: { type: [productVariantSchema], default: [] },

    // 库存（共用一个库存：以“基础单位”计数）
    stock: { type: Number, default: 9999 },
    minStock: { type: Number, default: 0 },
    allowZeroStock: { type: Boolean, default: true },

    // 销量
    soldCount: { type: Number, default: 0 },

    // 上下架
    isActive: { type: Boolean, default: true },
    status: { type: String, trim: true, default: "on" },
    activeFrom: { type: Date, default: null },
    activeTo: { type: Date, default: null },

    // =========================
    // ✅ 产品级特价（有些商品用产品级，有些用 variant级）
    // =========================
    specialEnabled: { type: Boolean, default: false },
    specialPrice: { type: Number, default: null },
    specialQty: { type: Number, default: 1, min: 1 },
    specialTotalPrice: { type: Number, default: null },
    specialFrom: { type: Date, default: null },
    specialTo: { type: Date, default: null },

    isFlashDeal: { type: Boolean, default: false },
    isSpecial: { type: Boolean, default: false },
    isFamilyMustHave: { type: Boolean, default: false },
    isBestSeller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },

    autoCancelSpecialOnLowStock: { type: Boolean, default: false },
    autoCancelSpecialThreshold: { type: Number, default: 0 },

    // 内部字段
    sku: { type: String, trim: true, default: "" },
    internalCompanyId: { type: String, trim: true, default: "" },
    supplierCompanyId: { type: String, trim: true, default: "" },

    // 排序
    sortOrder: { type: Number, default: 99999 },
  },
  { timestamps: true }
);

// ✅ variants.key 索引
productSchema.index({ "variants.key": 1 });

// =========================
// ✅ 保存前规范化：产品级特价
// - specialEnabled=false 时清空特价字段
// - specialQty<1 自动修正为 1
// - qty=1 且 specialTotalPrice 有值时，同步 specialPrice（兼容旧逻辑）
// =========================
productSchema.pre("save", function () {
  try {
    // 押金兜底
    if (!Number.isFinite(Number(this.deposit))) this.deposit = 0;
    if (Number(this.deposit) < 0) this.deposit = 0;

    // 产品级特价规范化
    if (!this.specialEnabled) {
      this.specialPrice = null;
      this.specialQty = 1;
      this.specialTotalPrice = null;
      this.specialFrom = null;
      this.specialTo = null;
    } else {
      const qty = Math.max(1, Math.floor(Number(this.specialQty || 1)));
      this.specialQty = qty;

      if (qty === 1 && this.specialTotalPrice != null) {
        const t = Number(this.specialTotalPrice);
        if (Number.isFinite(t) && t > 0) this.specialPrice = t;
      }
    }

    // 规格级特价规范化
    if (Array.isArray(this.variants)) {
      for (const v of this.variants) {
        if (!v) continue;

        // unitCount 兜底
        v.unitCount = Math.max(1, Math.floor(Number(v.unitCount || 1)));

        // 规格押金兜底（允许 null：代表“用产品级 deposit”）
        if (v.deposit != null) {
          const dv = Number(v.deposit);
          v.deposit = Number.isFinite(dv) && dv >= 0 ? dv : 0;
        }

        if (!v.specialEnabled) {
          v.specialPrice = null;
          v.specialQty = 1;
          v.specialTotalPrice = null;
          v.specialFrom = null;
          v.specialTo = null;
        } else {
          const q = Math.max(1, Math.floor(Number(v.specialQty || 1)));
          v.specialQty = q;

          if (q === 1 && v.specialTotalPrice != null) {
            const t = Number(v.specialTotalPrice);
            if (Number.isFinite(t) && t > 0) v.specialPrice = t;
          }
        }
      }
    }
  } catch (e) {
    console.error("productSchema.pre(save) normalize error:", e);
  }
});

export default mongoose.models.Product || mongoose.model("Product", productSchema);
