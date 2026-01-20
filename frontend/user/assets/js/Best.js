// frontend/user/assets/js/Best.js
console.log("✅ Best.js loaded (renderer-only, sticky+cart ready)");

(() => {
  const gridEl = document.getElementById("bestGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  if (!gridEl) return console.error("❌ bestGrid 不存在（Best.html 里需要 <div id='bestGrid'>）");

  // ✅ 必须先有 renderer
  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：Best.html 必须先引入 product_card_renderer.js 且在 Best.js 之前");
    gridEl.innerHTML =
      `<div style="padding:12px;color:#b91c1c;font-size:13px;">缺少渲染器 product_card_renderer.js（请检查脚本顺序）</div>`;
    return;
  }

  // =========================
  // Auth helpers（与 category.js 同风格）
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
  // Helpers
  // =========================
  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }
  function norm(v) { return v ? String(v).toLowerCase() : ""; }

  function hasKeywordSimple(p, keyword) {
    if (!p) return false;
    const kw = String(keyword).toLowerCase();
    const fields = [
      p.tag, p.type, p.category, p.subCategory, p.mainCategory, p.subcategory, p.section, p.name, p.desc,
    ];
    if (fields.some((f) => norm(f).includes(kw))) return true;
    if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
    if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;
    return false;
  }

  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeywordSimple(p, "爆品") ||
      hasKeywordSimple(p, "hot")
    );
  }

  function isBestProduct(p) {
    // 字段优先
    if (
      isTrueFlag(p?.isBest) ||
      isTrueFlag(p?.isBestSeller) ||
      isTrueFlag(p?.bestSeller) ||
      isTrueFlag(p?.isTop) ||
      isTrueFlag(p?.topSeller)
    ) return true;

    // 关键词兜底
    return (
      hasKeywordSimple(p, "畅销") ||
      hasKeywordSimple(p, "热销") ||
      hasKeywordSimple(p, "top") ||
      hasKeywordSimple(p, "best") ||
      hasKeywordSimple(p, "bestseller")
    );
  }

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

  function getSalesForSort(p) {
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }

  // =========================
  // State
  // =========================
  let productsRaw = [];      // 原始 best 商品（不拆卡）
  let productsViewAll = [];  // 拆卡后（单卖/整箱）
  let currentFilter = "all"; // pills

  // =========================
  // Pills（优先 subCategory；没有则 category）
  // =========================
  function rebuildPills() {
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

  // =========================
  // Render（只交给 renderer）
  // =========================
  function applyFilterAndRender() {
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

    if (!list.length) {
      gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">当前筛选条件下没有畅销商品</div>`;
      return;
    }

    // ✅ 关键：用 renderer 输出卡片
    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });

    // ✅ 强制触发一次“购物车更新”广播，让 renderer 立刻把 qty>0 的卡切换成 “- qty +”
    window.dispatchEvent(new Event("freshbuy:cart_updated"));
  }

  // =========================
  // Load
  // =========================
  async function loadBestProducts() {
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">加载中…</div>`;

    const { res, data } = await apiFetch(`/api/products-simple?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:#b91c1c;">加载失败：${res.status}</div>`;
      return;
    }

    const list = window.FBCard.extractList(data) || [];
    const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

    productsRaw = cleaned.filter((p) => isBestProduct(p) && !isHotProduct(p));

    // ✅ 兜底：如果没打 best 字段/标签，就按销量 Top 取 60
    if (!productsRaw.length && cleaned.length) {
      productsRaw = [...cleaned]
        .filter((p) => !isHotProduct(p))
        .sort((a, b) => getSalesForSort(b) - getSalesForSort(a))
        .slice(0, 60);
    }

    if (!productsRaw.length) {
      gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:#b91c1c;">没有可显示的商品（接口返回为空或全部被删除/下架）</div>`;
      return;
    }

    // ✅ 拆卡：单卖/整箱两张（跟首页/分类页一致）
    productsViewAll = window.FBCard.expand(productsRaw);

    currentFilter = "all";
    rebuildPills();
    applyFilterAndRender();
  }

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // 1) renderer 全局绑定 + 库存轮询（保证加购后会切换成 “- qty +”）
    if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // 2) 购物车抽屉（否则点右上角没反应）
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
      console.warn("❌ FreshCart.initCartUI 不存在：cart.js 没加载成功或报错");
    }

    // 3) 监听：排序改变
    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    // 4) 监听：任何地方改了购物车，强制让 renderer 刷新 qty->步进条
    window.addEventListener("freshbuy:cart_updated", () => {
      // renderGrid 内部一般会更新，这里再保险触发一次重绘（不丢筛选）
      applyFilterAndRender();
    });

    loadBestProducts().catch((e) => {
      console.error("❌ loadBestProducts error:", e);
      gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:#b91c1c;">加载失败：请看 Console</div>`;
    });
  });
})();
