// backend/src/models/product.js
import mongoose from "mongoose";

// ✅ 规格（单个/整箱）Schema
const productVariantSchema = new mongoose.Schema(
  {
    // single / box12 / box24 ...
    key: { type: String, trim: true, required: true },

    // 展示文案：单个 / 整箱(12个)
    label: { type: String, trim: true, default: "" },

    // ✅ 换算到基础库存单位：单个=1，整箱(12)=12
    unitCount: { type: Number, default: 1 },

    // ✅ 这个规格自己的售价（可选；为空就用 product.price）
    price: { type: Number, default: null },

    // 是否启用这个规格
    enabled: { type: Boolean, default: true },

    // 可选：排序
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // 兼容旧系统的自定义 id（你 admin_products.js 会生成 p_时间戳）
    id: { type: String, index: true },

    // 基础信息
    name: { type: String, required: true, trim: true },
    desc: { type: String, trim: true },

    // 价格相关
    price: { type: Number, required: true }, // 当前售卖价（后端会重算）
    originPrice: { type: Number, default: 0 }, // 原价
    cost: { type: Number, default: 0 }, // 成本
    taxable: { type: Boolean, default: false }, // ✅ 是否收 NY 销售税

    // 分类（✅ 你现在保存不了的核心）
    topCategoryKey: { type: String, trim: true, default: "" }, // 导航大类 key：fresh/meat/...
    category: { type: String, trim: true, default: "" }, // 展示大类：生鲜果蔬
    subCategory: { type: String, trim: true, default: "" }, // 子类：叶菜类

    // 标识/标签
    tag: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "normal" }, // hot/normal...
    labels: [{ type: String, trim: true }],
    images: [{ type: String, trim: true }],
    image: { type: String, trim: true, default: "" },

    // =========================
    // ✅ 新增：规格 variants（单个/整箱共用库存的关键）
    // =========================
    variants: { type: [productVariantSchema], default: [] },

    // 库存（✅ 共用一个库存：以“基础单位”计数）
    stock: { type: Number, default: 9999 },
    minStock: { type: Number },
    allowZeroStock: { type: Boolean, default: true },

    // 销量
    soldCount: { type: Number, default: 0 },

    // 上下架
    isActive: { type: Boolean, default: true },
    status: { type: String, trim: true, default: "on" }, // on/off
    activeFrom: { type: Date },
    activeTo: { type: Date },

    // 特价/活动（你后台表单在用）
    specialEnabled: { type: Boolean, default: false },
    specialPrice: { type: Number, default: null },
    specialFrom: { type: Date },
    specialTo: { type: Date },

    // 你代码里用到的其他开关（先加上，避免丢字段）
    isFlashDeal: { type: Boolean, default: false },
    isSpecial: { type: Boolean, default: false },

    isFamilyMustHave: { type: Boolean, default: false },
    isBestSeller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },

    // 库存低自动取消特价
    autoCancelSpecialOnLowStock: { type: Boolean, default: false },
    autoCancelSpecialThreshold: { type: Number, default: 0 },

    // 内部字段（你前端表单在传）
    sku: { type: String, trim: true, default: "" },
    internalCompanyId: { type: String, trim: true, default: "" },
    supplierCompanyId: { type: String, trim: true, default: "" },

    // 排序
    sortOrder: { type: Number, default: 99999 },
  },
  { timestamps: true }
);

// ✅ 可选：给 variants.key 建索引（查找/过滤会更快）
productSchema.index({ "variants.key": 1 });

export default mongoose.models.Product || mongoose.model("Product", productSchema);
