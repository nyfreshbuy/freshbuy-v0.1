// backend/src/routes/admin_inventory.js
import express from "express";
import ProductPurchaseBatch from "../models/ProductPurchaseBatch.js";
import Product from "../models/product.js";
import InventoryAudit from "../models/InventoryAudit.js";
import Order from "../models/order.js";
console.log("✅ admin_inventory.js 最新版本已加载 v20260415");
const router = express.Router();
router.use(express.json());

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// =============================
// 1. 库存净资产总览
// GET /api/admin/inventory/assets/summary
// =============================
router.get("/assets/summary", async (req, res) => {
  try {
    const batches = await ProductPurchaseBatch.find({
      remainingUnits: { $gt: 0 },
    }).lean();

    let totalQty = 0;
    let totalAsset = 0;

    for (const b of batches) {
      const qty = num(b.remainingUnits);
      const unitCost = num(b.finalUnitCost ?? b.unitCost);

      totalQty += qty;
      totalAsset += qty * unitCost;
    }

    // ✅ 正确位置：for循环结束后
    const pendingOrders = await Order.find({
      status: { $in: ["pending"] },
      "payment.status": { $ne: "paid" },
    })
      .select("stockReserve")
      .lean();

    let reservedPendingQty = 0;

    for (const o of pendingOrders) {
      for (const row of o.stockReserve || []) {
        reservedPendingQty += num(row.needUnits);
      }
    }

    res.json({
      success: true,
      data: {
        totalQty,
        totalAsset: Math.round(totalAsset * 100) / 100,
        batchCount: batches.length,

        // ✅ 新增
        reservedPendingQty,
        availableQtyAfterReserve: Math.max(
          0,
          totalQty - reservedPendingQty
        ),
      },
    });
  } catch (e) {
    console.error("GET /api/admin/inventory/assets/summary error:", e);
    res.status(500).json({
      success: false,
      message: e.message || "inventory assets summary failed",
    });
  }
});

// =============================
// 2. 按商品库存资产
// GET /api/admin/inventory/assets/products
// =============================
router.get("/assets/products", async (req, res) => {
  try {
    console.log("🟡 /api/admin/inventory/assets/products start");

    const batches = await ProductPurchaseBatch.find({
      remainingUnits: { $gt: 0 },
    }).lean();

    console.log("🟡 batches length =", batches.length);

    const productIds = [
      ...new Set(
        batches.map((b) => String(b.productId || "")).filter(Boolean)
      ),
    ];

    console.log("🟡 productIds =", productIds);

    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } })
          .select("name sku stock")
          .lean()
      : [];

    console.log("🟡 products length =", products.length);

    const productMap = {};
    for (const p of products) {
      productMap[String(p._id)] = p;
    }

    console.log("🟡 productMap keys =", Object.keys(productMap));

    const map = {};

    for (const b of batches) {
      const productId = String(b.productId || "");
      console.log("🟡 batch productId =", productId, "batchId =", String(b._id || ""));

      if (!productId) continue;

      const productStock = num(productMap[productId]?.stock);

      if (!map[productId]) {
        map[productId] = {
          productId,
          name: productMap[productId]?.name || "[商品已删除或未匹配]",
          sku: productMap[productId]?.sku || "",
          qty: 0,
          productStock,
          diffQty: 0,
          asset: 0,
        };
      }

      const qty = num(b.remainingUnits);
      const unitCost = num(b.finalUnitCost ?? b.unitCost);

      map[productId].qty += qty;
      map[productId].asset += qty * unitCost;
      map[productId].productStock = productStock;
      map[productId].diffQty = productStock - map[productId].qty;
    }

    const list = Object.values(map)
      .map((x) => ({
        ...x,
        asset: Math.round(x.asset * 100) / 100,
      }))
      .sort((a, b) => b.asset - a.asset);

    console.log("🟡 final list length =", list.length);

    return res.json({
      success: true,
      data: list,
    });
  } catch (e) {
    console.error("🔥 GET /api/admin/inventory/assets/products error:");
    console.error(e?.stack || e);
    return res.status(500).json({
      success: false,
      message: e.message || "inventory assets products failed",
    });
  }
});
// =============================
// 3. 按批次库存资产
// GET /api/admin/inventory/assets/batches
// =============================
router.get("/assets/batches", async (req, res) => {
  try {
    const batches = await ProductPurchaseBatch.find({
      remainingUnits: { $gt: 0 },
    })
      .sort({ purchaseDate: 1, createdAt: 1 })
      .lean();

    const productIds = [
      ...new Set(
        batches.map((b) => String(b.productId || "")).filter(Boolean)
      ),
    ];

    const products = await Product.find({ _id: { $in: productIds } })
      .select("name sku")
      .lean();

    const productMap = {};
    for (const p of products) {
      productMap[String(p._id)] = p;
    }

    const list = batches.map((b) => {
      const qty = num(b.remainingUnits);
      const unitCost = num(b.finalUnitCost || b.unitCost);

      return {
        _id: b._id,
        productId: b.productId,
        name: productMap[String(b.productId)]?.name || "",
        sku: productMap[String(b.productId)]?.sku || "",
        batchNo: b.batchNo || "",
        purchaseDate: b.purchaseDate || null,
        remainingUnits: qty,
        unitCost,
        asset: Math.round(qty * unitCost * 100) / 100,
        supplierName: b.supplierName || "",
      };
    });

    res.json({
      success: true,
      data: list,
    });
  } catch (e) {
    console.error("GET /api/admin/inventory/assets/batches error:", e);
    res.status(500).json({
      success: false,
      message: e.message || "inventory assets batches failed",
    });
  }
});

