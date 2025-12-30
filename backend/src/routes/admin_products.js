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
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";

import Product from "../models/Product.js";
import ProductPurchaseBatch from "../models/ProductPurchaseBatch.js";
import { toClient, toClientList } from "../utils/toClient.js";
const router = express.Router();
router.use(express.json()); // ✅ 必须加：解析 JSON bod
// ===================== 工具函数 =====================

// ESM 下的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 上传目录：backend/src/uploads（你原来就是这么写的）
const uploadDir = path.resolve(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    const name = Date.now() + "-" + Math.random().toString(16).slice(2) + ext;
    cb(null, name);
  },
});

const upload = multer({ storage });

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

// 库存保护逻辑：库存 ≤ 阈值时自动关掉特价并恢复原价
function applyAutoCancelSpecial(p) {
  if (!p) return;

  const threshold = Number(p.autoCancelSpecialThreshold) || 0;
  const useGuard = !!p.autoCancelSpecialOnLowStock;

  if (useGuard && threshold > 0 && typeof p.stock === "number" && p.stock <= threshold) {
    // 关闭特价
    p.specialEnabled = false;
    p.specialPrice = null;
  }

  // 根据特价状态重新计算 price
  const origin = Number(p.originPrice) || 0;
  const now = new Date();

  let useSpecial = false;
  if (p.specialEnabled && p.specialPrice && Number(p.specialPrice) > 0) {
    let okTime = true;
    if (p.specialFrom) okTime = okTime && new Date(p.specialFrom) <= now;
    if (p.specialTo) okTime = okTime && new Date(p.specialTo) >= now;
    useSpecial = okTime;
  }

  p.price = useSpecial ? (Number(p.specialPrice) || origin) : origin;
}

// 自动标签（DB版）：按列表计算并尽量落库保持一致
async function recomputeAutoTagsForList(list) {
  const now = Date.now();

  // 注意：这里用串行更新，数据量不大就行；后期可优化成 bulkWrite
  for (const p of list) {
    const origin = Number(p.originPrice) || 0;
    const special = Number(p.specialPrice) || 0;

    const isFamilyMustHave =
      !!p.specialEnabled && special > 0 && origin > 0 && special <= origin * 0.8;

    const isBestSeller = Number(p.soldCount || 0) > 50;

    const created = p.createdAt ? new Date(p.createdAt).getTime() : 0;
    const isNewArrival = created && now - created < 7 * 24 * 60 * 60 * 1000;

    // 顺便跑库存保护（会影响 price / specialEnabled / specialPrice）
    applyAutoCancelSpecial(p);

    // 更新对象用于返回
    p.isFamilyMustHave = isFamilyMustHave;
    p.isBestSeller = isBestSeller;
    p.isNewArrival = isNewArrival;

    // 落库（确保下一次查询一致）
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
router.post("/upload-image", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "未接收到文件" });
    }

    // 返回给前端的访问路径（静态目录在 server.js 里要有 app.use("/uploads", express.static(...))）
    const url = "/uploads/" + req.file.filename;
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

    // 简单搜索：支持
    //  商品ID（id）
    //  商品名（name）
    //  标签（tag）
    //  SKU（sku）
    //  进货公司ID（supplierCompanyId）
    //  公司内部ID（internalCompanyId）
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

    // ✅ DB 查询
    const list = await Product.find(filter).sort({ sortOrder: 1, createdAt: -1 });

    // 每次取列表前，重新跑标签和库存保护
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

    // 兼容你原要求：name + originPrice 必填
    if (!body.name || body.originPrice === undefined || body.originPrice === null) {
      return res.status(400).json({
        success: false,
        message: "商品名称和原价必填",
      });
    }

    // 兼容你旧内存逻辑：如果没传 id 就生成一个，避免前端还在用旧 id
    const legacyId = body.id || "p_" + Date.now();

    const created = await Product.create({
      ...body,
      id: legacyId,

      // 数字字段兜底
      originPrice: Number(body.originPrice),
      stock: body.stock !== undefined ? Number(body.stock) : 9999,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : 99999,
      cost: body.cost !== undefined ? Number(body.cost) : 0,
      soldCount: body.soldCount !== undefined ? Number(body.soldCount) : 0,

      // 布尔字段兜底
      isActive: body.isActive === undefined ? true : !!body.isActive,
      isFlashDeal: !!body.isFlashDeal,
      specialEnabled: !!body.specialEnabled,
      autoCancelSpecialOnLowStock: !!body.autoCancelSpecialOnLowStock,
      isSpecial: !!body.isSpecial,
      taxable: !!body.taxable, // ✅ 新增：是否收税
      // 数字字段可能来自字符串
      specialPrice: body.specialPrice !== undefined && body.specialPrice !== null ? Number(body.specialPrice) : null,
      autoCancelSpecialThreshold: Number(body.autoCancelSpecialThreshold) || 0,
      minStock: body.minStock !== undefined ? Number(body.minStock) : undefined,
      allowZeroStock: body.allowZeroStock !== undefined ? !!body.allowZeroStock : undefined,

      // 数组
      labels: Array.isArray(body.labels) ? body.labels : [],
      images: Array.isArray(body.images) ? body.images : (body.images ? [body.images] : undefined),
    });

    // 跑一遍库存保护（并保存 price）
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

    // 允许更新的字段（沿用你原来的）
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
     "topCategoryKey",   // ✅ 加这一行
      "category",
      "subCategory",
      "sortOrder",
      "image",
      "images",
      "labels",
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
      "specialFrom",
      "specialTo",
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
    ];
    // ✅ 兼容后台可能传 catKey/categoryKey
