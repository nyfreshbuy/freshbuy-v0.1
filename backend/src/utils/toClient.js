// backend/src/utils/toClient.js
// 把 Mongoose doc 变成前端可用结构（确保新字段 variants / 2for 字段能返回）

export function toClient(p) {
  if (!p) return null;
  const o = typeof p.toObject === "function" ? p.toObject({ virtuals: true }) : { ...p };

  return {
    // ids
    _id: String(o._id || ""),
    id: o.id || "",

    // basic
    name: o.name || "",
    desc: o.desc || "",
    sku: o.sku || "",
    tag: o.tag || "",
    type: o.type || "normal",

    // category
    topCategoryKey: o.topCategoryKey || "",
    category: o.category || "",
    subCategory: o.subCategory || "",

    // prices
    originPrice: o.originPrice ?? 0,
    price: o.price ?? 0,
    cost: o.cost ?? 0,
    taxable: !!o.taxable,

    // images / labels
    image: o.image || "",
    images: Array.isArray(o.images) ? o.images : [],
    labels: Array.isArray(o.labels) ? o.labels : [],

    // ✅ variants（整箱/单个）
    variants: Array.isArray(o.variants)
      ? o.variants.map((v) => ({
          key: v.key,
          label: v.label || "",
          unitCount: Number(v.unitCount || 1),
          price: v.price == null ? null : Number(v.price),
          enabled: v.enabled !== false,
          sortOrder: Number(v.sortOrder || 0),
        }))
      : [],

    // stock
    stock: Number(o.stock || 0),
    minStock: o.minStock == null ? undefined : Number(o.minStock),
    allowZeroStock: o.allowZeroStock !== false,

    // status
    isActive: o.isActive !== false,
    status: o.status || "on",
    activeFrom: o.activeFrom || null,
    activeTo: o.activeTo || null,

    // ✅ special（2 for / 单件特价都返回）
    specialEnabled: !!o.specialEnabled,
    specialPrice: o.specialPrice == null ? null : Number(o.specialPrice),
    specialQty: Number(o.specialQty || 1),
    specialTotalPrice: o.specialTotalPrice == null ? null : Number(o.specialTotalPrice),
    specialFrom: o.specialFrom || null,
    specialTo: o.specialTo || null,

    // flags
    isFlashDeal: !!o.isFlashDeal,
    isSpecial: !!o.isSpecial,
    isFamilyMustHave: !!o.isFamilyMustHave,
    isBestSeller: !!o.isBestSeller,
    isNewArrival: !!o.isNewArrival,

    // guards
    autoCancelSpecialOnLowStock: !!o.autoCancelSpecialOnLowStock,
    autoCancelSpecialThreshold: Number(o.autoCancelSpecialThreshold || 0),

    // misc
    supplierCompanyId: o.supplierCompanyId || "",
    internalCompanyId: o.internalCompanyId || "",

    // meta
    sortOrder: Number(o.sortOrder || 99999),
    createdAt: o.createdAt || null,
    updatedAt: o.updatedAt || null,
  };
}

export function toClientList(list) {
  return Array.isArray(list) ? list.map(toClient) : [];
}
