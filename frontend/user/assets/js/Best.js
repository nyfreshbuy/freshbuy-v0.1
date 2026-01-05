console.log("Best.js loaded");

let FILTERS = [{ key: "all", name: "全部" }];
let ALL = [];
let bestAll = [];
let activeCat = "all";

/* ========= 分类映射（可按你后台调整） ========= */
const CATEGORY_NAME_MAP = {
  fresh: "生鲜果蔬",
  meat: "肉禽海鲜",
  snacks: "零食饮品",
  staples: "粮油主食",
  seasoning: "调味酱料",
  frozen: "冷冻食品",
  household: "日用清洁",
};

function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function getCategoryKey(p) {
  return String(
    p?.categoryKey ||
      p?.category_key ||
      p?.catKey ||
      p?.category ||
      p?.mainCategory ||
      p?.section ||
      ""
  ).trim();
}

function getCategoryLabel(key) {
  return CATEGORY_NAME_MAP[key] || key || "未分类";
}

function buildFiltersFromProducts(list) {
  const set = new Set();
  list.forEach((p) => {
    const k = getCategoryKey(p);
    if (k) set.add(k);
  });

  const keys = Array.from(set);
  const preferred = ["fresh", "meat", "snacks", "staples", "seasoning", "frozen", "household"];
  keys.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return [{ key: "all", name: "全部" }].concat(
    keys.map((k) => ({ key: k, name: getCategoryLabel(k) }))
  );
}

/* ========= 关键词工具（沿用首页逻辑） ========= */
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
/* ========= 爆品识别（用于畅销页排除） ========= */
function isHotProduct(p) {
  return (
    isTrueFlag(p?.isHot) ||
    isTrueFlag(p?.isHotDeal) ||
    isTrueFlag(p?.hotDeal) ||
    hasKeyword(p, "爆品") ||
    hasKeyword(p, "爆品日") ||
    hasKeyword(p, "hot")
  );
}
/* ========= 畅销识别 ========= */
function isBestSellerProduct(p) {
  // ✅ 先看后台字段
  if (
    isTrueFlag(p?.isBest) ||
    isTrueFlag(p?.isBestSeller) ||
    isTrueFlag(p?.bestSeller) ||
    isTrueFlag(p?.isTop) ||
    isTrueFlag(p?.topSeller)
  ) return true;

  // ✅ 再看关键词（你首页的规则）
  return (
    hasKeyword(p, "畅销") ||
    hasKeyword(p, "热销") ||
    hasKeyword(p, "top") ||
    hasKeyword(p, "best") ||
    hasKeyword(p, "bestseller")
  );
}

/* ========= 可选兜底：按销量阈值自动算畅销（防止全为空） ========= */
function getNum(p, keys, def = 0) {
  for (const k of keys) {
    const v = p?.[k];
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
  }
  return def;
}
function getSales(p) {
  return getNum(p, ["sales", "sold", "saleCount", "salesCount", "orderCount"], 0);
}
function getPrice(p) {
  return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
}

function matchCat(p, catKey) {
  if (catKey === "all") return true;
  return getCategoryKey(p) === catKey;
}

function sortList(list, sortKey) {
  const arr = [...list];
  if (sortKey === "price_asc") arr.sort((a, b) => getPrice(a) - getPrice(b));
  else if (sortKey === "price_desc") arr.sort((a, b) => getPrice(b) - getPrice(a));
  else arr.sort((a, b) => getSales(b) - getSales(a));
  return arr;
}

function showToast() {
  const el = document.getElementById("addCartToast");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 900);
}

