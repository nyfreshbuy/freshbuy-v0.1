// backend/src/routes/products_simple.js
import express from "express";
import Product from "../models/product.js";

const router = express.Router();

/**
 * GET /api/products-simple
 * 返回首页用的“简化商品列表”
 */
// ✅ GET /api/products-simple
router.get("/products-simple", async (req, res) => {
  try {
    // 你可以按需加过滤：只拿上架/启用的
    // const filter = { isActive: true, status: { $ne: "off" } };
    const filter = {};

    // ⚠️ 重点：不要用只选部分字段的 select（会把 variants/specialQty 等砍掉）
    // 如果你一定要 select，就必须把下面这些字段全部包含进去
    const list = await Product.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    const out = (Array.isArray(list) ? list : []).map((p) => ({
      _id: String(p._id || ""),
      id: p.id || "",
      sku: p.sku || "",

      name: p.name || "",
      desc: p.desc || "",

      image: p.image || "",
      images: Array.isArray(p.images) ? p.images : [],

      tag: p.tag || "",
      type: p.type || "",
      category: p.category || "",
      subCategory: p.subCategory || "",
      topCategoryKey: p.topCategoryKey || "",

      // ✅ 价格相关（前台会用 originPrice + special 字段决定展示）
      price: Number(p.price || 0),
      originPrice: Number(p.originPrice || 0),

      // ✅ 2 for / 特价字段（必须返回）
      specialEnabled: !!p.specialEnabled,
      specialQty: Number(p.specialQty || 1),
      specialTotalPrice:
        p.specialTotalPrice === null || p.specialTotalPrice === undefined
          ? null
          : Number(p.specialTotalPrice),
      specialPrice:
        p.specialPrice === null || p.specialPrice === undefined
          ? null
          : Number(p.specialPrice),

      specialFrom: p.specialFrom || null,
      specialTo: p.specialTo || null,

      // ✅ variants（整箱价格必须返回）
      variants: Array.isArray(p.variants) ? p.variants : [],

      // 其它你前台可能用到的字段（可留着，避免以后又缺）
      stock: Number(p.stock || 0),
      isActive: p.isActive !== false,
      status: p.status || "on",
      soldCount: Number(p.soldCount || 0),
    }));

    return res.json({ success: true, list: out });
  } catch (err) {
    console.error("GET /api/products-simple error:", err);
    return res.status(500).json({ success: false, message: err.message || "server error" });
  }
});
export default router;
