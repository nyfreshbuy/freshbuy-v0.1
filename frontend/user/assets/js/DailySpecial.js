// frontend/user/assets/js/DailySpecial.js
console.log("✅ DailySpecial.js loaded (renderer-driven + sticky category pills)");

// =========================
// Auth helpers（跟 category.js 一致）
// =========================
const AUTH_TOKEN_KEY = "freshbuy_token";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}
function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function apiFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  headers["Content-Type"] = headers["Content-Type"] || "application/json";

  const tk = getToken();
  if (tk) headers.Authorization = "Bearer " + tk;

  const res = await fetch(url, { ...options, headers });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401) clearToken();
  return { res, data };
}

// =========================
// DOM refs
// =========================
const gridEl = document.getElementById("dailyGrid");
const emptyTipEl = document.getElementById("emptyTip");

const filterBarEl = document.getElementById("filterBar"); // ✅ 顶部 pills 容器（你 HTML 已有）
const sortSelectEl = document.getElementById("sortSelect");
const searchInputEl = document.getElementById("searchInput");
const globalSearchInput = document.getElementById("globalSearchInput");

// =========================
// State
// =========================
let productsRaw = [];      // 原始商品（不拆卡）
let productsViewAll = [];  // 拆卡后的全量视图（单卖/整箱两张）
let currentFilter = "all"; // pills 选中值

// ============================
// 特价判定（DailySpecial=所有特价）
// ============================
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function hasKeywordSimple(p, keyword) {
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

function isDailySpecialProduct(p) {
  return (
    isTrueFlag(p?.hasSpecial) ||
    isTrueFlag(p?.isSpecial) ||
    isTrueFlag(p?.isSpecialDeal) ||
    isTrueFlag(p?.specialDeal) ||
    Number(p?.specialPrice || 0) > 0 ||
    Number(p?.specialQty || 0) > 0 ||
    Number(p?.specialTotalPrice || 0) > 0 ||
    hasKeywordSimple(p, "special") ||
    hasKeywordSimple(p, "deal") ||
    hasKeywordSimple(p, "特价") ||
    hasKeywordSimple(p, "家庭必备") ||
    hasKeywordSimple(p, "daily")
  );
}

// ============================
// 分类 pills（优先 subCategory；没有就用 category）
// ============================
function rebuildCategoryPills() {
  if (!filterBarEl) return;

  const set = new Set();
  productsRaw.forEach((p) => {
    const sub = String(p.subCategory || "").trim();
    const cat = String(p.category || "").trim();
    if (sub) set.add(sub);
    else if (cat) set.add(cat);
  });

  const cats = Array.from(set);
  filterBarEl.innerHTML = "";

  const makeBtn = (label, val, active) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (active ? " active" : "");
    btn.textContent = label;
    btn.dataset.filter = val;
    btn.addEventListener("click", () => {
      filterBarEl.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = val;
      applyFilterAndRender();
    });
    return btn;
  };

  filterBarEl.appendChild(makeBtn("全部", "all", currentFilter === "all"));
  cats.forEach((c) => filterBarEl.appendChild(makeBtn(c, c, currentFilter === c)));
}

// ============================
// 排序 / 搜索 / 分类过滤
// ============================
function getNum(p, keys, def = 0) {
  for (const k of keys) {
    const v = p?.[k];
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
  }
  return def;
}

function getPriceForSort(p) {
  // ✅ 拆卡视图：整箱卡优先 __displayPrice
  const vPrice = p?.__displayPrice;
  if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
  return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
}

// 兼容你 HTML 里 sortSelect 的值：
// - sales_desc（默认）
// - price_asc / price_desc
function getSalesForSort(p) {
  return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount"], 0);
}

