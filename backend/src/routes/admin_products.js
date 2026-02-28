// backend/src/routes/admin_products.js
// 在鲜购拼好货 · 后台商品管理接口（MongoDB DB-only 版）
// 保持原接口不变：
// - POST   /api/admin/products/upload-image
// - GET    /api/admin/products?keyword=xxx
// - POST   /api/admin/products
// - PATCH  /api/admin/products/:id
// - DELETE /api/admin/products/:id
// - PATCH  /api/admin/products/:id/toggle-status
// - GET    /api/admin/products/:id/purchase-batches
// - POST   /api/admin/products/:id/purchase-batches

import express from "express";
import multer from "multer";
import Product from "../models/product.js";
import ProductPurchaseBatch from "../models/ProductPurchaseBatch.js";
import { toClient, toClientList } from "../utils/toClient.js";
import { uploadBufferToCloudinary } from "../utils/cloudinary.js";

const router = express.Router();
router.use(express.json()); // ✅ 必须加：解析 JSON body

// ===================== 工具函数 =====================

// ✅ DEBUG：确认 admin_products router 已部署并被挂载成功
router.get("/__ping", (req, res) => {
  res.json({
    ok: true,
    router: "admin_products.js",
    time: new Date().toISOString(),
  });
});

// ✅ 改为内存上传（不落地本地磁盘）
// 表单字段名：image
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

// 防 regex 注入
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 兼容：优先按 Mongo _id 找，其次按你旧字段 id 找
async function findProductByAnyId(idParam) {
  const id = String(idParam || "");
  if (!id) return null;

  const byMongoId = await Product.findById(id).catch(() => null);
  if (byMongoId) return byMongoId;

  const byLegacyId = await Product.findOne({ id }).catch(() => null);
  if (byLegacyId) return byLegacyId;

  return null;
}

function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
}

// ✅ 允许为空的数值："" / null => null
function numOrNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ✅ 允许为空的日期："" => null
function dateOrNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ✅ variants：保留完整字段，避免 mongoose strict 丢字段
function normalizeVariants(raw) {
  if (!Array.isArray(raw)) return [];

  const toBool = (x) => isTrueFlag(x);

  const numOr0 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return raw
    .map((v) => {
      const key = String(v?.key || "").trim();
      if (!key) return null;

      const unitCount = Math.max(1, Math.floor(Number(v?.unitCount || 1)));

      // 规格特价
      const specialEnabled = toBool(v?.specialEnabled);
      const specialQty = Math.max(1, Math.floor(Number(v?.specialQty || 1)));
      const specialTotalPrice = numOrNull(v?.specialTotalPrice);
      const specialPrice =
        specialEnabled && specialQty === 1 && specialTotalPrice != null
          ? specialTotalPrice
          : numOrNull(v?.specialPrice);

      return {
        key,
        label: String(v?.label || ""),
        unitCount,

        // 规格价格
        price: numOrNull(v?.price),

        // 是否启用
        enabled: v?.enabled !== false,
        sortOrder: Number(v?.sortOrder || 0),

        // 规格库存
        stock: numOrNull(v?.stock),
        minStock: numOrNull(v?.minStock),
        allowZeroStock: v?.allowZeroStock === null ? null : toBool(v?.allowZeroStock),

        // 销量/上下架
        soldCount: Math.max(0, Math.floor(Number(v?.soldCount || 0))),
        isActive: v?.isActive === undefined ? true : toBool(v?.isActive),
        status: String(v?.status || "on"),
        activeFrom: dateOrNull(v?.activeFrom),
        activeTo: dateOrNull(v?.activeTo),

        // ✅ 规格级特价
        specialEnabled,
        specialPrice,
        specialQty,
        specialTotalPrice,
        specialFrom: dateOrNull(v?.specialFrom),
        specialTo: dateOrNull(v?.specialTo),

        // 标签类（可选）
        isFlashDeal: toBool(v?.isFlashDeal),
        isSpecial: toBool(v?.isSpecial),
        isFamilyMustHave: toBool(v?.isFamilyMustHave),
        isBestSeller: toBool(v?.isBestSeller),
        isNewArrival: toBool(v?.isNewArrival),

        // 低库存自动取消特价（规格级）
        autoCancelSpecialOnLowStock: toBool(v?.autoCancelSpecialOnLowStock),
        autoCancelSpecialThreshold: Math.max(0, Math.floor(numOr0(v?.autoCancelSpecialThreshold))),

        // ✅ 规格级押金（允许 null 代表用产品级 deposit）
        deposit: numOrNull(v?.deposit),
      };
    })
    .filter(Boolean);
}

