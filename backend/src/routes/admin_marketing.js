import express from "express";
import Product from "../models/product.js";
import FlashSale from "../models/FlashSale.js";

import MarketingConfig from "../models/MarketingConfig.js";
import MarketingCampaign from "../models/MarketingCampaign.js";

import Coupon from "../models/Coupon.js";
import Promotion from "../models/Promotion.js";
import ShareShippingConfig from "../models/ShareShippingConfig.js";
import PointsAccount from "../models/PointsAccount.js";
const router = express.Router();
router.use(express.json());

console.log("🚀 admin_marketing_db.js (MongoDB版-恢复旧路径) 已加载");

// ---------- 工具函数 ----------
function isTimeInRange(start, end, now = new Date()) {
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  if (s && now < s) return false;
  if (e && now > e) return false;
  return true;
}
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function findProductByAnyId(idParam) {
  const s = String(idParam || "").trim();
  if (!s) return null;
  const byMongoId = await Product.findById(s).catch(() => null);
  if (byMongoId) return byMongoId;
  const byLegacyId = await Product.findOne({ id: s }).catch(() => null);
  if (byLegacyId) return byLegacyId;
  return null;
}

// ==========================
// 0) referrals（恢复旧前端需要的接口，避免 404）
// GET /api/admin/marketing/marketing/referrals
// ==========================
router.get("/marketing/referrals", async (req, res) => {
  return res.json({ success: true, items: [], total: 0 });
});

// ==========================
// 1) 营销配置（旧路径）
// GET/POST /api/admin/marketing/marketing/config
// ==========================
router.get("/marketing/config", async (req, res) => {
  const list = await MarketingConfig.find().sort({ createdAt: -1 });
  res.json({ success: true, items: list });
});

router.post("/marketing/config", async (req, res) => {
  const { key, enabled, value, desc } = req.body || {};
  if (!key) return res.json({ success: false, message: "key 不能为空" });

  const doc = await MarketingConfig.findOneAndUpdate(
    { key },
    { enabled, value, desc },
    { upsert: true, new: true }
  );

  res.json({ success: true, item: doc });
});

// ==========================
// 2) 活动 campaigns（旧路径）
// GET/POST /api/admin/marketing/marketing/campaigns
// PATCH/DELETE /api/admin/marketing/marketing/campaigns/:id
// ==========================
router.get("/marketing/campaigns", async (req, res) => {
  const list = await MarketingCampaign.find().sort({ createdAt: -1 });
  res.json({ success: true, items: list });
});

router.post("/marketing/campaigns", async (req, res) => {
  const { title, type, startAt, endAt, content } = req.body || {};
  if (!title || !type) return res.json({ success: false, message: "title/type 不能为空" });

  const doc = await MarketingCampaign.create({
    title,
    type,
    startAt,
    endAt,
    content,
    createdBy: "admin",
  });

  res.json({ success: true, item: doc });
});

router.patch("/marketing/campaigns/:id", async (req, res) => {
  const { enabled } = req.body || {};
  await MarketingCampaign.findByIdAndUpdate(req.params.id, { enabled });
  res.json({ success: true });
});

router.delete("/marketing/campaigns/:id", async (req, res) => {
  await MarketingCampaign.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// =======================
// 3) 优惠券 coupons（旧路径）
// GET/POST /api/admin/marketing/marketing/coupons
// PATCH /api/admin/marketing/marketing/coupons/:id/toggle
// DELETE /api/admin/marketing/marketing/coupons/:id
// =======================
router.get("/marketing/coupons", async (req, res) => {
  const list = await Coupon.find().sort({ createdAt: -1 });
  res.json({ success: true, list });
});

router.post("/marketing/coupons", async (req, res) => {
  const {
    title,
    type = "cash",
    amount = 0,
    minSpend = 0,
    validFrom,
    validTo,
    limitUse = 0,
  } = req.body || {};

  if (!title) return res.status(400).json({ success: false, message: "优惠券名称必填" });

  const doc = await Coupon.create({
    title,
    type,
    amount: Number(amount) || 0,
    minSpend: Number(minSpend) || 0,
    validFrom: validFrom ? new Date(validFrom) : null,
    validTo: validTo ? new Date(validTo) : null,
    limitUse: Number(limitUse) || 0,
    status: "active",
  });

  res.json({ success: true, data: doc });
});

router.patch("/marketing/coupons/:id/toggle", async (req, res) => {
  const c = await Coupon.findById(req.params.id);
  if (!c) return res.status(404).json({ success: false, message: "优惠券不存在" });
  c.status = c.status === "active" ? "disabled" : "active";
  await c.save();
  res.json({ success: true, data: c });
});

router.delete("/marketing/coupons/:id", async (req, res) => {
  const deleted = await Coupon.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ success: false, message: "优惠券不存在" });
  res.json({ success: true });
});