function applyFilterAndRender() {
  if (!gridEl || !window.FBCard) return;

  let list = [...productsViewAll];

  // 搜索（支持局部/全局）
  const kw =
    (searchInputEl && searchInputEl.value.trim()) ||
    (globalSearchInput && globalSearchInput.value.trim()) ||
    "";

  if (kw) {
    const lower = kw.toLowerCase();
    list = list.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(lower) ||
        (p.__displayName || "").toLowerCase().includes(lower) ||
        (p.desc || "").toLowerCase().includes(lower)
    );
  }

  // ✅ 分类过滤（pills）
  if (currentFilter && currentFilter !== "all") {
    list = list.filter((p) => {
      const cat = String(p.category || "").trim();
      const sub = String(p.subCategory || "").trim();
      return cat === currentFilter || sub === currentFilter;
    });
  }

  // 排序
  const sortVal = sortSelectEl?.value || "sales_desc";
  if (sortVal === "price_asc" || sortVal === "price_desc") {
    list.sort((a, b) => {
      const pa = getPriceForSort(a);
      const pb = getPriceForSort(b);
      return sortVal === "price_asc" ? pa - pb : pb - pa;
    });
  } else if (sortVal === "sales_desc") {
    list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
  }

  // 渲染
  if (!list.length) {
    gridEl.innerHTML = "";
    if (emptyTipEl) {
      emptyTipEl.style.display = "block";
      emptyTipEl.textContent = "当前筛选条件下没有商品。";
    }
    return;
  }

  if (emptyTipEl) emptyTipEl.style.display = "none";
  window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
}

// ============================
// 加载商品（只拿数据 -> 特价过滤 -> expand -> pills -> render）
// ============================
async function loadDailySpecialProducts() {
  if (!gridEl) return;

  gridEl.innerHTML = "";
  if (emptyTipEl) emptyTipEl.style.display = "none";

  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：请检查是否引入 product_card_renderer.js");
    if (emptyTipEl) {
      emptyTipEl.style.display = "block";
      emptyTipEl.textContent = "页面缺少商品卡渲染器（product_card_renderer.js）。";
    }
    return;
  }

  try {
    const { res, data } = await apiFetch(`/api/products-simple?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) throw new Error(data?.message || data?.msg || "加载失败");

    const list = window.FBCard.extractList(data);
    const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

    // ✅ 只保留特价
    productsRaw = cleaned.filter((p) => isDailySpecialProduct(p));

    // ✅ 拆卡：单卖/整箱两张
    productsViewAll = window.FBCard.expand(productsRaw);

    // ✅ 分类 pills 重建
    currentFilter = "all";
    rebuildCategoryPills();

    // ✅ 渲染
    applyFilterAndRender();
  } catch (err) {
    console.error("加载 DailySpecial 商品失败:", err);
    if (emptyTipEl) {
      emptyTipEl.style.display = "block";
      emptyTipEl.textContent = "加载商品失败（请检查商品接口是否为 DB 版）。";
    }
  }
}

// ============================
// 初始化（绑定事件 + 购物车抽屉 + 库存轮询）
// ============================
document.addEventListener("DOMContentLoaded", () => {
  // 1) FBCard 全局绑定（加购/黑框+/-/徽章）
  if (window.FBCard && typeof window.FBCard.ensureGlobalBindings === "function") {
    window.FBCard.ensureGlobalBindings();
  } else {
    console.warn("❌ FBCard.ensureGlobalBindings 不存在：检查 product_card_renderer.js 是否引入/顺序是否正确");
  }

  // 2) 库存轮询（跟分类页一致）
  if (window.FBCard && typeof window.FBCard.startStockPolling === "function") {
    window.FBCard.startStockPolling();
  }

  // 3) 购物车抽屉 UI
  if (window.FreshCart && window.FreshCart.initCartUI) {
    window.FreshCart.initCartUI({
      cartIconId: "cartIcon",
      cartBackdropId: "cartBackdrop",
      cartDrawerId: "cartDrawer",
      cartCloseBtnId: "cartCloseBtn",
      cartCountId: "cartCount",
      cartTotalItemsId: "cartTotalItems",
      cartEmptyTextId: "cartEmptyText",
      cartItemsListId: "cartItemsList",
      toastId: "addCartToast",
      goCartBtnId: "goCartBtn",
      cartPageUrl: "/user/cart.html",
    });
  } else {
    console.warn("❌ FreshCart.initCartUI 不存在：请确认 cart.js 已引入且顺序正确");
  }

  // 4) 加载商品
  loadDailySpecialProducts();

  // 5) 控件监听
  if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

  if (searchInputEl) {
    searchInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyFilterAndRender();
    });
  }

  if (globalSearchInput) {
    globalSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyFilterAndRender();
    });
  }
});
