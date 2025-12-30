// backend/src/models/Product.js
import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    // 兼容旧系统的自定义 id（你 admin_products.js 会生成 p_时间戳）
    id: { type: String, index: true },

    // 基础信息
    name: { type: String, required: true, trim: true },
    desc: { type: String, trim: true },

    // 价格相关
    price: { type: Number, required: true },      // 当前售卖价（后端会重算）
    originPrice: { type: Number, default: 0 },    // 原价
    cost: { type: Number, default: 0 },           // 成本
    taxable: { type: Boolean, default: false },   // ✅ 是否收 NY 销售税
    // 分类（✅ 你现在保存不了的核心）
    topCategoryKey: { type: String, trim: true, default: "" }, // 导航大类 key：fresh/meat/...
    category: { type: String, trim: true, default: "" },       // 展示大类：生鲜果蔬
    subCategory: { type: String, trim: true, default: "" },    // 子类：叶菜类

    // 标识/标签
    tag: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "normal" }, // hot/normal...
    labels: [{ type: String, trim: true }],
    images: [{ type: String, trim: true }],
    image: { type: String, trim: true, default: "" },

    // 库存
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

export default mongoose.model("Product", productSchema);
