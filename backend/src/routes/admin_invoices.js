import express from "express";
import path from "path";
import * as url from "url";
import PDFDocument from "pdfkit";
import mongoose from "mongoose";
import Invoice from "../models/Invoice.js";
import Product from "../models/product.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());
router.use(requireLogin);

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ---------- 金额计算 ----------
function computeTotals(items = []) {
  let subtotal = 0;
  const clean = (items || []).map((it) => {
    const qty = Number(it.qty || 0);
    const unitPrice = Number(it.unitPrice || 0);
    const lineTotal = Math.round(qty * unitPrice * 100) / 100;
    subtotal += lineTotal;

    return {
      ...it,
      qty,
      unitPrice,
      lineTotal,
      // unitCount 先给兜底，后面会用 DB 校正
      unitCount: Math.max(1, Math.floor(Number(it.unitCount || 1))),
    };
  });

  subtotal = Math.round(subtotal * 100) / 100;
  return { items: clean, subtotal, total: subtotal };
}

// ---------- 当天递增 invoiceNo：YYYYMMDD-001 ----------
async function genInvoiceNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const ymd = `${y}${m}${d}`;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const count = await Invoice.countDocuments({ createdAt: { $gte: start, $lte: end } });
  const seq = String(count + 1).padStart(3, "0");
  return `${ymd}-${seq}`;
}

// ---------- 从 Product 校正 unitCount（按 variantKey 找） ----------
async function normalizeItemsByDB(items, session) {
  const out = [];
  for (const it of items || []) {
    // 手填行：不校正、不扣库存
    if (!it.productId) {
      out.push({
        ...it,
        unitCount: 1,
        variantKey: "",
      });
      continue;
    }

    const p = await Product.findById(it.productId).session(session);
    if (!p) throw new Error(`商品不存在: ${it.productId}`);

    const variantKey = String(it.variantKey || "single");
    const v = Array.isArray(p.variants) ? p.variants.find((x) => x && x.key === variantKey) : null;

    // 找不到规格就默认 1（相当于 single）
    const unitCount = v?.unitCount ? Math.max(1, Math.floor(Number(v.unitCount))) : 1;

    // code 默认用 sku（你 sku 可能为空，允许前端手填）
    const code = String(it.productCode || p.sku || "");

    out.push({
      ...it,
      variantKey,
      unitCount,
      productCode: code,
      description: String(it.description || p.name || ""),
    });
  }
  return out;
}

// ---------- 扣库存：qty * unitCount ----------
async function applyStockDeduction(items, session) {
  for (const it of items || []) {
    if (!it.productId) continue;

    const qty = Number(it.qty || 0);
    const unitCount = Math.max(1, Math.floor(Number(it.unitCount || 1)));
    const units = qty * unitCount;
    if (units <= 0) continue;

    const ok = await Product.findOneAndUpdate(
      { _id: it.productId, stock: { $gte: units } },
      { $inc: { stock: -units } },
      { new: true, session }
    );

    if (!ok) {
      throw new Error(`库存不足：${it.description || it.productCode || it.productId}`);
    }
  }
}

// ---------- 回滚库存：把旧 invoice 扣掉的加回去 ----------
async function revertStock(invoiceDoc, session) {
  for (const it of invoiceDoc?.items || []) {
    if (!it.productId) continue;

    const qty = Number(it.qty || 0);
    const unitCount = Math.max(1, Math.floor(Number(it.unitCount || 1)));
    const units = qty * unitCount;
    if (units <= 0) continue;

    await Product.findByIdAndUpdate(it.productId, { $inc: { stock: units } }, { session });
  }
}

// =====================
// POST /api/admin/invoices
// =====================
router.post("/", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const body = req.body || {};
    body.invoiceNo = body.invoiceNo || (await genInvoiceNo());

    // shipTo 默认同步 soldTo
    if (body.shipToSameAsSoldTo !== false) {
      body.shipToSameAsSoldTo = true;
      body.shipTo = { ...(body.soldTo || {}) };
    }

    // 先算钱
    const calc = computeTotals(body.items || []);
    body.items = calc.items;
    body.subtotal = calc.subtotal;
    body.total = calc.total;

    // ✅ 用 DB 校正 unitCount / description / productCode
    body.items = await normalizeItemsByDB(body.items, session);

    const created = await Invoice.create([{ ...body }], { session });

    // ✅ 扣库存
    await applyStockDeduction(created[0].items, session);

    await session.commitTransaction();
    res.json({ success: true, invoice: created[0] });
  } catch (e) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: e.message || "create failed" });
  } finally {
    session.endSession();
  }
});

// =====================
// PUT /api/admin/invoices/:id
// 回滚旧库存 -> DB 校正 -> 重新扣库存
// =====================
router.put("/:id", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const oldInv = await Invoice.findById(req.params.id).session(session);
    if (!oldInv) return res.status(404).json({ success: false, message: "not found" });

    // 1) 回滚旧扣库存
    await revertStock(oldInv, session);

    const body = req.body || {};

    if (body.shipToSameAsSoldTo !== false) {
      body.shipToSameAsSoldTo = true;
      body.shipTo = { ...(body.soldTo || {}) };
    }

    const calc = computeTotals(body.items || []);
    body.items = calc.items;
    body.subtotal = calc.subtotal;
    body.total = calc.total;

    // 2) DB 校正 unitCount
    body.items = await normalizeItemsByDB(body.items, session);

    // 3) 更新 invoice
    const updated = await Invoice.findByIdAndUpdate(req.params.id, body, {
      new: true,
      session,
    });

    // 4) 重新扣库存
    await applyStockDeduction(updated.items, session);

    await session.commitTransaction();
    res.json({ success: true, invoice: updated });
  } catch (e) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: e.message || "update failed" });
  } finally {
    session.endSession();
  }
});

