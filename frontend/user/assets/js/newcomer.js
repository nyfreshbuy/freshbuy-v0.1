console.log("newcomer.js loaded");

// ====== 你要的固定分类 ======
const FIXED_CATS = [
  { key: "all", name: "全部" },
  { key: "fresh", name: "生鲜果蔬" },
  { key: "meat", name: "肉禽海鲜" },
  { key: "snacks", name: "零食饮品" },
  { key: "staples", name: "粮油主食" },
  { key: "seasoning", name: "调味酱料" },
  { key: "frozen", name: "冷冻食品" },
  { key: "household", name: "日用清洁" },
];

// ===== 工具：兼容字段 =====
function isTrueFlag(v) { return v === true || v === "true" || v === 1 || v === "1"; }
function norm(v){ return (v ? String(v).trim().toLowerCase() : ""); }

function hasKeyword(p, keyword) {
  const kw = norm(keyword);
  const fields = [
    p?.tag, p?.type, p?.category, p?.subCategory, p?.mainCategory, p?.subcategory, p?.section,
  ].map(norm).join(" ");
  const arr1 = Array.isArray(p?.tags) ? p.tags.map(norm).join(" ") : "";
  const arr2 = Array.isArray(p?.labels) ? p.labels.map(norm).join(" ") : "";
  return (fields + " " + arr1 + " " + arr2).includes(kw);
}

// 新客逻辑：爆品 / 新客 / isHot 等
function isNewcomerProduct(p) {
  return (
    isTrueFlag(p.isHot) ||
    isTrueFlag(p.isHotDeal) ||
    isTrueFlag(p.isSpecial) ||
    hasKeyword(p, "爆品") ||
    hasKeyword(p, "爆品日") ||
    hasKeyword(p, "新客") ||
    hasKeyword(p, "newcomer") ||
    hasKeyword(p, "hot")
  );
}

// 取价格
function getPrice(p) {
  const priceNum = Number(p.price ?? p.flashPrice ?? p.specialPrice ?? 0);
  const originNum = Number(p.originPrice ?? p.price ?? 0);
  const finalPrice = priceNum || originNum || 0;
  return Number.isFinite(finalPrice) ? finalPrice : 0;
}