// =============================
// 4. 创建盘点单
// POST /api/admin/inventory/audits
// =============================
router.post("/audits", async (req, res) => {
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (!rawItems.length) {
      return res.status(400).json({
        success: false,
        message: "items 不能为空",
      });
    }

    const productIds = rawItems.map((x) => x.productId).filter(Boolean);

    const products = await Product.find({ _id: { $in: productIds } })
      .select("name sku stock cost")
      .lean();

    const productMap = {};
    for (const p of products) {
      productMap[String(p._id)] = p;
    }

    let totalDiffQty = 0;
    let totalDiffAmount = 0;

    const items = rawItems.map((it) => {
      const productId = String(it.productId || "");
      const p = productMap[productId];

      if (!p) {
        throw new Error(`商品不存在: ${productId}`);
      }

      const systemStock = num(p.stock);
      const actualStock = num(it.actualStock);
      const diffQty = actualStock - systemStock;
      const avgUnitCost = num(it.avgUnitCost ?? p.cost);
      const diffAmount = diffQty * avgUnitCost;

      totalDiffQty += diffQty;
      totalDiffAmount += diffAmount;

      return {
        productId,
        productName: p.name || "",
        sku: p.sku || "",
        systemStock,
        actualStock,
        diffQty,
        avgUnitCost,
        diffAmount: Math.round(diffAmount * 100) / 100,
        note: String(it.note || ""),
      };
    });

    const now = new Date();
    const auditNo =
      "IA" +
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "-" +
      String(Date.now()).slice(-6);

    const doc = await InventoryAudit.create({
      auditNo,
      auditDate: now,
      items,
      totalDiffQty,
      totalDiffAmount: Math.round(totalDiffAmount * 100) / 100,
      createdBy: req.user?._id || req.user?.id || null,
      createdByName: req.user?.name || req.user?.username || "",
      note: String(body.note || ""),
    });

    // 先做简单版：同步修正 product.stock
    for (const it of items) {
  await Product.updateOne(
    { _id: it.productId },
    { $set: { stock: it.actualStock } }
  );

  const activeBatches = await ProductPurchaseBatch.find({
    productId: it.productId,
    remainingUnits: { $gt: 0 },
  }).sort({ purchaseDate: 1, createdAt: 1 });

  let left = num(it.actualStock);

  for (const b of activeBatches) {
    if (left <= 0) {
      b.remainingUnits = 0;
      b.status = "depleted";
      await b.save();
      continue;
    }

    const canUse = Math.min(num(b.totalUnits), left);
    b.remainingUnits = canUse;
    b.status = canUse > 0 ? "active" : "depleted";
    await b.save();
    left -= canUse;
  }
}

    res.json({
      success: true,
      data: doc,
    });
  } catch (e) {
    console.error("POST /api/admin/inventory/audits error:", e);
    res.status(500).json({
      success: false,
      message: e.message || "create inventory audit failed",
    });
  }
});

// =============================
// 5. 盘点单列表
// GET /api/admin/inventory/audits
// =============================
router.get("/audits", async (req, res) => {
  try {
    const list = await InventoryAudit.find({})
      .sort({ auditDate: -1, createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      data: list,
    });
  } catch (e) {
    console.error("GET /api/admin/inventory/audits error:", e);
    res.status(500).json({
      success: false,
      message: e.message || "get audits failed",
    });
  }
});

// =============================
// 6. 盘点单详情
// GET /api/admin/inventory/audits/:id
// =============================
router.get("/audits/:id", async (req, res) => {
  try {
    const doc = await InventoryAudit.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "盘点单不存在",
      });
    }

    res.json({
      success: true,
      data: doc,
    });
  } catch (e) {
    console.error("GET /api/admin/inventory/audits/:id error:", e);
    res.status(500).json({
      success: false,
      message: e.message || "get audit failed",
    });
  }
});

export default router;