// =======================
// 4) 满减活动 promotions（旧路径）
// GET/POST /api/admin/marketing/marketing/promotions
// PATCH /api/admin/marketing/marketing/promotions/:id/toggle
// DELETE /api/admin/marketing/marketing/promotions/:id
// =======================
router.get("/marketing/promotions", async (req, res) => {
  const list = await Promotion.find().sort({ createdAt: -1 });
  res.json({ success: true, list });
});

router.post("/marketing/promotions", async (req, res) => {
  const {
    name,
    ruleType = "cart_fullcut",
    threshold = 0,
    discount = 0,
    validFrom,
    validTo,
    note,
  } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: "活动名称必填" });

  const doc = await Promotion.create({
    name,
    ruleType,
    threshold: Number(threshold) || 0,
    discount: Number(discount) || 0,
    validFrom: validFrom ? new Date(validFrom) : null,
    validTo: validTo ? new Date(validTo) : null,
    enabled: true,
    note: note || "",
  });

  res.json({ success: true, data: doc });
});

router.patch("/marketing/promotions/:id/toggle", async (req, res) => {
  const p = await Promotion.findById(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "活动不存在" });
  p.enabled = !p.enabled;
  await p.save();
  res.json({ success: true, data: p });
});

router.delete("/marketing/promotions/:id", async (req, res) => {
  const deleted = await Promotion.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ success: false, message: "活动不存在" });
  res.json({ success: true });
});

// =======================
// 5) 拼运费配置 share-shipping（旧路径）
// GET/POST /api/admin/marketing/marketing/share-shipping
// =======================
router.get("/marketing/share-shipping", async (req, res) => {
  const doc =
    (await ShareShippingConfig.findOne({ key: "default" })) ||
    (await ShareShippingConfig.create({ key: "default", steps: [] }));
  res.json({ success: true, data: doc });
});

router.post("/marketing/share-shipping", async (req, res) => {
  const body = req.body || {};
  const patch = {
    baseFee: Number(body.baseFee) || 4.99,
    expireMinutes: Number(body.expireMinutes) || 15,
    steps: Array.isArray(body.steps)
      ? body.steps.map((s) => ({ people: Number(s.people) || 0, price: Number(s.price) || 0 }))
      : [],
  };

  const doc = await ShareShippingConfig.findOneAndUpdate(
    { key: "default" },
    patch,
    { upsert: true, new: true }
  );
  res.json({ success: true, data: doc });
});

// =======================
// 6) 商品搜索 search-product（旧路径）
// GET /api/admin/marketing/marketing/search-product?keyword=xxx
// =======================
router.get("/marketing/search-product", async (req, res) => {
  try {
    const kw = String(req.query.keyword || "").trim();
    if (!kw) return res.json({ success: true, items: [] });

    const re = new RegExp(escapeRegex(kw), "i");
    const filter = {
      isActive: true,
      $or: [
        { name: re },
        { sku: re },
        { tag: re },
        { internalCompanyId: re },
        { supplierCompanyId: re },
        { category: re },
        { subCategory: re },
      ],
    };

    const matched = await Product.find(filter).sort({ sortOrder: 1, createdAt: -1 }).limit(20);
    return res.json({ success: true, items: matched });
  } catch (err) {
    console.error("搜索商品失败:", err);
    return res.status(500).json({ success: false, message: "搜索商品失败" });
  }
});

// =======================
// 7) 秒杀 flash-sales（旧路径）
// GET/POST /api/admin/marketing/marketing/flash-sales
// DELETE /api/admin/marketing/marketing/flash-sales/:id
// =======================
router.get("/marketing/flash-sales", async (req, res) => {
  try {
    const now = new Date();
    const listRaw = await FlashSale.find().sort({ createdAt: -1 });

    const list = [];
    for (const f of listRaw) {
      let productName = f.productName || "";
      if (!productName && f.productId) {
        const p = await Product.findById(f.productId).catch(() => null);
        if (p) productName = p.name || "";
      }
      list.push({
        ...f.toObject(),
        productName,
        active: !!f.enabled && isTimeInRange(f.start, f.end, now),
      });
    }

    return res.json({ success: true, list });
  } catch (err) {
    console.error("获取秒杀失败:", err);
    return res.status(500).json({ success: false, message: "获取秒杀失败" });
  }
});