// 取销量（兼容多字段；没有就 0）
function getSales(p) {
  const v = p.soldCount ?? p.sold ?? p.sales ?? p.salesCount ?? p.orderCount ?? p.buyCount ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 分类匹配：尽量容错（你后端字段不统一也能匹配）
function matchCat(p, catKey) {
  if (!catKey || catKey === "all") return true;

  const text = [
    p?.mainCategory, p?.category, p?.subCategory, p?.subcategory, p?.type, p?.tag, p?.section,
    Array.isArray(p?.tags) ? p.tags.join(" ") : "",
    Array.isArray(p?.labels) ? p.labels.join(" ") : "",
  ].filter(Boolean).join(" ").toLowerCase();

  const map = {
    fresh: ["生鲜", "果蔬", "蔬菜", "水果", "fresh", "produce"],
    meat: ["肉", "禽", "海鲜", "鱼", "虾", "meat", "seafood"],
    snacks: ["零食", "饮品", "饮料", "snack", "drink", "beverage"],
    staples: ["粮油", "主食", "米", "面", "油", "staples", "rice", "noodle"],
    seasoning: ["调味", "酱料", "酱", "salt", "sauce", "seasoning"],
    frozen: ["冷冻", "冻", "frozen"],
    household: ["日用", "清洁", "纸", "洗衣", "清洁剂", "household", "clean"],
  };

  return (map[catKey] || []).some((kw) => text.includes(kw));
}

// ===== 卡片（复用你首页同样的 class 名）=====
function createProductCard(p, badgeText = "新客价") {
  const article = document.createElement("article");
  article.className = "product-card";

  const pid = String(p._id || p.id || p.sku || "").trim();
  const finalPrice = getPrice(p);
  const originNum = Number(p.originPrice ?? p.price ?? 0);
  const hasOrigin = originNum > 0 && originNum > finalPrice;

  const imageUrl =
    p.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(pid || p.name || "fb")}/500/400`;

  const tagline = (p.tag || p.category || "").slice(0, 18);
  const limitQty = p.limitQty || p.limitPerUser || p.maxQty || p.purchaseLimit || 0;

  article.innerHTML = `
    <div class="product-image-wrap">
      ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
      <img src="${imageUrl}" class="product-image" alt="${p.name || ""}" />
      <div class="product-overlay">
        <div class="overlay-btn-row">
          <button type="button" class="overlay-btn fav">⭐ 收藏</button>
          <button type="button" class="overlay-btn add" data-add-pid="${pid}">
            加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}
          </button>
        </div>
      </div>
    </div>

    <div class="product-name">${p.name || ""}</div>
    <div class="product-desc">${p.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${finalPrice.toFixed(2)}</span>
      ${hasOrigin ? `<span class="product-origin">$${Number(originNum).toFixed(2)}</span>` : ""}
    </div>

    <div class="product-tagline">${tagline}</div>

    <button type="button" class="product-add-fixed" data-add-pid="${pid}">
      加入购物车
    </button>
  `;

  article.addEventListener("click", () => {
    if (!pid) return;
    window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(pid);
  });

  function doAdd(ev) {
    ev.stopPropagation();
    const cartApi =
      (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
      (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
      null;

    if (!cartApi) return alert("购物车模块暂未启用（请确认 cart.js 已加载）");

    cartApi.addItem(
      {
        id: pid,
        name: p.name || "商品",
        price: finalPrice,
        priceNum: finalPrice,
        image: p.image || imageUrl,
        tag: p.tag || "",
        type: p.type || "",
        isSpecial: true,
        isDeal: true,
      },
      1
    );
  }

  const overlayAdd = article.querySelector(".overlay-btn.add");
  const fixedAdd = article.querySelector(".product-add-fixed");
  if (overlayAdd) overlayAdd.addEventListener("click", doAdd);
  if (fixedAdd) fixedAdd.addEventListener("click", doAdd);

  const favBtn = article.querySelector(".overlay-btn.fav");
  if (favBtn) favBtn.addEventListener("click", (ev) => { ev.stopPropagation(); alert("收藏功能后续接入"); });

  return article;
}

// ===== 数据 & 状态 =====
let newcomerAll = [];      // 所有新客商品
let currentCat = "all";
let currentSort = "sales_desc";

function $(id){ return document.getElementById(id); }

async function fetchProducts() {
  const res = await fetch("/api/products-simple", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : (data.items || data.products || data.list || []);
}

function renderPills() {
  const wrap = $("newcomerFilterPills");
  if (!wrap) return;
  wrap.innerHTML = "";

  FIXED_CATS.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-pill" + (c.key === currentCat ? " active" : "");
    btn.textContent = c.name;
    btn.dataset.key = c.key;

    btn.addEventListener("click", () => {
      currentCat = c.key;
      // 更新 active
      wrap.querySelectorAll(".filter-pill").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      applyAndRender();
    });

    wrap.appendChild(btn);
  });
}

function applySort(list) {
  const arr = list.slice();
  if (currentSort === "price_asc") arr.sort((a,b) => getPrice(a) - getPrice(b));
  else if (currentSort === "price_desc") arr.sort((a,b) => getPrice(b) - getPrice(a));
  else arr.sort((a,b) => getSales(b) - getSales(a)); // 默认销量高->低
  return arr;
}

function applyAndRender() {
  const grid = $("productGridHot");
  if (!grid) return;

  const kw = norm($("globalSearchInput")?.value || "");

  let list = newcomerAll
    .filter((p) => matchCat(p, currentCat))
    .filter((p) => {
      if (!kw) return true;
      const text = [
        p?.name, p?.desc, p?.tag, p?.type, p?.category, p?.mainCategory
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(kw);
    });

  list = applySort(list);

  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div style="padding:12px;color:#6b7280;font-size:14px;">暂无符合条件的新客商品</div>`;
    $("resultCount") && ($("resultCount").textContent = "0");
    return;
  }

  list.forEach((p) => grid.appendChild(createProductCard(p, "新客价")));
  $("resultCount") && ($("resultCount").textContent = String(list.length));
}

function bindSort() {
  const sel = $("sortSelect");
  if (!sel) return;
  sel.addEventListener("change", () => {
    currentSort = sel.value;
    applyAndRender();
  });
}

function bindSearch() {
  const input = $("globalSearchInput");
  if (!input) return;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyAndRender();
    }
  });

  input.addEventListener("input", () => {
    // 清空时自动恢复
    if (!input.value.trim()) applyAndRender();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  renderPills();
  bindSort();
  bindSearch();

  try {
    const list = await fetchProducts();
    newcomerAll = list.filter(isNewcomerProduct);
    applyAndRender();
  } catch (e) {
    console.error(e);
    const grid = $("productGridHot");
    if (grid) grid.innerHTML = `<div style="padding:12px;color:#b91c1c;font-size:13px;">加载失败：请检查 /api/products-simple</div>`;
  }
});
