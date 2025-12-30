// backend/src/routes/products_simple.js
import express from "express";
import Product from "../models/product.js";

const router = express.Router();

/**
 * GET /api/products-simple
 * 返回首页用的“简化商品列表”
 */
router.get("/products-simple", async (req, res) => {
  try {
    const docs = await Product.find({})
      .sort({ createdAt: -1 })
      .select(
        "_id name title desc description price originPrice image images cover tag labels type category categoryKey enabled isSpecial stock"
      )
      .lean();

    const items = (docs || []).map((p) => ({
      id: String(p._id),
      name: p.name || p.title || "未命名商品",
      desc: p.desc || p.description || "",
      price: Number(p.price || 0),
      originPrice: p.originPrice != null ? Number(p.originPrice) : undefined,
      image:
        p.image ||
        p.cover ||
        (Array.isArray(p.images) ? p.images[0] : "") ||
        "",
      tag: p.tag || "",
      labels: Array.isArray(p.labels) ? p.labels : [],
      type: p.type || "normal",

      // ⭐ 分类：优先用 categoryKey，没有就回退 category
      categoryKey: p.categoryKey || p.category || "all",

      enabled: p.enabled !== false,
      isSpecial: !!p.isSpecial,
      stock: p.stock != null ? Number(p.stock) : undefined,
    }));

    return res.json({
      success: true,
      ok: true,
      items,
      products: items, // 多给一个字段，防止前端各种写法
      total: items.length,
    });
  } catch (err) {
    console.error("GET /api/products-simple error:", err);
    return res.status(500).json({
      success: false,
      ok: false,
      message: "products-simple 获取失败",
    });
  }
});

export default router;