function createCard(p) {
  const article = document.createElement("article");
  article.className = "product-card";

  const pid = String(p?._id || p?.id || p?.sku || p?.code || p?.productId || "").trim();
  const safeId = pid || String(p?.name || "fb").trim();

  const price = getPrice(p);
  const origin = getNum(p, ["originPrice"], 0);
  const hasOrigin = origin > 0 && origin > price;

  const img =
    p?.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(safeId)}/500/400`;

  const badge = "畅销";
  const limitQty = p?.limitQty || p?.limitPerUser || p?.maxQty || p?.purchaseLimit || 0;

  article.innerHTML = `
    <div class="product-image-wrap">
      <span class="special-badge">${badge}</span>
      <img src="${img}" class="product-image" alt="${p?.name || ""}" />
    </div>

    <div class="product-name">${p?.name || ""}</div>
    <div class="product-desc">${p?.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${Number(price || 0).toFixed(2)}</span>
      ${hasOrigin ? `<span class="product-origin">$${Number(origin).toFixed(2)}</span>` : ""}
    </div>

    <button type="button" class="add-btn">
      <span class="add-btn__icon">🛒</span>
      <span class="add-btn__text">加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}</span>
    </button>
  `;

  const btn = article.querySelector(".add-btn");
  if (btn) {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();

      const cartApi =
        (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
        (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
        null;

      if (!cartApi) {
        alert("购物车模块未就绪（请确认 cart.js 已加载且 window.FreshCart 存在）");
        return;
      }

      cartApi.addItem(
        {
          id: pid || safeId,
          name: p?.name || "商品",
          price: Number(price || 0),
          priceNum: Number(price || 0),
          image: p?.image || img,
          tag: p?.tag || "",
          type: p?.type || "",
          isSpecial: false,
          isDeal: false,
          // 给结算规则留字段
          serviceMode: "groupDay",
        },
        1
      );

      showToast();
    });
  }

  article.addEventListener("click", () => {
    const id = pid || safeId;
    if (!id) return;
    window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(id);
  });

  return article;
}

function renderFilters() {
  const bar = document.getElementById("filterBar");
  if (!bar) return;
  bar.innerHTML = "";

  FILTERS.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-pill" + (f.key === activeCat ? " active" : "");
    btn.textContent = f.name;

    btn.addEventListener("click", () => {
      activeCat = f.key;
      bar.querySelectorAll(".filter-pill").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      renderList();
    });

    bar.appendChild(btn);
  });
}

function renderList() {
  const grid = document.getElementById("bestGrid");
  const sortSel = document.getElementById("sortSelect");
  if (!grid) return;

  const sortKey = sortSel ? sortSel.value : "sales_desc";

  let list = bestAll.filter((p) => matchCat(p, activeCat));
  list = sortList(list, sortKey);

  grid.innerHTML = "";

  if (!list.length) {
    grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">该分类暂无畅销商品</div>`;
    return;
  }

  list.forEach((p) => grid.appendChild(createCard(p)));
}

async function loadProducts() {
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

  bestAll = list.filter((p) => isBestSellerProduct(p) && !isHotProduct(p));

  // ✅ 兜底：如果没打标签/字段，就按“销量Top”凑一页（防止空）
  if (!bestAll.length && list.length) {
    console.warn("畅销为空，启用兜底：按销量 Top 取前 60");
   bestAll = [...list]
  .filter((p) => !isHotProduct(p))
  .sort((a, b) => getSales(b) - getSales(a))
  .slice(0, 60);
  }

  FILTERS = buildFiltersFromProducts(bestAll);
  if (!FILTERS.some((f) => f.key === activeCat)) activeCat = "all";

  renderFilters();
  renderList();

  console.log("[Best] ALL:", ALL.length, "bestAll:", bestAll.length);
}

function injectButtonStylesOnce() {
  if (document.getElementById("bestBtnStyle")) return;
  const style = document.createElement("style");
  style.id = "bestBtnStyle";
  style.textContent = `
    .add-btn{
      width:100%;
      margin-top:10px;
      padding:10px 12px;
      border:none;
      border-radius:14px;
      background: linear-gradient(135deg,#22c55e,#16a34a);
      color:#fff;
      font-weight:900;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      box-shadow: 0 10px 18px rgba(22,163,74,.18);
      transition: transform .08s ease, filter .12s ease;
    }
    .add-btn:active{ transform: scale(.98); }
    .add-btn:hover{ filter: brightness(.98); }
    .add-btn__icon{ font-size:14px; }
    .add-btn__text{ font-size:14px; letter-spacing:.02em; }
  `;
  document.head.appendChild(style);
}

window.addEventListener("DOMContentLoaded", () => {
  injectButtonStylesOnce();

  const sortSel = document.getElementById("sortSelect");
  if (sortSel) sortSel.addEventListener("change", renderList);

  loadProducts().catch((err) => {
    console.error("加载畅销商品失败", err);
    const grid = document.getElementById("bestGrid");
    if (grid) grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#b91c1c;">加载失败，请稍后重试</div>`;
  });
});
