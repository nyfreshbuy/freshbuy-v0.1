import express from "express";
import SiteConfig from "../models/SiteConfig.js";

const router = express.Router();
router.use(express.json());

async function getOrCreateDefault() {
  const doc =
    (await SiteConfig.findOne({ key: "default" })) ||
    (await SiteConfig.create({ key: "default" }));
  return doc;
}

// ✅ 用户端/前端读取：GET /api/site-config
router.get("/", async (req, res) => {
  try {
    const doc = await getOrCreateDefault();
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("GET /api/site-config 出错:", err);
    res.status(500).json({ success: false, message: "读取配置失败" });
  }
});

// ✅ 后台保存：POST /api/site-config （你也可以改成 /api/admin/site-config）
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    // 只允许更新这些字段（避免把乱七八糟写进 DB）
    const patch = {};
    if (body.shipping) patch.shipping = body.shipping;
    if (body.friendShipping) patch.friendShipping = body.friendShipping;
    if (body.areaGroup) patch.areaGroup = body.areaGroup;
    if (body.meta) patch.meta = body.meta;

    const doc = await SiteConfig.findOneAndUpdate(
      { key: "default" },
      { $set: patch },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("POST /api/site-config 出错:", err);
    res.status(500).json({ success: false, message: "保存配置失败" });
  }
});

export default router;
