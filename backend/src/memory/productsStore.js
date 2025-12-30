// backend/src/memory/productsStore.js
// =======================================================
// 🧠 在鲜购拼好货：商品内存仓库（无 Mongo 版）
// -------------------------------------------------------
// 只存放在内存里，重启服务器后会回到初始数据
// 供 /api/admin/products* 和前台 /api/frontend/products* 使用
// =======================================================

/**
 * 统一生成商品 ID
 */
function genProductId() {
  return (
    "p_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(16).slice(2, 8)
  );
}

/**
 * 商品基础数组
 * 可以先放几个示例，方便你前台看到效果
 */
export const products = [
  {
    id: genProductId(),
    name: "新鲜鸡蛋 10 枚装",
    originPrice: 3.99,
    tag: "日常刚需",
    type: "daily", // daily/hot/new/best/normal
    stock: 100,
    minStock: 20,
    allowZeroStock: true,

    category: "日用品",
    subCategory: "蛋制品",
    sortOrder: 10,

    image:
      "https://picsum.photos/seed/eggs/500/400",
    images: [],

    desc: "每日新鲜直送 · 适合家庭早餐、烘焙",

    // 特价相关
    specialEnabled: true,
    specialPrice: 2.99,
    specialFrom: null,
    specialTo: null,
    autoCancelSpecialOnLowStock: true,
    autoCancelSpecialThreshold: 20,

    // 前台展示 flag
    isFlashDeal: false, // 爆品日
    isFamilyMustHave: true, // 家庭必备
    isBestSeller: true,
    isNewArrival: false,

    sku: "EGG-10PK",
    internalCompanyId: "INT-0001",

    // 上下架
    isActive: true,
    status: "on",
    activeFrom: null,
    activeTo: null,

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // 销量（用于畅销 / 新品等自动规则，可后面慢慢做）
    soldCount: 0,
  },
  {
    id: genProductId(),
    name: "西兰花 1 磅装",
    originPrice: 2.49,
    tag: "生鲜果蔬",
    type: "normal",
    stock: 80,
    minStock: 15,
    allowZeroStock: true,

    category: "生鲜果蔬",
    subCategory: "蔬菜",
    sortOrder: 20,

    image:
      "https://picsum.photos/seed/broccoli/500/400",
    images: [],

    desc: "新鲜绿色西兰花 · 适合清炒、焯水、烤箱",

    specialEnabled: false,
    specialPrice: null,
    specialFrom: null,
    specialTo: null,
    autoCancelSpecialOnLowStock: false,
    autoCancelSpecialThreshold: 0,

    isFlashDeal: false,
    isFamilyMustHave: true,
    isBestSeller: false,
    isNewArrival: true,

    sku: "VEG-BROC-1LB",
    internalCompanyId: "INT-0002",

    isActive: true,
    status: "on",
    activeFrom: null,
    activeTo: null,

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    soldCount: 0,
  },
];

// 进货批次：Map<productId, Array<batch>>
export const purchaseBatchesMap = new Map();

/**
 * 按关键字搜索商品（后台列表用）
 * @param {string} keyword
 * @returns {Array}
 */
export function listProducts(keyword = "") {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [...products];

  return products.filter((p) => {
    const id = String(p.id || "").toLowerCase();
    const name = String(p.name || "").toLowerCase();
    const tag = String(p.tag || "").toLowerCase();
    const sku = String(p.sku || "").toLowerCase();
    const internal = String(p.internalCompanyId || "").toLowerCase();
    const cat = String(p.category || "").toLowerCase();
    const sub = String(p.subCategory || "").toLowerCase();
    return (
      id.includes(kw) ||
      name.includes(kw) ||
      tag.includes(kw) ||
      sku.includes(kw) ||
      internal.includes(kw) ||
      cat.includes(kw) ||
      sub.includes(kw)
    );
  });
}

/**
 * 根据 ID 获取商品
 */
export function getProductById(id) {
  return products.find((p) => p.id === id) || null;
}

/**
 * 新建商品
 */
export function createProduct(payload) {
  const now = new Date().toISOString();
  const id = genProductId();

  const p = {
    id,
    name: payload.name,
    originPrice: Number(payload.originPrice || 0),
    tag: payload.tag || "",
    type: payload.type || "normal",
    stock: Number(payload.stock || 0),
    minStock: Number(payload.minStock || 0),
    allowZeroStock:
      payload.allowZeroStock !== undefined
        ? !!payload.allowZeroStock
        : true,

    category: payload.category || "其他",
    subCategory: payload.subCategory || "",
    sortOrder: Number(payload.sortOrder || 0),

    image: payload.image || "",
    images: Array.isArray(payload.images) ? payload.images : [],

    desc: payload.desc || "",

    specialEnabled: !!payload.specialEnabled,
    specialPrice:
      payload.specialPrice != null
        ? Number(payload.specialPrice)
        : null,
    specialFrom: payload.specialFrom || null,
    specialTo: payload.specialTo || null,
    autoCancelSpecialOnLowStock:
      !!payload.autoCancelSpecialOnLowStock,
    autoCancelSpecialThreshold:
      Number(payload.autoCancelSpecialThreshold || 0),

    isFlashDeal: !!payload.isFlashDeal,
    isFamilyMustHave: !!payload.isFamilyMustHave,
    isBestSeller: !!payload.isBestSeller,
    isNewArrival: !!payload.isNewArrival,

    sku: payload.sku || "",
    internalCompanyId: payload.internalCompanyId || "",

    isActive:
      payload.isActive !== undefined ? !!payload.isActive : true,
    status:
      payload.status ||
      (payload.isActive === false ? "off" : "on"),
    activeFrom: payload.activeFrom || null,
    activeTo: payload.activeTo || null,

    createdAt: now,
    updatedAt: now,
    soldCount: 0,
  };

  products.push(p);
  return p;
}

