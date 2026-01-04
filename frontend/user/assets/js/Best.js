console.log("Best.js loaded");

let FILTERS = [{ key: "all", name: "全部" }];
let ALL = [];
let bestAll = [];
let activeCat = "all";

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

const CATEGORY_NAME_MAP = {
  fresh: "生鲜果蔬",
  meat: "肉禽海鲜",
  snacks: "零食饮品",
  staples: "粮油主食",
  seasoning: "调味酱料",
  frozen: "冷冻食品",
  household: "日用清洁",
};
function getCategoryLabel(key) {
  return CATEGORY_NAME_MAP[key] || key;
}

function buildFiltersFromProducts(list) {
  const set = new Set();
  list.forEach((p) => {
    const k = getCategoryKey(p);
    if (k) set.add(k);
  });

  const preferred = ["fresh","meat","snacks","staples","seasoning","frozen","household"];
  const keys = Array.from(set).sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return [{ key: "all", name: "全部" }].concat(
    keys.map((k) => ({ key: k, name: getCategoryLabel(k) }))
  );
}

function getNum(p, keys, def = 0) {
  for (const k of keys) {
    const n = Number(p?.[k]);
    if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
  }
  return def;
}
function getPrice(p) {
  return getNum(p, ["price", "specialPrice", "originPrice"], 0);
}
function getSales(p) {
  return getNum(p, ["sales", "sold", "salesCount", "orderCount"], 0);
}

function hasKeywordAny(p, keywords) {
  const norm = (v) => (v ? String(v).toLowerCase() : "");
  const parts = [
    p?.tag, p?.type, p?.name, p?.desc, p?.categoryKey, p?.category, p?.section,
  ].map(norm);

  if (Array.isArray(p?.tags)) parts.push(norm(p.tags.join(" ")));
  if (Array.isArray(p?.labels)) parts.push(norm(p.labels.join(" ")));

  const hay = parts.join(" ");
  return (keywords || []).some((k) => hay.includes(String(k).toLowerCase()));
}

/* ✅ 畅销判定（不改后端） */
function isBestProduct(p) {
  if (isTrueFlag(p?.isBest) || isTrueFlag(p?.isBestSeller) || isTrueFlag(p?.bestSeller)) return true;
  return hasKeywordAny(p, ["畅销", "热销", "top", "best", "bestseller"]);
}

function matchCat(p, catKey) {
  if (catKey === "all") return true;
  return getCategoryKey(p) === catKey;
}

function sortList(list, sortKey) {
  const arr = [...list];
  if (sortKey === "price_asc") arr.sort((a, b) => getPrice(a) - getPrice(b));
  else if (sortKey === "price_desc") arr.sort((a, b) => getPrice(b) - getPrice(a));
  else arr.sort((a, b) => getSales(b) - getSales(a)); // 默认销量高→低
  return arr;
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
    btn.onclick = () => {
      activeCat = f.key;
      bar.querySelectorAll(".filter-pill").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      renderList();
    };
    bar.appendChild(btn);
  });
}

function renderList() {
  const grid = document.getElementById("bestGrid");
  const sortSel = document.getElementById("sortSelect");
  if (!grid) return;

  const sortKey = sortSel?.value || "sales_desc";
  let list = bestAll.filter((p) => matchCat(p, activeCat));
  list = sortList(list, sortKey);

  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div style="color:#6b7280;">该分类暂无畅销商品</div>`;
    return;
  }

  // 用你首页同款卡片（createProductCard 在 index.js 里；这里直接复用全局函数）
  list.forEach((p, idx) => {
    const badge = idx < 3 ? `TOP${idx + 1}` : "畅销";
    grid.appendChild(createProductCard(p, badge));
  });
}

async function loadProducts() {
  const res = await fetch("/api/products-simple", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const list = Array.isArray(data) ? data : data.products || data.items || data.list || [];
  ALL = list;

  // ① 先按字段/标签筛畅销
  let pool = ALL.filter(isBestProduct);

  // ② 如果没有任何“畅销标记”，兜底：按销量排序取前 60 个当畅销池
  if (!pool.length) {
    pool = [...ALL].sort((a, b) => getSales(b) - getSales(a)).slice(0, 60);
  }

  bestAll = pool;

  FILTERS = buildFiltersFromProducts(bestAll);
  renderFilters();
  renderList();
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sortSelect")?.addEventListener("change", renderList);
  loadProducts().catch((e) => {
    console.error("Best page load failed", e);
    const grid = document.getElementById("bestGrid");
    if (grid) grid.innerHTML = `<div style="color:#b91c1c;">加载失败</div>`;
  });
});