// 列表/详情
router.get("/", async (req, res) => {
  const list = await Invoice.find({}).sort({ createdAt: -1 }).limit(300);
  res.json({ success: true, invoices: list });
});
router.get("/:id", async (req, res) => {
  const inv = await Invoice.findById(req.params.id);
  if (!inv) return res.status(404).json({ success: false, message: "not found" });
  res.json({ success: true, invoice: inv });
});

// =====================
// PDF：按你指定版式（不显示 unitCount/variantKey）
// GET /api/admin/invoices/:id/pdf
// =====================
router.get("/:id/pdf", async (req, res) => {
  const inv = await Invoice.findById(req.params.id);
  if (!inv) return res.status(404).end();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${inv.invoiceNo}.pdf"`);

  const doc = new PDFDocument({ margin: 36 });
  doc.pipe(res);

  // ✅ logo：放这里
  // frontend/admin/assets/images/invoice_logo.png
  const logoPath = path.resolve(__dirname, "../../frontend/admin/assets/images/invoice_logo.png");
  try {
    doc.image(logoPath, 36, 26, { width: 58 });
  } catch {}

  // 抬头居中（中文大字 + 英文 + 地址电话）
  doc.fontSize(22).text("在鲜购", 0, 22, { align: "center" });
  doc.fontSize(12).text("margarita market inc", { align: "center" });
  doc.fontSize(10).text("19926 48th ave freshmeadows ny11365", { align: "center" });
  doc.fontSize(10).text("tel 9297070098", { align: "center" });

  doc.moveDown(1.2);

  // Sold To / Ship To 两列
  const leftX = 36;
  const rightX = 320;
  const topY = doc.y;

  doc.fontSize(10).text("SOLD TO:", leftX, topY);
  doc.text(inv.soldTo?.name || "", leftX, topY + 14);
  doc.text(inv.soldTo?.phone || "", leftX, topY + 28);
  doc.text(inv.soldTo?.address || "", leftX, topY + 42, { width: 260 });

  doc.text("SHIP TO:", rightX, topY);
  doc.text(inv.shipTo?.name || "", rightX, topY + 14);
  doc.text(inv.shipTo?.phone || "", rightX, topY + 28);
  doc.text(inv.shipTo?.address || "", rightX, topY + 42, { width: 240 });

  doc.y = topY + 82;

  // account / sales rep / terms / date / invoice#
  const infoY = doc.y;
  const d = new Date(inv.date || inv.createdAt || Date.now());

  doc.fontSize(10).text(`ACCOUNT #: ${inv.accountNo || ""}`, leftX, infoY);
  doc.text(`SALES REP: ${inv.salesRep || ""}`, leftX + 180, infoY);
  doc.text(`TERMS: ${inv.terms || ""}`, leftX + 360, infoY);

  doc.text(`INVOICE #: ${inv.invoiceNo}`, leftX, infoY + 14);
  doc.text(`DATE: ${d.toLocaleDateString()}`, leftX + 360, infoY + 14);

  doc.moveDown(2);

  // 表头
  const y0 = doc.y;
  doc.fontSize(10).text("QTY", 36, y0, { width: 40 });
  doc.text("PRDT CODE", 76, y0, { width: 90 });
  doc.text("DESCRIPTION", 166, y0, { width: 220 });
  doc.text("U.PRICE", 386, y0, { width: 80, align: "right" });
  doc.text("TOTAL", 466, y0, { width: 100, align: "right" });

  doc.moveDown(0.5);
  doc.moveTo(36, doc.y).lineTo(566, doc.y).stroke();
  doc.moveDown(0.4);

  // 明细（✅ 不打印 unitCount/variantKey）
  for (const it of inv.items || []) {
    const yy = doc.y;
    doc.text(String(it.qty ?? 0), 36, yy, { width: 40 });
    doc.text(it.productCode || "", 76, yy, { width: 90 });
    doc.text(it.description || "", 166, yy, { width: 220 });
    doc.text(`$${Number(it.unitPrice || 0).toFixed(2)}`, 386, yy, { width: 80, align: "right" });
    doc.text(`$${Number(it.lineTotal || 0).toFixed(2)}`, 466, yy, { width: 100, align: "right" });
    doc.moveDown(0.9);
  }

  doc.moveDown(1);
  doc.fontSize(14).text(`TOTAL: $${Number(inv.total || 0).toFixed(2)}`, 0, doc.y, { align: "right" });

  doc.end();
});
// GET /api/admin/statements?from=2026-02-01&to=2026-02-29&userId=xxx(可选)
router.get("/statements", async (req, res) => {
  const { from, to, userId } = req.query;

  const q = {};
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = new Date(String(from) + "T00:00:00.000Z");
    if (to) q.date.$lte = new Date(String(to) + "T23:59:59.999Z");
  }
  if (userId) q["soldTo.userId"] = String(userId);

  const list = await Invoice.find(q).sort({ date: 1 });

  const total = list.reduce((s, inv) => s + Number(inv.total || 0), 0);

  res.json({
    success: true,
    from: from || null,
    to: to || null,
    userId: userId || null,
    count: list.length,
    total: Math.round(total * 100) / 100,
    invoices: list,
  });
});

export default router;
