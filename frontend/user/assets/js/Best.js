console.log("Best page loaded");

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

// ✅ 畅销判断（跟你首页一致）
function isBestSellerProduct(p) {
  return (
    isTrueFlag(p.isBest) ||
    isTrueFlag(p.isBestSeller) ||
    hasKeyword(p, "畅销") ||
    hasKeyword(p, "热销") ||
    hasKeyword(p, "best") ||
    hasKeyword(p, "top")
  );
}

// =========================
// 兜底卡片（如果没引入 createProductCard 也不白屏）
// =========================
function fallbackCard(p, badgeText = "") {
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
      ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
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
// 加载畅销
// =========================
let ALL = [];

async function loadBestProducts() {
  const grid = document.getElementById("bestGrid");
  if (!grid) {
    console.warn("❌ 未找到 #bestGrid，请检查 Best.html 的容器 id");
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

    ALL = list;

    let bestList = list.filter(isBestSellerProduct);
    if (bestList.length > 200) bestList = bestList.slice(0, 200);

    if (!bestList.length) {
      grid.innerHTML =
        '<div style="padding:12px;color:#6b7280;font-size:14px;">暂无畅销商品</div>';
      return;
    }

    const makeCard =
      typeof window.createProductCard === "function"
        ? (p, idx) => window.createProductCard(p, idx < 3 ? `TOP${idx + 1}` : "畅销")
        : (p, idx) => fallbackCard(p, idx < 3 ? `TOP${idx + 1}` : "畅销");

    bestList.forEach((p, idx) => grid.appendChild(makeCard(p, idx)));
  } catch (err) {
    console.error("加载畅销失败：", err);
    grid.innerHTML =
      '<div style="padding:12px;color:#b00020;font-size:14px;">加载失败，请稍后重试</div>';
  }
}

// =========================
// 搜索（只在畅销列表里搜）
// =========================
function bindSearch() {
  const input = document.getElementById("bestSearchInput");
  if (!input) return;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(input.value);
    }
  });

  input.addEventListener("input", () => {
    if (!input.value.trim()) doSearch("");
  });
}

function doSearch(keyword) {
  const grid = document.getElementById("bestGrid");
  if (!grid) return;

  const kw = String(keyword || "").trim().toLowerCase();

  const base = ALL.filter(isBestSellerProduct);

  if (!kw) {
    grid.innerHTML = "";
    base.forEach((p, idx) =>
      grid.appendChild(
        typeof window.createProductCard === "function"
          ? window.createProductCard(p, idx < 3 ? `TOP${idx + 1}` : "畅销")
          : fallbackCard(p, idx < 3 ? `TOP${idx + 1}` : "畅销")
      )
    );
    return;
  }

  const hit = (p) => {
    const fields = [
      p?.name,
      p?.desc,
      p?.tag,
      p?.type,
      p?.category,
      p?.subCategory,
      p?.mainCategory,
      p?.subcategory,
      p?.section,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const arr1 = Array.isArray(p?.tags) ? p.tags.join(" ").toLowerCase() : "";
    const arr2 = Array.isArray(p?.labels) ? p.labels.join(" ").toLowerCase() : "";

    return (fields + " " + arr1 + " " + arr2).includes(kw);
  };

  const matched = base.filter(hit);

  grid.innerHTML = "";
  if (!matched.length) {
    grid.innerHTML = `<div style="padding:12px;color:#6b7280;font-size:14px;">没有找到「${keyword}」相关畅销商品</div>`;
    return;
  }

  matched.forEach((p, idx) =>
    grid.appendChild(
      typeof window.createProductCard === "function"
        ? window.createProductCard(p, idx < 3 ? `TOP${idx + 1}` : "畅销")
        : fallbackCard(p, idx < 3 ? `TOP${idx + 1}` : "畅销")
    )
  );
}

window.addEventListener("DOMContentLoaded", () => {
  bindSearch();
  loadBestProducts();
});
