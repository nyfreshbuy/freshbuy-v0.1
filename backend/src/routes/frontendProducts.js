// backend/src/routes/frontendProducts.js
// 前台首页专区：家庭必备 / 畅销 / 新品 / 周五爆品日（MongoDB版）

import express from "express";
import Product from "../models/product.js";
import FlashSale from "../models/FlashSale.js"; // ✅ 需要你有这个模型（没有就看下面注释说明）

const router = express.Router();
router.use(express.json());

// ========= 工具：统一前端字段 =========
function normalizeProduct(p) {
  return {
    _id: String(p._id),
    id: String(p._id), // ✅ 兼容旧前端用 id
    name: p.name || "",
    desc: p.desc || "",
    price: Number(p.price || 0),
    originPrice: Number(p.originPrice || 0),
    image: p.image || "",
    tag: p.tag || "",
    type: p.type || "",
    category: p.category || "",

    // 标记字段（你前端分类/标签用得到）
    isSpecial: !!p.isSpecial,
    isHot: !!p.isHot,
    isFamily: !!p.isFamily,
    isBestSeller: !!p.isBestSeller,
    isNew: !!p.isNew,

    // 你旧逻辑里用过这些名字，这里也兼容给出来
    isFamilyMustHave: !!(p.isFamilyMustHave || p.isFamily),
    soldCount: Number(p.soldCount || 0),
    sortOrder: Number(p.sortOrder || 0),

    enabled: p.enabled !== false,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ========= 工具：在架判断（DB版） =========
function activeFilter() {
  // ✅ 你 DB 里建议用 enabled 控制上下架
  // 兼容你旧字段：isActive / status
  return {
    $and: [
      { $or: [{ enabled: { $exists: false } }, { enabled: true }] },
      { $or: [{ isActive: { $exists: false } }, { isActive: true }] },
      { $or: [{ status: { $exists: false } }, { status: { $ne: "off" } }] },
    ],
  };
}

/**
 * 家庭必备
 * - 旧逻辑：isFamilyMustHave = true
 * - MongoDB：兼容 isFamilyMustHave 或 isFamily
 */
router.get("/family-essential", async (req, res) => {
  try {
    const docs = await Product.find({
      ...activeFilter(),
      $or: [{ isFamilyMustHave: true }, { isFamily: true }],
    })
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(60)
      .lean();

    const items = docs.map(normalizeProduct);
    return res.json({ success: true, items });
  } catch (err) {
    console.error("家庭必备接口报错:", err);
    return res.status(500).json({ success: false, message: "加载家庭必备商品失败" });
  }
});

/**
 * 畅销产品
 * - 旧逻辑：按 soldCount 降序
 * - DB：soldCount 字段如果没有，就会全是 0（仍然正常返回）
 */
router.get("/best-sellers", async (req, res) => {
  try {
    const docs = await Product.find(activeFilter())
      .sort({ soldCount: -1, createdAt: -1 })
      .limit(50)
      .lean();

    const items = docs.map(normalizeProduct);
    return res.json({ success: true, items });
  } catch (err) {
    console.error("畅销产品接口报错:", err);
    return res.status(500).json({ success: false, message: "加载畅销商品失败" });
  }
});

/**
 * 新品上市
 * - 旧逻辑：7天内创建 或 isNewArrival
 * - DB：兼容 isNewArrival 或 isNew
 */
router.get("/new-arrivals", async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const docs = await Product.find({
      ...activeFilter(),
      $or: [{ isNewArrival: true }, { isNew: true }, { createdAt: { $gte: sevenDaysAgo } }],
    })
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();

    const items = docs.map(normalizeProduct);
    return res.json({ success: true, items });
  } catch (err) {
    console.error("新品上市接口报错:", err);
    return res.status(500).json({ success: false, message: "加载新品上市失败" });
  }
});

/**
 * 周五爆品日 / 秒杀专区（DB版）
 * - 来源：FlashSale 集合（enabled=true + 时间有效）
 * - 再用 productId 关联 Product
 * - 返回 items：把 price 替换成 flashPrice，但不改原商品
 */
router.get("/friday-deals", async (req, res) => {
  try {
    const now = new Date();

    const flashes = await FlashSale.find({
      enabled: true,
      $and: [
        { $or: [{ start: { $exists: false } }, { start: null }, { start: { $lte: now } }] },
        { $or: [{ end: { $exists: false } }, { end: null }, { end: { $gte: now } }] },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    if (!flashes.length) {
      return res.json({ success: true, items: [] });
    }

    const productIds = flashes
      .map((f) => f.productId)
      .filter(Boolean)
      .map((x) => String(x));

    const products = await Product.find({
      ...activeFilter(),
      _id: { $in: productIds },
    }).lean();

    const mapById = new Map(products.map((p) => [String(p._id), p]));

    const items = flashes
      .map((fs) => {
        const base = mapById.get(String(fs.productId));
        if (!base) return null;

        const merged = normalizeProduct(base);

        return {
          ...merged,
          // ✅ 前台显示价用秒杀价
          price: Number(fs.flashPrice || merged.price || merged.originPrice || 0),

          // ✅ 爆品日相关字段
          isFlashDeal: true,
          flashSaleId: String(fs._id),
          flashTag: fs.tag || "爆品日",
          flashLimitQty: Number(fs.limitQty || 0),
          flashStart: fs.start || null,
          flashEnd: fs.end || null,
        };
      })
      .filter(Boolean);

    return res.json({ success: true, items });
  } catch (err) {
    console.error("周五爆品日接口报错:", err);
    return res.status(500).json({ success: false, message: "加载周五爆品日商品失败" });
  }
});

/**
 * 心跳测试
 * GET /api/frontend/products/ping（看你 server.js 挂载路径）
 */
router.get("/ping", (req, res) => {
  res.json({ success: true, message: "frontend products router OK (db)" });
});

export default router;
