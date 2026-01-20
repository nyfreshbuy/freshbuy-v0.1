// frontend/user/assets/js/DailySpecial.js
console.log("DailySpecial page script loaded (renderer-driven)");

// =========================
// Auth helpers（跟 category.js 一样，保证接口需要 token 时也能用）
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
// DOM refs（有就用，没有也不报错）
// =========================
const gridEl = document.getElementById("dailyGrid");
const emptyTipEl = document.getElementById("emptyTip");

const sortSelectEl = document.getElementById("sortSelect");
const searchInputEl = document.getElementById("searchInput");
const globalSearchInput = document.getElementById("globalSearchInput");

let productsRaw = [];   // 原始商品（不拆卡）
let productsView = [];  // 拆卡后的视图（单卖/整箱两张）

// ============================
// Special deal 判定（按你项目字段做“尽量兼容”）
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

function isSpecialDeal(p) {
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
// 排序/搜索（跟 category.js 一致思想：最后 renderGrid）
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

function applyFilterAndRender() {
  if (!gridEl || !window.FBCard) return;

  let list = [...productsView];

  // 搜索
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

  // 排序
  const sortVal = sortSelectEl?.value || "default";
  if (sortVal === "priceAsc" || sortVal === "priceDesc") {
    list.sort((a, b) => {
      const pa = getPriceForSort(a);
      const pb = getPriceForSort(b);
      return sortVal === "priceAsc" ? pa - pb : pb - pa;
    });
  }

  if (!list.length) {
    gridEl.innerHTML = "";
    if (emptyTipEl) {
      emptyTipEl.style.display = "block";
      emptyTipEl.textContent = "当前没有特价商品。";
    }
    return;
  }

  if (emptyTipEl) emptyTipEl.style.display = "none";

  // ✅ 关键：统一用 FBCard 输出卡片
  window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
}

// ============================
// 加载特价商品（只拿数据，不自己拼卡）
// ============================
async function loadDailySpecialProducts() {
  if (!gridEl) return;

  gridEl.innerHTML = "";
  if (emptyTipEl) emptyTipEl.style.display = "none";

  // ✅ 必须有渲染器
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

    // 清理删除态
    const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

    // ✅ DailySpecial：只保留特价（Special Deals）
    productsRaw = cleaned.filter((p) => isSpecialDeal(p));

    // ✅ 拆卡：单卖/整箱两张卡（跟分类页一致）
    productsView = window.FBCard.expand(productsRaw);

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
// DOMContentLoaded 初始化（对齐 category.js）
// ============================
document.addEventListener("DOMContentLoaded", () => {
  // ✅ 统一商品卡：全局绑定（只做一次，会自动去重）
  if (window.FBCard && typeof window.FBCard.ensureGlobalBindings === "function") {
    window.FBCard.ensureGlobalBindings();
  }

  // ✅ 开启库存轮询（跟分类页一样）
  if (window.FBCard && typeof window.FBCard.startStockPolling === "function") {
    window.FBCard.startStockPolling();
  }

  loadDailySpecialProducts();

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

  // 购物车 UI（抽屉）—— 跟分类页同款
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
    console.warn("FreshCart.initCartUI 不存在，请确认已经引入 cart.js");
  }
});
