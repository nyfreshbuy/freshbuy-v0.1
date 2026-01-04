// frontend/user/assets/js/DailySpecial.js
console.log("DailySpecial page loaded");

// =========================
// 工具：兼容后端各种字段
// =========================
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function hasKeyword(p, keyword) {
  if (!p) return false;
  const kw = String(keyword).toLowerCase();
  const norm = (v) => (v ? String(v).toLowerCase() : "");

  const fields = [
    p.tag,
    p.type,
    p.category,
    p.subCategory,
    p.mainCategory,
    p.subcategory,
    p.section,
  ];
  if (fields.some((f) => norm(f).includes(kw))) return true;

  if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
  if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;

  return false;
}

function isFamilyProduct(p) {
  return (
    isTrueFlag(p.isFamily) ||
    isTrueFlag(p.isFamilyEssential) ||
    hasKeyword(p, "家庭") ||
    hasKeyword(p, "家庭必备") ||
    hasKeyword(p, "家庭包") ||
    hasKeyword(p, "家用") ||
    hasKeyword(p, "family")
  );
}

// =========================
// 兜底：如果页面没有 createProductCard，就用简单卡片避免白屏
// =========================
function fallbackCard(p) {
  const el = document.createElement("article");
  el.className = "product-card";

  const pid = String(p._id || p.id || p.sku || "").trim();
  const priceNum = Number(p.price ?? p.flashPrice ?? p.specialPrice ?? 0);
  const originNum = Number(p.originPrice ?? p.price ?? 0);
  const finalPrice = priceNum || originNum || 0;

  const imageUrl =
    p.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(pid || p.name || "fb")}/500/400`;

  el.innerHTML = `
    <div class="product-image-wrap">
      <span class="special-badge">家庭必备</span>
      <img src="${imageUrl}" class="product-image" alt="${p.name || ""}" />
    </div>
    <div class="product-name">${p.name || ""}</div>
    <div class="product-desc">${p.desc || ""}</div>
    <div class="product-price-row">
      <span class="product-price">$${finalPrice.toFixed(2)}</span>
    </div>
    <div class="product-tagline">${(p.tag || p.category || "").slice(0, 18)}</div>
  `;

  el.addEventListener("click", () => {
    if (!pid) return;
    window.location.href = "product_detail.html?id=" + encodeURIComponent(pid);
  });

  return el;
}

// =========================
// 核心：加载家庭必备（DailySpecial）
// =========================
async function loadDailySpecialProducts() {
  const grid = document.getElementById("dailySpecialGrid");
  if (!grid) {
    console.warn("❌ 未找到 #dailySpecialGrid，请检查 DailySpecial.html 的容器 id");
    return;
  }

  grid.innerHTML = "";

  try {
    const res = await fetch("/api/products-simple", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    const list = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.products)
      ? data.products
      : Array.isArray(data.list)
      ? data.list
      : [];

    if (!list.length) {
      grid.innerHTML =
        '<div style="padding:12px;color:#6b7280;font-size:14px;">暂无商品</div>';
      return;
    }

    const familyList = list.filter(isFamilyProduct);

    if (!familyList.length) {
      grid.innerHTML =
        '<div style="padding:12px;color:#6b7280;font-size:14px;">暂无家庭必备商品</div>';
      return;
    }

    const makeCard =
      typeof window.createProductCard === "function"
        ? (p) => window.createProductCard(p, "家庭必备")
        : (p) => fallbackCard(p);

    familyList.forEach((p) => grid.appendChild(makeCard(p)));
  } catch (err) {
    console.error("加载 DailySpecial 失败：", err);
    grid.innerHTML =
      '<div style="padding:12px;color:#b00020;font-size:14px;">加载失败，请稍后重试</div>';
  }
}

window.addEventListener("DOMContentLoaded", loadDailySpecialProducts);