// ✅ 产品级 special + deposit（并保留 bottleDeposit/containerDeposit/crv）
function normalizeSpecialAndDeposit(body) {
  const specialEnabled = !!body.specialEnabled;

  const deposit =
    Number(body.deposit ?? body.bottleDeposit ?? body.containerDeposit ?? body.crv ?? 0) || 0;

  const bottleDeposit = Number(body.bottleDeposit ?? 0) || 0;
  const containerDeposit = Number(body.containerDeposit ?? 0) || 0;
  const crv = Number(body.crv ?? 0) || 0;

  const qtyRaw = Number(
    body.specialQty ??
      body.specialN ??
      body.specialCount ??
      body.special_qty ??
      body.special_count ??
      1
  );
  const specialQty = Math.max(1, Math.floor(qtyRaw || 1));

  const specialTotalPrice = numOrNull(
    body.specialTotalPrice ??
      body.specialTotal ??
      body.special_total_price ??
      body.special_total ??
      null
  );

  const specialPrice = numOrNull(body.specialPrice ?? body.special_price ?? null);

  const normalized = {
    deposit: Math.max(0, Number(deposit) || 0),
    bottleDeposit: Math.max(0, Number(bottleDeposit) || 0),
    containerDeposit: Math.max(0, Number(containerDeposit) || 0),
    crv: Math.max(0, Number(crv) || 0),
    specialEnabled,
  };

  if (!specialEnabled) {
    normalized.specialQty = 1;
    normalized.specialTotalPrice = null;
    normalized.specialPrice = null;
    normalized.specialFrom = null;
    normalized.specialTo = null;
  } else {
    normalized.specialQty = specialQty;
    normalized.specialTotalPrice = specialTotalPrice;

    normalized.specialPrice =
      specialQty === 1 && specialTotalPrice != null ? specialTotalPrice : specialPrice;

    normalized.specialFrom = body.specialFrom ?? null;
    normalized.specialTo = body.specialTo ?? null;
  }

  return normalized;
}

// 库存保护逻辑：库存 ≤ 阈值时自动关掉特价并恢复原价
// ✅ 同时支持：
// - 单件特价：specialPrice
// - N for 总价：specialQty + specialTotalPrice（例如 2 for 0.88）
function applyAutoCancelSpecial(p) {
  if (!p) return;

  const threshold = Number(p.autoCancelSpecialThreshold) || 0;
  const useGuard = !!p.autoCancelSpecialOnLowStock;

  // 低库存自动取消特价
  if (useGuard && threshold > 0 && typeof p.stock === "number" && p.stock <= threshold) {
    p.specialEnabled = false;
    p.specialPrice = null;
    // ✅ 不强制清空 specialQty/specialTotalPrice（保留设置，方便你之后再启用）
  }

  const origin = Number(p.originPrice) || 0;
  const now = new Date();

  // 时间窗判断
  let okTime = true;
  if (p.specialFrom) okTime = okTime && new Date(p.specialFrom) <= now;
  if (p.specialTo) okTime = okTime && new Date(p.specialTo) >= now;

  // ✅ 判断是否启用特价（允许两种模式）
  const qty = Math.max(1, Math.floor(Number(p.specialQty || 1)));
  const total = p.specialTotalPrice == null ? null : Number(p.specialTotalPrice);
  const unitSpecial = p.specialPrice == null ? null : Number(p.specialPrice);

  const hasNForTotal = qty > 1 && Number.isFinite(total) && total > 0;
  const hasUnitSpecial = Number.isFinite(unitSpecial) && unitSpecial > 0;

  const useSpecial = !!p.specialEnabled && okTime && (hasNForTotal || hasUnitSpecial);

  // ✅ 计算“当前售卖价 price”
  if (useSpecial) {
    if (hasNForTotal) {
      const unit = Number((total / qty).toFixed(2));
      p.price = unit > 0 ? unit : origin;
    } else {
      p.price = Number(unitSpecial) || origin;
    }
  } else {
    p.price = origin;
  }
}

