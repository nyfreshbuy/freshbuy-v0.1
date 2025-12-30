// backend/src/routes/categories.js
// ✅ MongoDB版：从 Product 集合动态聚合分类
// 提供：GET /api/categories

import express from "express";
import Product from "../models/Product.js";

const router = express.Router();
router.use(express.json());

// 你想从哪些字段里生成“分类”
const CATEGORY_FIELDS = ["category", "mainCategory", "type", "tag"];

function cleanName(v) {
  return String(v || "")
    .trim()
    .replace(/[，,;；|/]+/g, " ")
    .replace(/\s+/g, " ");
}

function slugify(v) {
  return cleanName(v)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * GET /api/categories
 * 返回格式（兼容你 index.js）：[{ slug, name }]
 */
router.get("/", async (req, res) => {
  try {
    // 只取在架商品（你项目里一般用 enabled 控制）
    const filter = { enabled: { $ne: false } };

    // 取出少量字段，减少流量
    const docs = await Product.find(filter)
      .select(CATEGORY_FIELDS.join(" "))
      .limit(5000)
      .lean();

    const set = new Map(); // slug -> name

    for (const p of docs) {
      for (const key of CATEGORY_FIELDS) {
        const raw = p?.[key];
        if (!raw) continue;

        // 支持字符串 or 数组
        const arr = Array.isArray(raw) ? raw : [raw];

        for (const item of arr) {
          const name = cleanName(item);
          if (!name) continue;

          // 兼容你之前 "11365，11366" 这种中文逗号情况（这里是分类，顺手做一下分割）
          const parts = name.split(" ").filter(Boolean);
          for (const part of parts) {
            const n = cleanName(part);
            if (!n) continue;

            const slug = slugify(n);
            if (!slug) continue;

            // 去掉太短的噪音
            if (slug.length < 2) continue;

            if (!set.has(slug)) set.set(slug, n);
          }
        }
      }
    }

    // 如果 DB 还没商品，给一个兜底（保证首页不空）
    if (!set.size) {
      return res.json([
        { slug: "home", name: "首页" },
        { slug: "snacks", name: "零食饮品" },
        { slug: "staples", name: "粮油主食" },
        { slug: "household", name: "日用清洁" },
      ]);
    }

    // 输出数组（可按名字排序）
    const list = Array.from(set.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

    return res.json(list);
  } catch (err) {
    console.error("GET /api/categories error:", err);
    return res.status(500).json({ success: false, message: "Load categories failed" });
  }
});

export default router;
