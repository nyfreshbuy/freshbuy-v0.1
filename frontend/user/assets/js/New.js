console.log("New.js loaded");

let FILTERS = [{ key: "all", name: "全部" }];
let ALL = [];
let newAll = [];
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

function daysBetween(a, b) {
  return Math.floor((a - b) / (24 * 3600 * 1000));
}

function parseDateMaybe(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ✅ 新品判定（不改后端） */
function isNewProduct(p) {
  const tag = String(p?.tag || "");
  if (isTrueFlag(p?.isNew) || isTrueFlag(p?.isNewArrival) || isTrueFlag(p?.isNewProduct)) return true;
  if (tag.includes("新品") || tag.toLowerCase().includes("new")) return true;

  // 有 newUntil/newExpireAt/newExpiresAt：还没过期算新品
  const until = parseDateMaybe(p?.newUntil || p?.newExpireAt || p?.newExpiresAt);
  if (until && until.getTime() >= Date.now()) return true;

  // 用 createdAt 判断 7 天内
  const created = parseDateMaybe(p?.createdAt || p?.created_at);
  if (created) {
    const diff = daysBetween(new Date(), created);
    if (diff >= 0 && diff <= 7) return true;
  }

  return false;
}

function matchCat(p, catKey) {
  if (catKey === "all") return true;
  return getCategoryKey(p) === catKey;
}

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
  const grid = document.getElementById("newGrid");
  const sortSel = document.getElementById("sortSelect");
  if (!grid) return;

  let list = newAll.filter((p) => matchCat(p, activeCat));
  list = sortList(list, sortSel?.value || "sales_desc");

  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div style="color:#6b7280;">暂无新品</div>`;
    return;
  }

  list.forEach((p) => grid.appendChild(createProductCard(p, "NEW")));
}

async function loadProducts() {
  const res = await fetch("/api/products-simple", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const list = Array.isArray(data) ? data : data.products || data.items || data.list || [];

  ALL = list;
  newAll = ALL.filter(isNewProduct);

  FILTERS = buildFiltersFromProducts(newAll);

  renderFilters();
  renderList();
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sortSelect")?.addEventListener("change", renderList);
  loadProducts().catch((e) => {
    console.error("New page load failed", e);
    const grid = document.getElementById("newGrid");
    if (grid) grid.innerHTML = `<div style="color:#b91c1c;">加载失败</div>`;
  });
});
