import mongoose from "mongoose";

const invoiceItemSchema = new mongoose.Schema(
  {
    // 从商品管理选才有
    productId: { type: String, default: "" },

    // ✅ 选中的规格：single / box12 / box24
    variantKey: { type: String, default: "" },

    // prdt code：优先 sku，没有就允许手填
    productCode: { type: String, default: "" },

    description: { type: String, default: "" },

    // 发票显示的 QTY（箱数/件数）
    qty: { type: Number, default: 0 },

    // ✅ 用于扣库存：qty * unitCount（打印不显示）
    unitCount: { type: Number, default: 1 },

    unitPrice: { type: Number, default: 0 },
    lineTotal: { type: Number, default: 0 },
  },
  { _id: false }
);

const partySchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" }, // 选用户才有
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, default: "" }, // YYYYMMDD-001
    date: { type: Date, default: Date.now },

    accountNo: { type: String, default: "" },
    salesRep: { type: String, default: "" },
    terms: { type: String, default: "" },

    soldTo: { type: partySchema, default: {} },
    shipTo: { type: partySchema, default: {} },
    shipToSameAsSoldTo: { type: Boolean, default: true },

    items: { type: [invoiceItemSchema], default: [] },

    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    // Statement 区间（可空）
    statementFrom: { type: Date, default: null },
    statementTo: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Invoice", invoiceSchema);