/**
 * 更新商品
 */
export function updateProduct(id, patch) {
  const p = getProductById(id);
  if (!p) return null;

  Object.assign(p, {
    ...patch,
    originPrice:
      patch.originPrice != null
        ? Number(patch.originPrice)
        : p.originPrice,
    stock:
      patch.stock != null ? Number(patch.stock) : p.stock,
    minStock:
      patch.minStock != null ? Number(patch.minStock) : p.minStock,
    sortOrder:
      patch.sortOrder != null
        ? Number(patch.sortOrder)
        : p.sortOrder,
    specialPrice:
      patch.specialPrice != null
        ? Number(patch.specialPrice)
        : p.specialPrice,
    autoCancelSpecialThreshold:
      patch.autoCancelSpecialThreshold != null
        ? Number(patch.autoCancelSpecialThreshold)
        : p.autoCancelSpecialThreshold,
    updatedAt: new Date().toISOString(),
  });

  // 如果显式传了 isActive 或 status，就统一一下
  if (patch.isActive !== undefined) {
    p.isActive = !!patch.isActive;
    p.status = p.isActive ? "on" : "off";
  }
  if (patch.status) {
    p.status = patch.status;
    p.isActive = patch.status !== "off";
  }

  return p;
}

/**
 * 删除商品
 */
export function deleteProduct(id) {
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  products.splice(idx, 1);
  purchaseBatchesMap.delete(id);
  return true;
}

/**
 * 上下架切换
 */
export function toggleProductStatus(id) {
  const p = getProductById(id);
  if (!p) return null;

  const next = (p.status || "on") === "off" ? "on" : "off";
  p.status = next;
  p.isActive = next === "on";
  p.updatedAt = new Date().toISOString();
  return p;
}

/**
 * 保存一条进货批次，并更新商品库存 + 原价
 * body: { boxPrice, boxCount, unitsPerBox, grossMarginPercent, expireAt, retailPrice, supplierName, supplierCompanyId }
 */
export function addPurchaseBatch(productId, body) {
  const p = getProductById(productId);
  if (!p) throw new Error("商品不存在");

  const now = new Date();
  const totalUnits = body.boxCount * body.unitsPerBox;
  const totalCost = body.boxPrice * body.boxCount;
  const unitCost = totalUnits > 0 ? totalCost / totalUnits : 0;

  let retailPrice = Number(body.retailPrice || 0);
  const gross = Number(body.grossMarginPercent || 0);
  if (!retailPrice && unitCost > 0 && gross > 0 && gross < 100) {
    const rate = gross / 100;
    retailPrice = unitCost / (1 - rate);
  }

  const batch = {
    id:
      "pb_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(16).slice(2, 8),
    productId,
    supplierName: body.supplierName || "",
    supplierCompanyId: body.supplierCompanyId || "",
    boxPrice: Number(body.boxPrice || 0),
    boxCount: Number(body.boxCount || 0),
    unitsPerBox: Number(body.unitsPerBox || 0),
    totalUnits,
    totalCost,
    unitCost,
    grossMarginPercent: gross,
    retailPrice,
    expireAt: body.expireAt || null,
    remainingUnits: totalUnits,
    createdAt: now.toISOString(),
  };

  if (!purchaseBatchesMap.has(productId)) {
    purchaseBatchesMap.set(productId, []);
  }
  purchaseBatchesMap.get(productId).push(batch);

  // 同步商品库存 + 原价（零售价）
  p.stock = Number(p.stock || 0) + totalUnits;
  if (retailPrice > 0) {
    p.originPrice = retailPrice;
  }
  p.updatedAt = new Date().toISOString();

  return { batch, product: p };
}

/**
 * 读取某个商品的所有进货批次
 */
export function getPurchaseBatches(productId) {
  return purchaseBatchesMap.get(productId) || [];
}

/**
 * 一些给前台用的筛选帮助 —— 爆品日 / 家庭必备 / 新品 / 畅销
 */
export function getFridayDeals() {
  // 简单：选 isFlashDeal 或 type === "hot"
  return products.filter(
    (p) =>
      p.isActive !== false &&
      (p.isFlashDeal || (p.type || "").toLowerCase() === "hot")
  );
}

export function getFamilyEssentials() {
  return products.filter(
    (p) =>
      p.isActive !== false &&
      (p.isFamilyMustHave ||
        (p.specialEnabled && p.specialPrice && p.specialPrice < p.originPrice))
  );
}

export function getBestSellers(limit = 50) {
  return products
    .filter((p) => p.isActive !== false)
    .sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0))
    .slice(0, limit);
}

export function getNewArrivals(days = 7, limit = 30) {
  const now = Date.now();
  const ms = days * 24 * 60 * 60 * 1000;
  return products
    .filter((p) => {
      const created = p.createdAt ? new Date(p.createdAt).getTime() : 0;
      return (
        p.isActive !== false && created && now - created <= ms
      );
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    )
    .slice(0, limit);
}
