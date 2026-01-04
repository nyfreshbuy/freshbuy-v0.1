console.log("DailySpecial.js loaded");

let FILTERS = [{ key: "all", name: "全部" }];
let ALL = [];
let dailyAll = [];
let activeCat = "all";

/* ========= 通用工具 ========= */
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
function getSectionKey(p) {
  return String(
    p?.sectionKey ||
    p?.section_key ||
    p?.homeSection ||
    p?.homeSectionKey ||
    p?.blockKey ||
    p?.block ||
    p?.section ||
    p?.groupKey ||
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

  const preferred = [
    "fresh",
    "meat",
    "snacks",
    "staples",
    "seasoning",
    "frozen",
    "household",
  ];

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

/* ========= 家庭必备判定 ========= */
function isDailySpecial(p) {
  const tag = String(p?.tag || "");
  // 家庭必备：先排除“爆品日”，剩下的都算家庭必备（不改后端的最佳兜底）
  return !tag.includes("爆品日") && !tag.includes("爆品");
}
function matchCat(p, catKey) {
  if (catKey === "all") return true;
  return getCategoryKey(p) === catKey;
}

/* ========= 排序 ========= */
function getNum(p, keys, def = 0) {
  for (const k of keys) {
    const n = Number(p?.[k]);
    if (!Number.isNaN(n) && n !== 0) return n;
  }
  return def;
}

function getPrice(p) {
  return getNum(p, ["price", "specialPrice", "originPrice"], 0);
}

function getSales(p) {
  return getNum(p, ["sales", "sold", "orderCount"], 0);
}

function sortList(list, sortKey) {
  const arr = [...list];
  if (sortKey === "price_asc") arr.sort((a, b) => getPrice(a) - getPrice(b));
  else if (sortKey === "price_desc") arr.sort((a, b) => getPrice(b) - getPrice(a));
  else arr.sort((a, b) => getSales(b) - getSales(a));
  return arr;
}

/* ========= 渲染 ========= */
function renderFilters() {
  const bar = document.getElementById("filterBar");
  bar.innerHTML = "";

  FILTERS.forEach((f) => {
    const btn = document.createElement("button");
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
  const grid = document.getElementById("dailySpecialGrid");
  const sortSel = document.getElementById("sortSelect");
  grid.innerHTML = "";

  let list = dailyAll.filter((p) => matchCat(p, activeCat));
  list = sortList(list, sortSel?.value || "sales_desc");

  if (!list.length) {
    grid.innerHTML = `<div style="color:#6b7280;">暂无家庭必备商品</div>`;
    return;
  }

  list.forEach((p) => grid.appendChild(createProductCard(p, "家庭必备")));
}

/* ========= 初始化 ========= */
async function loadProducts() {
  const res = await fetch("/api/products-simple", { cache: "no-store" });
  const data = await res.json();
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
 console.log("sample product:", ALL[0]);
console.log("sectionKey samples:", ALL.slice(0,10).map(p=>getSectionKey(p)));
console.log("categoryKey samples:", ALL.slice(0,10).map(p=>getCategoryKey(p)));
  dailyAll = ALL.filter(isDailySpecial);
  FILTERS = buildFiltersFromProducts(dailyAll);

  renderFilters();
  renderList();
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sortSelect")?.addEventListener("change", renderList);
  loadProducts();
});