router.post("/marketing/flash-sales", async (req, res) => {
  try {
    const { productId, flashPrice, limitQty = 0, start, end, tag = "爆品日" } = req.body || {};

    const pid = String(productId || "").trim();
    if (!pid) return res.status(400).json({ success: false, message: "必须选择商品" });

    const priceNum = Number(flashPrice);
    if (!priceNum || priceNum <= 0)
      return res.status(400).json({ success: false, message: "秒杀价必须大于0" });

    const product = await findProductByAnyId(pid);
    if (!product) return res.status(404).json({ success: false, message: "未找到对应商品" });

    const cloned = await Product.create({
      name: product.name,
      desc: product.desc,
      sku: product.sku,
      category: product.category,
      subCategory: product.subCategory,
      image: product.image,
      images: Array.isArray(product.images) ? product.images : [],
      isFlashDeal: true,
      tag: tag || "爆品日",
      originPrice: Number(product.originPrice || product.price || 0),
      price: priceNum,
      specialEnabled: true,
      specialPrice: priceNum,
      isActive: true,
      status: "on",
      stock: typeof product.stock === "number" ? product.stock : 9999,
      sortOrder: typeof product.sortOrder === "number" ? product.sortOrder : 99999,
      originProductId: product._id.toString(),
    });

    const record = await FlashSale.create({
      productId: product._id,
      clonedProductId: cloned._id,
      productName: product.name,
      flashPrice: priceNum,
      limitQty: Number(limitQty) || 0,
      start: start ? new Date(start) : null,
      end: end ? new Date(end) : null,
      enabled: true,
      tag,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    console.error("创建秒杀失败:", err);
    return res.status(500).json({ success: false, message: "创建秒杀失败" });
  }
});

router.delete("/marketing/flash-sales/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await FlashSale.findByIdAndDelete(id).catch(() => null);
    if (!deleted) return res.status(404).json({ success: false, message: "秒杀记录不存在" });

    if (deleted.clonedProductId) {
      await Product.findByIdAndDelete(deleted.clonedProductId).catch(() => null);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("删除秒杀失败:", err);
    return res.status(500).json({ success: false, message: "删除失败" });
  }
});

// =======================
// 8) 积分系统 points（旧路径）
// GET  /api/admin/marketing/marketing/points/:userId
// POST /api/admin/marketing/marketing/points/:userId/earn
// POST /api/admin/marketing/marketing/points/:userId/use
// =======================
router.get("/marketing/points/:userId", async (req, res) => {
  const userId = req.params.userId;
  const doc = await PointsAccount.findOne({ userId });
  return res.json({ success: true, data: doc || null });
});

router.post("/marketing/points/:userId/earn", async (req, res) => {
  const userId = req.params.userId;
  const { amount, remark } = req.body || {};
  const num = Number(amount) || 0;
  if (!num) return res.status(400).json({ success: false, message: "数量必须大于 0" });

  const now = new Date().toISOString();
  const doc = await PointsAccount.findOneAndUpdate(
    { userId },
    {
      $inc: { points: num },
      $push: { logs: { amount: num, type: "earn", remark: remark || "", time: now } },
    },
    { upsert: true, new: true }
  );

  return res.json({ success: true, data: doc });
});

router.post("/marketing/points/:userId/use", async (req, res) => {
  const userId = req.params.userId;
  const { amount, remark } = req.body || {};
  const num = Number(amount) || 0;
  if (!num) return res.status(400).json({ success: false, message: "数量必须大于 0" });

  const now = new Date().toISOString();
  const doc = await PointsAccount.findOne({ userId });
  if (!doc) return res.json({ success: true, data: { userId, points: 0, logs: [] } });

  doc.points -= num;
  if (doc.points < 0) doc.points = 0;
  doc.logs.push({ amount: num, type: "use", remark: remark || "", time: now });
  await doc.save();

  return res.json({ success: true, data: doc });
});

export default router;
