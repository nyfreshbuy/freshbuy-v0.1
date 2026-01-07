// backend/src/routes/admin_picklist.js
import express from "express";
import Order from "../models/order.js";
import Product from "../models/product.js";
import Zone from "../models/Zone.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();

// 👇 这里就是 picklist.js 在调的接口
router.get("/picklist/summary", requireLogin, async (req, res) => {
  // 这里写聚合逻辑（我下一步可以直接给你完整版本）
});

export default router;
