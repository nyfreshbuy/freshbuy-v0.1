// frontend/user/assets/js/New.js
console.log("✅ New.js loaded (renderer-driven, same as DailySpecial)");

(() => {
  // =========================
  // Auth helpers（同 DailySpecial）
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
  // DOM
  // =========================
  const gridEl = document.getElementById("newGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  // =========================
  // State
  // =========================
  let productsRaw = [];      // 原始（不拆卡）
  let productsViewAll = [];  // 拆卡后（单卖/整箱）
  let currentFilter = "all";

  // =========================
  // Helpers
  // =========================
  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }
  function norm(v) {
    return v ? String(v).toLowerCase() : "";
  }
  function hasKeywordSimple(p, keyword) {
    if (!p) return false;
    const kw = String(keyword).toLowerCase();
    const fields = [
      p.tag,
      p.type,
      p.category,
      p.subCategory,
      p.mainCategory,
      p.subcategory,
      p.section,
      p.name,
      p.desc,
    ];
    if (fields.some((f) => norm(f).includes(kw))) return true;
    if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
    if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;
    return false;
  }

  // ✅ 新品判定：flag/keyword/createdAt<=30天（兜底）
  function isNewProduct(p) {
    if (
      isTrueFlag(p?.isNew) ||
      isTrueFlag(p?.isNewArrival) ||
      isTrueFlag(p?.newArrival) ||
      isTrueFlag(p?.new) ||
      hasKeywordSimple(p, "新品") ||
      hasKeywordSimple(p, "新上架") ||
      hasKeywordSimple(p, "new")
    ) return true;

    // createdAt 30 天兜底
    const t = p?.createdAt || p?.created_at || p?.created || p?.publishAt || p?.publish_at || null;
    if (t) {
      const ts = Date.parse(t);
      if (!Number.isNaN(ts)) {
        const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
        if (days >= 0 && days <= 30) return true;
      }
    }
    return false;
  }

  // ✅ 爆品识别：新品页排除爆品（保持你原逻辑）
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeywordSimple(p, "爆品") ||
      hasKeywordSimple(p, "hot")
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
    // 拆卡后整箱卡会带 __displayPrice
    const vPrice = p?.__displayPrice;
    if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }
  function getSalesForSort(p) {
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }
  function getCreatedAt(p) {
    const t = p?.createdAt || p?.created_at || p?.updatedAt || p?.updated_at || p?.publishAt || p?.publish_at || null;
    const ts = t ? Date.parse(t) : NaN;
    return Number.isNaN(ts) ? 0 : ts;
  }

  // =========================
  // Pills（优先 subCategory；没有就用 category）
  // =========================
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

  // =========================
  // Filter + Sort + Render
  // =========================
  function applyFilterAndRender() {
    if (!gridEl || !window.FBCard) return;

    let list = [...productsViewAll];

    // 分类过滤
    if (currentFilter && currentFilter !== "all") {
      list = list.filter((p) => {
        const cat = String(p.category || "").trim();
        const sub = String(p.subCategory || "").trim();
        return cat === currentFilter || sub === currentFilter;
      });
    }

    // 排序
    const sortVal = sortSelectEl?.value || "newest_desc";
    if (sortVal === "price_asc" || sortVal === "price_desc") {
      list.sort((a, b) => {
        const pa = getPriceForSort(a);
        const pb = getPriceForSort(b);
        return sortVal === "price_asc" ? pa - pb : pb - pa;
      });
    } else if (sortVal === "sales_desc") {
      list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
    } else if (sortVal === "newest_desc") {
      list.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    }

    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
  }

  // =========================
  // Load products
  // =========================
  async function loadNewProducts() {
    if (!gridEl) return;

    if (!window.FBCard) {
      console.error("❌ FBCard 不存在：请检查是否引入 product_card_renderer.js（并且要在 New.js 前）");
      gridEl.innerHTML = `<div style="padding:12px;color:#6b7280;">页面缺少商品卡渲染器（product_card_renderer.js）。</div>`;
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

      // ✅ 新品过滤 + 排除爆品
      productsRaw = cleaned.filter((p) => isNewProduct(p) && !isHotProduct(p));

      // ✅ 兜底：如果没有任何新品，就按时间取前 60（你旧版逻辑）
      if (!productsRaw.length && cleaned.length) {
        console.warn("[New] 新品为空，启用兜底：按 createdAt/updatedAt 最新取前 60");
        productsRaw = [...cleaned]
          .filter((p) => !isHotProduct(p))
          .sort((a, b) => getCreatedAt(b) - getCreatedAt(a))
          .slice(0, 60);
      }

      // ✅ 拆卡（单卖/整箱）= 分类页/日常页同款
      productsViewAll = window.FBCard.expand(productsRaw);

      currentFilter = "all";
      rebuildCategoryPills();
      applyFilterAndRender();
    } catch (e) {
      console.error("加载新品失败:", e);
      gridEl.innerHTML = `<div style="padding:12px;color:#b91c1c;">加载失败，请检查 /api/products-simple 接口</div>`;
    }
  }

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // 1) renderer 全局绑定（加购/黑框+/-/徽章等）
    if (window.FBCard?.ensureGlobalBindings) {
      window.FBCard.ensureGlobalBindings();
    } else {
      console.warn("❌ FBCard.ensureGlobalBindings 不存在：检查 product_card_renderer.js 版本/顺序");
    }

    // 2) 库存轮询（跟分类页一致）
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // 3) 购物车抽屉（跟 DailySpecial 一样）
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
      console.warn("❌ FreshCart.initCartUI 不存在：请确认 cart.js 已引入且无报错");
    }

    // 4) 加载商品
    loadNewProducts();

    // 5) 排序监听
    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);
  });
})();