// 自动标签（DB版）：按列表计算并尽量落库保持一致
async function recomputeAutoTagsForList(list) {
  const now = Date.now();

  for (const p of list) {
    const origin = Number(p.originPrice) || 0;
    const special = Number(p.specialPrice) || 0;

    const isFamilyMustHave = !!p.specialEnabled && special > 0 && origin > 0 && special <= origin * 0.8;
    const isBestSeller = Number(p.soldCount || 0) > 50;

    const created = p.createdAt ? new Date(p.createdAt).getTime() : 0;
    const isNewArrival = created && now - created < 7 * 24 * 60 * 60 * 1000;

    applyAutoCancelSpecial(p);

    p.isFamilyMustHave = isFamilyMustHave;
    p.isBestSeller = isBestSeller;
    p.isNewArrival = isNewArrival;

    await Product.findByIdAndUpdate(p._id, {
      $set: {
        isFamilyMustHave,
        isBestSeller,
        isNewArrival,
        price: p.price,
        specialEnabled: p.specialEnabled,
        specialPrice: p.specialPrice ?? null,
      },
    }).catch(() => {});
  }
}

// ===================== 路由：上传图片 =====================

// POST /api/admin/products/upload-image
router.post("/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "未接收到文件" });
    }

    const up = await uploadBufferToCloudinary(req.file.buffer, {
      public_id: `admin_product_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    });

    const url = up.secure_url;
    return res.json({ success: true, url });
  } catch (err) {
    console.error("上传图片出错:", err);
    return res.status(500).json({ success: false, message: err.message || "上传失败" });
  }
});

// ===================== 路由：获取商品列表 =====================

// GET /api/admin/products?keyword=xxx
router.get("/", async (req, res) => {
  try {
    const { keyword } = req.query;
    const filter = {};

    if (keyword && String(keyword).trim()) {
      const kw = String(keyword).trim();
      const re = new RegExp(escapeRegex(kw), "i");
      filter.$or = [
        { id: re },
        { name: re },
        { tag: re },
        { sku: re },
        { supplierCompanyId: re },
        { internalCompanyId: re },
      ];
    }

    const list = await Product.find(filter).sort({ sortOrder: 1, createdAt: -1 });

    await recomputeAutoTagsForList(list);

    return res.json({
      success: true,
      list: toClientList(list),
    });
  } catch (err) {
    console.error("获取商品列表出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

// ===================== 路由：新增商品 =====================

// POST /api/admin/products
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    if (!body.name || body.originPrice === undefined || body.originPrice === null) {
      return res.status(400).json({
        success: false,
        message: "商品名称和原价必填",
      });
    }

    const legacyId = body.id || "p_" + Date.now();

    const specialFix = normalizeSpecialAndDeposit(body);
    const variantsFix = normalizeVariants(body.variants);

    const created = await Product.create({
      ...body,
      id: legacyId,

      // 数字字段兜底
      originPrice: Number(body.originPrice),
      stock: body.stock !== undefined ? Number(body.stock) : 9999,
      minStock: body.minStock !== undefined ? Number(body.minStock) : 0,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : 99999,
      cost: body.cost !== undefined ? Number(body.cost) : 0,
      soldCount: body.soldCount !== undefined ? Number(body.soldCount) : 0,

      // 布尔字段兜底
      isActive: body.isActive === undefined ? true : !!body.isActive,
      isFlashDeal: !!body.isFlashDeal,

      // ✅ 爆品字段
      isHot: !!body.isHot,
      isHotDeal: !!body.isHotDeal,
      hotDeal: !!body.hotDeal,

      // ✅ special + deposit（包含 bottle/container/crv）
      deposit: specialFix.deposit,
      bottleDeposit: specialFix.bottleDeposit,
      containerDeposit: specialFix.containerDeposit,
      crv: specialFix.crv,

      specialEnabled: specialFix.specialEnabled,
      specialQty: specialFix.specialQty,
      specialTotalPrice: specialFix.specialTotalPrice,
      specialPrice: specialFix.specialPrice,
      specialFrom: specialFix.specialFrom,
      specialTo: specialFix.specialTo,

      // ✅ variants
      variants: variantsFix,

      // 数组
      labels: Array.isArray(body.labels) ? body.labels : [],
      tags: Array.isArray(body.tags) ? body.tags : typeof body.tags === "string" && body.tags.trim() ? [body.tags.trim()] : [],
      images: Array.isArray(body.images) ? body.images : body.images ? [body.images] : undefined,
    });

    applyAutoCancelSpecial(created);
    await Product.findByIdAndUpdate(created._id, { $set: { price: created.price } });

    return res.json({
      success: true,
      product: toClient(created),
    });
  } catch (err) {
    console.error("新增商品出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

// ===================== 路由：更新商品 =====================

// PATCH /api/admin/products/:id
router.patch("/:id", async (req, res) => {
  try {
    const idParam = req.params.id;
    const body = req.body || {};

    const p = await findProductByAnyId(idParam);
    if (!p) {
      return res.status(404).json({ success: false, message: "商品不存在" });
    }

    // ✅ 兼容后台可能传 catKey/categoryKey
    if (body.category === undefined && body.catKey !== undefined) body.category = body.catKey;
    if (body.category === undefined && body.categoryKey !== undefined) body.category = body.categoryKey;

    if (body.subCategory === undefined && body.subCatKey !== undefined) body.subCategory = body.subCatKey;
    if (body.subCategory === undefined && body.subCategoryKey !== undefined) body.subCategory = body.subCategoryKey;

    // 允许更新的字段
    const fields = [
      "name",
      "sku",
      "desc",
      "originPrice",
      "price",
      "tag",
      "type",
      "stock",
      "minStock",
      "allowZeroStock",
      "taxable",
      "deposit",
      "bottleDeposit",
      "containerDeposit",
      "crv",
      "topCategoryKey",
      "category",
      "subCategory",
      "mainCategory",
      "subcategory",
      "section",
      "sortOrder",
      "image",
      "images",
      "labels",
      "tags",

      "isFlashDeal",
      "isFamilyMustHave",
      "isBestSeller",
      "isNewArrival",
      "isActive",
      "status",
      "activeFrom",
      "activeTo",

      "specialEnabled",
      "specialPrice",
      "specialQty",
      "specialTotalPrice",
      "specialFrom",
      "specialTo",

      "variants",

      // 库存保护
      "autoCancelSpecialOnLowStock",
      "autoCancelSpecialThreshold",

      // ⭐ 进货公司 ID & 公司内部 ID
      "supplierCompanyId",
      "internalCompanyId",

      // 成本/销量
      "cost",
      "soldCount",

      // 特价标识
      "isSpecial",

      // ✅ 爆品字段
      "isHot",
      "isHotDeal",
      "hotDeal",
    ];

    fields.forEach((key) => {
      if (body[key] === undefined) return;

      if (key === "images") {
        if (Array.isArray(body.images)) p.images = body.images;
        else if (typeof body.images === "string" && body.images.trim()) p.images = [body.images.trim()];
        else p.images = [];
        return;
      }

      if (key === "variants") {
        if (Array.isArray(body.variants)) p.variants = body.variants;
        else p.variants = [];
        return;
      }

      if (key === "labels") {
        if (Array.isArray(body.labels)) p.labels = body.labels;
        else if (typeof body.labels === "string" && body.labels.trim()) p.labels = [body.labels.trim()];
        else p.labels = [];
        return;
      }

      if (key === "tags") {
        if (Array.isArray(body.tags)) p.tags = body.tags;
        else if (typeof body.tags === "string" && body.tags.trim()) p.tags = [body.tags.trim()];
        else p.tags = [];
        return;
      }

      if (
        [
          "originPrice",
          "price",
          "stock",
          "minStock",
          "sortOrder",
          "autoCancelSpecialThreshold",
          "specialPrice",
          "specialQty",
          "specialTotalPrice",
          "cost",
          "soldCount",
          "deposit",
          "bottleDeposit",
          "containerDeposit",
          "crv",
        ].includes(key)
      ) {
        p[key] = body[key] === null ? null : Number(body[key]);
        return;
      }

      if (
        [
          "allowZeroStock",
          "taxable",
          "isFlashDeal",
          "isFamilyMustHave",
          "isBestSeller",
          "isNewArrival",
          "isActive",
          "autoCancelSpecialOnLowStock",
          "specialEnabled",
          "isSpecial",
          "isHot",
          "isHotDeal",
          "hotDeal",
        ].includes(key)
      ) {
        p[key] = !!body[key];
        return;
      }

      p[key] = body[key];
    });

    // ✅ special + deposit 统一归一化（避免 "" -> 0，specialQty 变 0）
    const specialFix = normalizeSpecialAndDeposit(body);
    p.deposit = specialFix.deposit;
    p.bottleDeposit = specialFix.bottleDeposit;
    p.containerDeposit = specialFix.containerDeposit;
    p.crv = specialFix.crv;

    p.specialEnabled = specialFix.specialEnabled;
    p.specialQty = specialFix.specialQty;
    p.specialTotalPrice = specialFix.specialTotalPrice;
    p.specialPrice = specialFix.specialPrice;
    p.specialFrom = specialFix.specialFrom;
    p.specialTo = specialFix.specialTo;

    // ✅ variants 归一化（保留完整字段）
    if (body.variants !== undefined) {
      p.variants = normalizeVariants(body.variants);
    }

    applyAutoCancelSpecial(p);

    await p.save();

    return res.json({
      success: true,
      product: toClient(p),
    });
  } catch (err) {
    console.error("更新商品出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

// ===================== 路由：进货 / 成本管理（DB版） =====================

// GET /api/admin/products/:id/purchase-batches
router.get("/:id/purchase-batches", async (req, res) => {
  try {
    const idParam = req.params.id;
    const p = await findProductByAnyId(idParam);

    if (!p) {
      return res.status(404).json({ success: false, message: "商品不存在" });
    }

    const batches = await ProductPurchaseBatch.find({ productId: p._id }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      product: toClient(p),
      batches,
    });
  } catch (err) {
    console.error("获取进货批次出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

// POST /api/admin/products/:id/purchase-batches
router.post("/:id/purchase-batches", async (req, res) => {
  try {
    const idParam = req.params.id;
    const p = await findProductByAnyId(idParam);

    if (!p) {
      return res.status(404).json({ success: false, message: "商品不存在" });
    }

    const body = req.body || {};
    const supplierName = (body.supplierName || "").trim();
    const supplierCompanyId = (body.supplierCompanyId || "").trim(); // ✅ 修复：原来你用但没定义
    const boxPrice = Number(body.boxPrice) || 0;
    const boxCount = Number(body.boxCount) || 0;
    const unitsPerBox = Number(body.unitsPerBox) || 0;
    const grossMarginPercent = Number(body.grossMarginPercent) || 0;
    const expireAt = body.expireAt ? new Date(body.expireAt) : null;

    if (!boxPrice || boxPrice <= 0) {
      return res.status(400).json({ success: false, message: "进货整箱价格必须大于 0" });
    }
    if (!boxCount || boxCount <= 0) {
      return res.status(400).json({ success: false, message: "进货箱数必须大于 0" });
    }
    if (!unitsPerBox || unitsPerBox <= 0) {
      return res.status(400).json({ success: false, message: "每箱内的件数必须大于 0" });
    }

    const unitCost = boxPrice / unitsPerBox;
    const totalUnits = boxCount * unitsPerBox;
    const totalCost = boxPrice * boxCount;

    let retailPrice = unitCost;
    if (grossMarginPercent > 0 && grossMarginPercent < 100) {
      const rate = grossMarginPercent / 100;
      retailPrice = unitCost / (1 - rate);
    }

    const retailPriceFixed = Number(retailPrice.toFixed(2));
    const unitCostFixed = Number(unitCost.toFixed(4));

    const batch = await ProductPurchaseBatch.create({
      productId: p._id,
      supplierName,
      supplierCompanyId,
      boxPrice,
      boxCount,
      unitsPerBox,
      unitCost: unitCostFixed,
      totalUnits,
      totalCost,
      grossMarginPercent,
      retailPrice: retailPriceFixed,
      consumptionAt: null,
      expireAt,
      remainingUnits: totalUnits,
    });

    // ⭐ 自动把本批次数量累加到商品总库存上
    p.stock = Number(p.stock || 0) + totalUnits;

    // ⭐ 自动用本批次算出来的零售价更新商品原价（originPrice）
    p.originPrice = retailPriceFixed;

    applyAutoCancelSpecial(p);
    await p.save();

    const batches = await ProductPurchaseBatch.find({ productId: p._id }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      message: "进货批次已保存",
      product: toClient(p),
      batch,
      batches,
    });
  } catch (err) {
    console.error("保存进货批次出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

// ===================== 路由：删除商品 =====================

// DELETE /api/admin/products/:id
router.delete("/:id", async (req, res) => {
  try {
    const idParam = req.params.id;

    const p =
      (await Product.findByIdAndDelete(String(idParam)).catch(() => null)) ||
      (await Product.findOneAndDelete({ id: String(idParam) }).catch(() => null));

    if (!p) {
      return res.status(404).json({ success: false, message: "商品不存在" });
    }

    await ProductPurchaseBatch.deleteMany({ productId: p._id });

    return res.json({ success: true });
  } catch (err) {
    console.error("删除商品出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

// ===================== 路由：上/下架切换 =====================

// PATCH /api/admin/products/:id/toggle-status
router.patch("/:id/toggle-status", async (req, res) => {
  try {
    const idParam = req.params.id;
    const p = await findProductByAnyId(idParam);

    if (!p) {
      return res.status(404).json({ success: false, message: "商品不存在" });
    }

    const current = String(p.status || "on").toLowerCase();
    p.status = current === "off" ? "on" : "off";
    p.isActive = p.status === "on";

    await p.save();

    return res.json({ success: true, product: toClient(p) });
  } catch (err) {
    console.error("切换上/下架出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

export default router;