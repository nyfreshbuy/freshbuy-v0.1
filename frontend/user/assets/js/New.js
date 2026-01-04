console.log("New page loaded");

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

// ✅ 新品判断（跟你首页一致：isNew/isNewArrival 或关键词 + 可选过期时间）
function isNewProduct(p) {
  const flag =
    isTrueFlag(p.isNew) ||
    isTrueFlag(p.isNewArrival) ||
    hasKeyword(p, "新品") ||
    hasKeyword(p, "新上架") ||
    hasKeyword(p, "new");

  if (!flag) return false;

  const dateStr = p.newUntil || p.newExpireAt || p.newExpiresAt;
  if (!dateStr) return true;

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now();
}

// =========================
// 兜底卡片（如果页面没引入 createProductCard 也不白屏）
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
      <span class="special-badge">NEW</span>
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
// 加载新品
// =========================
let ALL = [];

async function loadNewProducts() {
  const grid = document.getElementById("newGrid");
  if (!grid) {
    console.warn("❌ 未找到 #newGrid，请检查 New.html 的容器 id");
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

    const newList = list.filter(isNewProduct);

    if (!newList.length) {
      grid.innerHTML =
        '<div style="padding:12px;color:#6b7280;font-size:14px;">暂无新品上市商品</div>';
      return;
    }

    const makeCard =
      typeof window.createProductCard === "function"
        ? (p) => window.createProductCard(p, "NEW")
        : (p) => fallbackCard(p);

    newList.forEach((p) => grid.appendChild(makeCard(p)));
  } catch (err) {
    console.error("加载新品失败：", err);
    grid.innerHTML =
      '<div style="padding:12px;color:#b00020;font-size:14px;">加载失败，请稍后重试</div>';
  }
}

// =========================
// 搜索（只在新品列表里搜）
// =========================
function bindSearch() {
  const input = document.getElementById("newSearchInput");
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
  const grid = document.getElementById("newGrid");
  if (!grid) return;

  const kw = String(keyword || "").trim().toLowerCase();

  const base = ALL.filter(isNewProduct);

  if (!kw) {
    grid.innerHTML = "";
    base.forEach((p) =>
      grid.appendChild(
        typeof window.createProductCard === "function"
          ? window.createProductCard(p, "NEW")
          : fallbackCard(p)
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
    grid.innerHTML = `<div style="padding:12px;color:#6b7280;font-size:14px;">没有找到「${keyword}」相关新品</div>`;
    return;
  }

  matched.forEach((p) =>
    grid.appendChild(
      typeof window.createProductCard === "function"
        ? window.createProductCard(p, "NEW")
        : fallbackCard(p)
    )
  );
}

window.addEventListener("DOMContentLoaded", () => {
  bindSearch();
  loadNewProducts();
});