if (body.category === undefined && body.catKey !== undefined) body.category = body.catKey;
if (body.category === undefined && body.categoryKey !== undefined) body.category = body.categoryKey;

if (body.subCategory === undefined && body.subCatKey !== undefined) body.subCategory = body.subCatKey;
if (body.subCategory === undefined && body.subCategoryKey !== undefined) body.subCategory = body.subCategoryKey;
    fields.forEach((key) => {
      if (body[key] === undefined) return;

      if (key === "images") {
        if (Array.isArray(body.images)) p.images = body.images;
        else if (typeof body.images === "string" && body.images.trim()) p.images = [body.images.trim()];
        else p.images = [];
        return;
      }

      if (key === "labels") {
        if (Array.isArray(body.labels)) p.labels = body.labels;
        else if (typeof body.labels === "string" && body.labels.trim()) p.labels = [body.labels.trim()];
        else p.labels = [];
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
          "cost",
          "soldCount",
        ].includes(key)
      ) {
        p[key] = body[key] === null ? null : Number(body[key]);
        return;
      }

      if (
        [
          "allowZeroStock",
          "taxable", // ✅ 新增：布尔字段
          "isFlashDeal",
          "isFamilyMustHave",
          "isBestSeller",
          "isNewArrival",
          "isActive",
          "autoCancelSpecialOnLowStock",
          "specialEnabled",
          "isSpecial",
        ].includes(key)
      ) {
        p[key] = !!body[key];
        return;
      }

      p[key] = body[key];
    });

    // 更新后重新计算库存保护与标签（库存保护会重算 price）
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

    const list = await ProductPurchaseBatch.find({ productId: p._id }).sort({ createdAt: -1 });

    return res.json({ success: true, product: toClient(p) });
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

    // 单件成本 & 总件数 & 总成本
    const unitCost = boxPrice / unitsPerBox;
    const totalUnits = boxCount * unitsPerBox;
    const totalCost = boxPrice * boxCount;

    // 建议零售价：unitCost / (1 - 毛利率)
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
      boxPrice,
      boxCount,
      unitsPerBox,
      unitCost: unitCostFixed,
      totalUnits,
      totalCost,
      grossMarginPercent,
      retailPrice: retailPriceFixed,
      expireAt,
      remainingUnits: totalUnits,
    });

    // ⭐ 自动把本批次数量累加到商品总库存上
    p.stock = Number(p.stock || 0) + totalUnits;

    // ⭐ 自动用本批次算出来的零售价更新商品原价（originPrice）
    p.originPrice = retailPriceFixed;

    // 重新跑库存保护 + 自动标签
    applyAutoCancelSpecial(p);
    await p.save();

    const batches = await ProductPurchaseBatch.find({ productId: p._id }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      message: "进货批次已保存",
      product: p,
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

    // 同时把该商品的进货批次删掉
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

    return res.json({ success: true, product: p });
  } catch (err) {
    console.error("切换上/下架出错:", err);
    return res.status(500).json({ success: false, message: err.message || "服务器错误" });
  }
});

export default router;
