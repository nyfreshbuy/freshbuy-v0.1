// frontend/user/assets/js/New.js
console.log("✅ New.js loaded (renderer-driven, DailySpecial layout cloned)");

// =========================
// Auth helpers（跟你其他页一致）
// =========================
const AUTH_TOKEN_KEY = "freshbuy_token";
function getToken() { return localStorage.getItem(AUTH_TOKEN_KEY) || ""; }
function clearToken() { localStorage.removeItem(AUTH_TOKEN_KEY); }

async function apiFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const tk = getToken();
  if (tk) headers.Authorization = "Bearer " + tk;

  const res = await fetch(url, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401) clearToken();
  return { res, data };
}

// =========================
// DOM refs
// =========================
const gridEl = document.getElementById("newGrid");
const filterBarEl = document.getElementById("filterBar");
const sortSelectEl = document.getElementById("sortSelect");

// =========================
// State
// =========================
let productsRaw = [];
let productsViewAll = [];
let currentFilter = "all";

// =========================
// 新品判定（多口径兜底）
// =========================
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function norm(v){ return v ? String(v).toLowerCase() : ""; }

function hasKeyword(p, kw){
  const k = String(kw).toLowerCase();
  const fields = [p.tag, p.type, p.category, p.subCategory, p.mainCategory, p.subcategory, p.section, p.name, p.desc];
  if (fields.some(f => norm(f).includes(k))) return true;
  if (Array.isArray(p.tags) && p.tags.some(t => norm(t).includes(k))) return true;
  if (Array.isArray(p.labels) && p.labels.some(t => norm(t).includes(k))) return true;
  return false;
}

function isNewProduct(p){
  // ✅ 你后台如果有明确字段，优先用
  if (isTrueFlag(p.isNew) || isTrueFlag(p.newArrival) || isTrueFlag(p.isNewArrival)) return true;

  // ✅ 关键词兜底
  if (hasKeyword(p, "新品") || hasKeyword(p, "new") || hasKeyword(p, "new arrival") || hasKeyword(p, "上新")) return true;

  // ✅ 时间兜底：createdAt / created_at / created（30天内算新品）
  const t =
    p.createdAt || p.created_at || p.created || p.createdTime || p.created_time || null;

  if (t) {
    const ts = Date.parse(t);
    if (!Number.isNaN(ts)) {
      const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (days >= 0 && days <= 30) return true;
    }
  }
  return false;
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
// 排序 / 分类过滤
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
  const vPrice = p?.__displayPrice;
  if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
  return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
}
function getSalesForSort(p) {
  return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount"], 0);
}

function applyFilterAndRender() {
  if (!gridEl || !window.FBCard) return;

  let list = [...productsViewAll];

  if (currentFilter && currentFilter !== "all") {
    list = list.filter((p) => {
      const cat = String(p.category || "").trim();
      const sub = String(p.subCategory || "").trim();
      return cat === currentFilter || sub === currentFilter;
    });
  }

  const sortVal = sortSelectEl?.value || "sales_desc";
  if (sortVal === "price_asc" || sortVal === "price_desc") {
    list.sort((a, b) => {
      const pa = getPriceForSort(a);
      const pb = getPriceForSort(b);
      return sortVal === "price_asc" ? pa - pb : pb - pa;
    });
  } else {
    list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
  }

  window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
}

// ============================
// 加载新品商品
// ============================
async function loadNewProducts() {
  if (!gridEl) return;

  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：请检查 product_card_renderer.js 引入顺序");
    gridEl.innerHTML = '<div style="padding:12px;font-size:13px;color:#6b7280;">页面缺少商品卡渲染器。</div>';
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

    productsRaw = cleaned.filter(isNewProduct);
    productsViewAll = window.FBCard.expand(productsRaw);

    currentFilter = "all";
    rebuildCategoryPills();
    applyFilterAndRender();
  } catch (e) {
    console.error("加载新品失败:", e);
    gridEl.innerHTML = '<div style="padding:12px;font-size:13px;color:#6b7280;">加载新品失败，请检查接口。</div>';
  }
}

// ============================
// 初始化
// ============================
document.addEventListener("DOMContentLoaded", () => {
  // 1) FBCard 全局绑定（加购/黑框/徽章）
  if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();

  // 2) 库存轮询（可选：跟分类页一致）
  if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

  // 3) 购物车抽屉 UI（必须）
  if (window.FreshCart?.initCartUI) {
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
    console.warn("❌ FreshCart.initCartUI 不存在：确认 cart.js 已加载且无报错");
  }

  // 4) 加载数据
  loadNewProducts();

  // 5) 排序监听
  if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);
});
