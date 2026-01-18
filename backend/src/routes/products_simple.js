// backend/src/routes/products_simple.js
import express from "express";
import Product from "../models/product.js";

const router = express.Router();

/**
 * ✅ /api/products-simple
 * 返回：variants + specialEnabled/specialQty/specialTotalPrice
 * 同时兼容 items/list/products 三种字段，避免前端有多个页面引用不同字段名
 */
router.get("/products-simple", async (req, res) => {
  try {
    // 你如果只想展示上架商品，可以换成：
    // const filter = { isActive: true, status: { $ne: "off" } };
    const filter = {};

    const list = await Product.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();

    const items = (Array.isArray(list) ? list : []).map((p) => {
      // 图片标准化：确保返回 /uploads/xxx
      const img = String(p.image || "").trim();
      const normImage =
        img && (img.startsWith("/uploads/") || img.startsWith("http"))
          ? img
          : img
          ? img.startsWith("uploads/")
            ? "/" + img
            : "/uploads/" + img.replace(/^\.\/uploads\//, "")
          : "";

      return {
        _id: String(p._id || ""),
        id: p.id || "",
        sku: p.sku || "",

        name: p.name || "",
        desc: p.desc || "",

        image: normImage,
        images: Array.isArray(p.images) ? p.images : [],

        tag: p.tag || "",
        type: p.type || "",
        category: p.category || "",
        subCategory: p.subCategory || "",
        topCategoryKey: p.topCategoryKey || "",

        price: Number(p.price || 0),
        originPrice: Number(p.originPrice || 0),

        // ✅ 2 for / 特价字段（前台要用）
        specialEnabled: !!p.specialEnabled,
        specialQty: Number(p.specialQty || 1),
        specialTotalPrice:
          p.specialTotalPrice === null || p.specialTotalPrice === undefined
            ? null
            : Number(p.specialTotalPrice),
        specialPrice:
          p.specialPrice === null || p.specialPrice === undefined ? null : Number(p.specialPrice),
        specialFrom: p.specialFrom || null,
        specialTo: p.specialTo || null,

        // ✅ 整箱规格（前台要用）
        variants: Array.isArray(p.variants) ? p.variants : [],

        stock: Number(p.stock || 0),
        isActive: p.isActive !== false,
        status: p.status || "on",
        soldCount: Number(p.soldCount || 0),
      };
    });

    // ✅ 返回多份字段名，防止前端不同页面写法不一致
    return res.json({ success: true, ok: true, items, list: items, products: items });
  } catch (err) {
    console.error("GET /api/products-simple error:", err);
    return res.status(500).json({ success: false, message: err.message || "server error" });
  }
});

export default router;
