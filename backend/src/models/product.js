// backend/src/models/product.js
import mongoose from "mongoose";

// =========================
// ✅ 规格（单个/整箱）Schema
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

    // ✅ 规格库存（可选）
    stock: { type: Number, default: null },
    minStock: { type: Number, default: null },
    allowZeroStock: { type: Boolean, default: null },

    soldCount: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
    status: { type: String, trim: true, default: "on" }, // on/off
    activeFrom: { type: Date, default: null },
    activeTo: { type: Date, default: null },

    // ✅ 规格级特价
    specialEnabled: { type: Boolean, default: false },
    specialPrice: { type: Number, default: null }, // 旧字段兼容

    // ✅ 关键：默认 0 = 无特价（更符合你 orders.js 的逻辑）
    specialQty: { type: Number, default: 0, min: 0 },
    specialTotalPrice: { type: Number, default: null },

    // ✅ 兼容旧命名（你 orders.js select 里有）
    dealQty: { type: Number, default: 0, min: 0 },
    dealTotalPrice: { type: Number, default: null },
    dealPrice: { type: Number, default: null },

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
    // ✅ 不要 required：避免创建/更新时没传 price 就报错
    price: { type: Number, default: 0, min: 0 }, // 当前售卖价（可由 originPrice/特价逻辑算）
    originPrice: { type: Number, default: 0, min: 0 }, // 单件原价
    cost: { type: Number, default: 0, min: 0 },
    taxable: { type: Boolean, default: false },

    // ✅ 押金字段（orders.js 会优先 bottleDeposit/containerDeposit > deposit > crv）
    deposit: { type: Number, default: 0, min: 0 },
    bottleDeposit: { type: Number, default: 0, min: 0 },
    containerDeposit: { type: Number, default: 0, min: 0 },
    crv: { type: Number, default: 0, min: 0 },

    // 分类（尽量把你 orders.js 用到的都补齐）
    topCategoryKey: { type: String, trim: true, default: "" },

    category: { type: String, trim: true, default: "" },
    subCategory: { type: String, trim: true, default: "" },

    // ✅ 兼容更多命名（orders.js hotFlag 判断会读这些）
    mainCategory: { type: String, trim: true, default: "" },
    subcategory: { type: String, trim: true, default: "" },
    section: { type: String, trim: true, default: "" },

    // 标识/标签
    tag: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "normal" },

    // ✅ hotFlag 相关
    isHot: { type: Boolean, default: false },
    isHotDeal: { type: Boolean, default: false },
    hotDeal: { type: Boolean, default: false },

    // ✅ 文本/数组标签
    tags: [{ type: String, trim: true }],
    labels: [{ type: String, trim: true }],

    // 图片
    images: [{ type: String, trim: true }],
    image: { type: String, trim: true, default: "" },

    // ✅ 规格 variants
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

    // ✅ 产品级特价
    specialEnabled: { type: Boolean, default: false },
    specialPrice: { type: Number, default: null },
    specialQty: { type: Number, default: 0, min: 0 }, // ✅ 默认 0=无特价
    specialTotalPrice: { type: Number, default: null },

    // ✅ 兼容旧命名（你 orders.js select 里有）
    specialN: { type: Number, default: 0, min: 0 },
    specialTotal: { type: Number, default: null },
    dealQty: { type: Number, default: 0, min: 0 },
    dealTotalPrice: { type: Number, default: null },
    dealPrice: { type: Number, default: null },

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

// ✅ 索引
productSchema.index({ "variants.key": 1 });
productSchema.index({ id: 1 });

// =========================
// ✅ 保存前规范化
// =========================
productSchema.pre("save", function () {
  try {
    const normMoney = (v, def = 0) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return n < 0 ? 0 : n;
    };
    const toBool = (x) => x === true || x === "true" || x === 1 || x === "1" || x === "yes";

    // 押金兜底
    this.deposit = normMoney(this.deposit, 0);
    this.bottleDeposit = normMoney(this.bottleDeposit, 0);
    this.containerDeposit = normMoney(this.containerDeposit, 0);
    this.crv = normMoney(this.crv, 0);

    // 爆品 flags
    this.isHot = toBool(this.isHot);
    this.isHotDeal = toBool(this.isHotDeal);
    this.hotDeal = toBool(this.hotDeal);

    // 产品级特价规范化
    if (!this.specialEnabled) {
      this.specialPrice = null;
      this.specialQty = 0;
      this.specialTotalPrice = null;
      this.specialFrom = null;
      this.specialTo = null;
    } else {
      const qty = Math.max(0, Math.floor(Number(this.specialQty || 0)));
      this.specialQty = qty;

      // qty=1 时，specialTotalPrice 兼容为 specialPrice
      if (qty === 1 && this.specialTotalPrice != null) {
        const t = Number(this.specialTotalPrice);
        if (Number.isFinite(t) && t > 0) this.specialPrice = t;
      }
    }

    // 规格级特价规范化
    if (Array.isArray(this.variants)) {
      for (const v of this.variants) {
        if (!v) continue;

        v.unitCount = Math.max(1, Math.floor(Number(v.unitCount || 1)));

        // 规格押金兜底（允许 null 代表用产品级 deposit）
        if (v.deposit != null) {
          const dv = Number(v.deposit);
          v.deposit = Number.isFinite(dv) && dv >= 0 ? dv : 0;
        }

        if (!v.specialEnabled) {
          v.specialPrice = null;
          v.specialQty = 0;
          v.specialTotalPrice = null;
          v.specialFrom = null;
          v.specialTo = null;
        } else {
          const q = Math.max(0, Math.floor(Number(v.specialQty || 0)));
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