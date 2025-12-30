// backend/src/routes/admin.js  ✅ MongoDB 版（替代内存版）
// 路由挂载通常是：app.use("/api/admin", adminRouter);

import express from "express";
import Product from "../models/product.js";
// 如果你有管理员鉴权，可打开：import { requireAdmin } from "../middlewares/admin.js";

const router = express.Router();
router.use(express.json());

// router.use(requireAdmin); // 你如果已经有管理员鉴权，就打开这行

// ========== 工具：统一返回结构 ==========
function normalizeProduct(p) {
  if (!p) return null;
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
    isSpecial: !!p.isSpecial,
    isHot: !!p.isHot,
    isFamily: !!p.isFamily,
    isBestSeller: !!p.isBestSeller,
    isNew: !!p.isNew,
    enabled: p.enabled !== false,
    limitQty: Number(p.limitQty || 0),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/* ========= 商品管理（DB版） ========= */

// 列表
// GET /api/admin/products
router.get("/products", async (req, res) => {
  try {
    // 可选：支持查询参数
    // ?enabled=1 / 0
    // ?q=keyword
    const enabled = req.query.enabled;
    const q = String(req.query.q || "").trim();

    const filter = {};
    if (enabled === "1" || enabled === "true") filter.enabled = true;
    if (enabled === "0" || enabled === "false") filter.enabled = false;

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { tag: { $regex: q, $options: "i" } },
        { type: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
      ];
    }

    const docs = await Product.find(filter).sort({ createdAt: -1 }).lean();

    const list = docs.map(normalizeProduct);

    return res.json({
      success: true,
      list,     // ✅ 兼容你的后台
      products: list,
      items: list,
      total: list.length,
    });
  } catch (err) {
    console.error("GET /api/admin/products error:", err);
    return res.status(500).json({ success: false, message: "加载商品失败" });
  }
});

// 新建
// POST /api/admin/products
router.post("/products", async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const desc = String(body.desc || "").trim();
    const price = Number(body.price);
    const originPrice = body.originPrice !== undefined ? Number(body.originPrice) : 0;

    if (!name || Number.isNaN(price)) {
      return res.status(400).json({
        success: false,
        message: "商品名称和价格必填（price 必须是数字）",
      });
    }

    const doc = await Product.create({
      name,
      desc,
      price,
      originPrice: Number.isNaN(originPrice) ? 0 : originPrice,

      image: String(body.image || "").trim(),
      tag: String(body.tag || "").trim(),
      type: String(body.type || "normal").trim(),
      category: String(body.category || "").trim(),

      isSpecial: !!body.isSpecial,
      isHot: !!body.isHot,
      isFamily: !!body.isFamily,
      isBestSeller: !!body.isBestSeller,
      isNew: !!body.isNew,

      enabled: body.enabled === undefined ? true : !!body.enabled,
      limitQty: body.limitQty !== undefined ? Number(body.limitQty) : 0,
    });

    return res.json({
      success: true,
      message: "商品已添加（DB版）",
      product: normalizeProduct(doc),
    });
  } catch (err) {
    console.error("POST /api/admin/products error:", err);
    return res.status(500).json({ success: false, message: "创建商品失败" });
  }
});

// 更新（你原来是 PUT）
// PUT /api/admin/products/:id
router.put("/products/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id 不能为空" });

    const body = req.body || {};
    const update = {};

    // 只更新你传来的字段（避免把 undefined 写进库）
    if (body.name !== undefined) update.name = String(body.name || "").trim();
    if (body.desc !== undefined) update.desc = String(body.desc || "").trim();
    if (body.price !== undefined) update.price = Number(body.price);
    if (body.originPrice !== undefined) update.originPrice = Number(body.originPrice);
    if (body.image !== undefined) update.image = String(body.image || "").trim();
    if (body.tag !== undefined) update.tag = String(body.tag || "").trim();
    if (body.type !== undefined) update.type = String(body.type || "").trim();
    if (body.category !== undefined) update.category = String(body.category || "").trim();

    if (body.isSpecial !== undefined) update.isSpecial = !!body.isSpecial;
    if (body.isHot !== undefined) update.isHot = !!body.isHot;
    if (body.isFamily !== undefined) update.isFamily = !!body.isFamily;
    if (body.isBestSeller !== undefined) update.isBestSeller = !!body.isBestSeller;
    if (body.isNew !== undefined) update.isNew = !!body.isNew;

    if (body.enabled !== undefined) update.enabled = !!body.enabled;
    if (body.limitQty !== undefined) update.limitQty = Number(body.limitQty);

    // 数字校验（可选但建议）
    if (update.price !== undefined && Number.isNaN(update.price)) {
      return res.status(400).json({ success: false, message: "price 必须是数字" });
    }
    if (update.originPrice !== undefined && Number.isNaN(update.originPrice)) {
      return res.status(400).json({ success: false, message: "originPrice 必须是数字" });
    }
    if (update.limitQty !== undefined && Number.isNaN(update.limitQty)) {
      update.limitQty = 0;
    }

    const doc = await Product.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "商品不存在" });

    return res.json({ success: true, product: normalizeProduct(doc) });
  } catch (err) {
    console.error("PUT /api/admin/products/:id error:", err);
    return res.status(500).json({ success: false, message: "更新商品失败" });
  }
});

// 删除
// DELETE /api/admin/products/:id
router.delete("/products/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id 不能为空" });

    // ✅ 硬删除（完全移除）
    const doc = await Product.findByIdAndDelete(id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "商品不存在" });

    return res.json({ success: true });

    // ✅ 如果你想改成软删除（更安全），用下面替代：
    // const doc = await Product.findByIdAndUpdate(id, { $set: { enabled: false } }, { new: true }).lean();
    // if (!doc) return res.status(404).json({ success: false, message: "商品不存在" });
    // return res.json({ success: true, product: normalizeProduct(doc) });
  } catch (err) {
    console.error("DELETE /api/admin/products/:id error:", err);
    return res.status(500).json({ success: false, message: "删除商品失败" });
  }
});

/* ========= 仪表盘接口（先保留测试版 0） ========= */
// 你后面要做 DB 聚合（Orders/GMV/毛利）我再给你接 Order 模型聚合
router.get("/dashboard", (req, res) => {
  const summary = {
    orderCount: 0,
    gmv: 0,
    grossProfit: 0,
    avgOrderValue: 0,
  };

  const byShippingMode = {
    single: { count: 0, gmv: 0 },
    friend: { count: 0, gmv: 0 },
    area: { count: 0, gmv: 0 },
    pickup: { count: 0, gmv: 0 },
  };

  res.json({
    success: true,
    summary,
    byShippingMode,
  });
});

export default router;
