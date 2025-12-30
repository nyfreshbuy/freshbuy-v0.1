import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "../db.js";
import Product from "../models/product.js";
import { products } from "../data/products.js";

function asNum(v, d = null) {
  if (v === undefined || v === null || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function asBool(v, d = false) {
  if (v === undefined || v === null) return d;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return !!v;
}

function normalizeOne(p) {
  const id = String(p.id || p.sku || p.internalCompanyId || ("p_" + Date.now() + "_" + Math.random()))
    .trim();

  const originPrice = asNum(p.originPrice ?? p.price, 0);
  const specialEnabled = asBool(p.specialEnabled, false);
  const specialPrice = asNum(p.specialPrice, null);

  let price = asNum(p.price, originPrice);
  if (specialEnabled && specialPrice && specialPrice > 0) price = specialPrice;

  return {
    id,
    sku: p.sku ? String(p.sku) : undefined,
    internalCompanyId: p.internalCompanyId ? String(p.internalCompanyId) : undefined,
    supplierCompanyId: p.supplierCompanyId ? String(p.supplierCompanyId) : undefined,

    name: String(p.name || "").trim(),
    desc: p.desc || "",

    category: p.category || "",
    subCategory: p.subCategory || "",

    tag: p.tag || "",
    type: p.type || "normal",
    labels: Array.isArray(p.labels) ? p.labels : (p.labels ? [String(p.labels)] : []),

    isFlashDeal: asBool(p.isFlashDeal, false),
    sortOrder: asNum(p.sortOrder, 99999),

    originPrice: asNum(originPrice, 0),
    price: asNum(price, asNum(originPrice, 0)),

    cost: asNum(p.cost, 0),
    stock: asNum(p.stock, 9999),
    soldCount: asNum(p.soldCount, 0),

    isActive: p.isActive === undefined ? true : asBool(p.isActive, true),
    status: p.status || (asBool(p.isActive, true) ? "on" : "off"),

    image: p.image || "",
    images: Array.isArray(p.images) ? p.images : (p.images ? [String(p.images)] : []),

    specialEnabled,
    specialPrice,
    specialFrom: p.specialFrom || null,
    specialTo: p.specialTo || null,
    autoCancelSpecialOnLowStock: asBool(p.autoCancelSpecialOnLowStock, false),
    autoCancelSpecialThreshold: asNum(p.autoCancelSpecialThreshold, 0),

    isFamilyMustHave: asBool(p.isFamilyMustHave, false),
    isBestSeller: asBool(p.isBestSeller, false),
    isNewArrival: asBool(p.isNewArrival, false),

    isSpecial: asBool(p.isSpecial, false),
    activeFrom: p.activeFrom || null,
    activeTo: p.activeTo || null,
  };
}

async function main() {
  await connectDB();

  const list = Array.isArray(products) ? products : [];
  let created = 0, updated = 0, skipped = 0;

  for (const raw of list) {
    const doc = normalizeOne(raw);

    if (!doc.name) { skipped++; continue; }

    const exists = await Product.findOne({ id: doc.id });
    if (!exists) {
      await Product.create(doc);
      created++;
    } else {
      await Product.updateOne({ _id: exists._id }, { $set: doc });
      updated++;
    }
  }

  console.log(`✅ Seed done. created=${created}, updated=${updated}, skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ seed failed:", e);
  process.exit(1);
});
