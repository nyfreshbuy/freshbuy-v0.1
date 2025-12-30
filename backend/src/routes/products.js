// backend/src/routes/products.js
// 在鲜购拼好货 · 通用商品接口（MongoDB 版，保持原返回结构 success/list/total）

import express from "express";
import Product from "../models/Product.js";
import { toClient, toClientList } from "../utils/toClient.js";
const router = express.Router();

// GET /api/products
// 支持的查询参数：
//   ?category=生鲜果蔬
//   ?subCategory=叶菜类
//   ?type=hot|daily|new|best|normal
//   ?flashDeal=true
//   ?keyword=鸡蛋
router.get("/", async (req, res) => {
  try {
    const { category, subCategory, type, flashDeal, keyword } = req.query;

    const filter = {};

    // 默认只返回上架
    filter.isActive = true;

    // 按大类过滤
    if (category) {
      filter.category = {
        $regex: `^${escapeRegex(String(category))}$`,
        $options: "i",
      };
    }

    // 按子类过滤
    if (subCategory) {
      filter.subCategory = {
        $regex: `^${escapeRegex(String(subCategory))}$`,
        $options: "i",
      };
    }

    // 按类型过滤（hot/daily/new/best/normal）
    if (type) {
      filter.type = {
        $regex: `^${escapeRegex(String(type))}$`,
        $options: "i",
      };
    }

    // 仅爆品日（isFlashDeal = true）
    if (flashDeal === "true") {
      filter.isFlashDeal = true;
    }

    // 关键词匹配：名称 / 标签 / 内部ID / SKU / 类目
    if (keyword) {
      const kw = String(keyword).trim();
      if (kw) {
        const re = new RegExp(escapeRegex(kw), "i");
        filter.$or = [
          { name: re },
          { tag: re },
          { internalCompanyId: re },
          { sku: re },
          { category: re },
          { subCategory: re },
        ];
      }
    }

    // 默认按 sortOrder 升序，其次按 id（兼容旧逻辑）
   const docs = await Product.find(filter).sort({ sortOrder: 1, id: 1, createdAt: -1 });

res.json({
  success: true,
  list: toClientList(docs),
  total: docs.length,
});
  } catch (err) {
    console.error("GET /api/products 出错:", err);
    res.status(500).json({
      success: false,
      message: "获取商品列表失败",
      error: err.message,
    });
  }
});

// GET /api/products/:id  获取单个商品详情
// 兼容：先按「id 字段」找（旧内存逻辑），找不到再按 Mongo _id 找
router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id);

    let p = await Product.findOne({ id });

    if (!p) {
      // 尝试用 Mongo ObjectId
      p = await Product.findById(id).catch(() => null);
    }

    if (!p) {
      return res.status(404).json({
        success: false,
        message: "商品不存在: " + id,
      });
    }

    res.json({
  success: true,
  product: toClient(p),
});
  } catch (err) {
    console.error("GET /api/products/:id 出错:", err);
    res.status(500).json({
      success: false,
      message: "获取商品详情失败",
      error: err.message,
    });
  }
});

export default router;

// 防 regex 注入
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
