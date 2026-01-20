// frontend/user/assets/js/Best.js
console.log("✅ Best.js loaded (renderer-driven)");

(() => {
  const gridEl = document.getElementById("bestGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  // =========================
  // Auth helpers（同你项目风格）
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

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.6;">${msg}</div>`;
  }

  // =========================
  // 依赖检查
  // =========================
  if (!gridEl) {
    console.error("❌ bestGrid 不存在：检查 Best.html 里的 <div id='bestGrid'>");
    return;
  }
  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：请确认 Best.html 已在 Best.js 之前引入 product_card_renderer.js");
    showInline("❌ 页面缺少渲染器：请在 Best.js 之前引入 product_card_renderer.js", "#b91c1c");
    return;
  }

  // =========================
  // Best 识别（Best=畅销/热销/Top）
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

  function isBestProduct(p) {
    return (
      isTrueFlag(p?.isBest) ||
      isTrueFlag(p?.isBestSeller) ||
      isTrueFlag(p?.bestSeller) ||
      isTrueFlag(p?.best) ||
      hasKeywordSimple(p, "畅销") ||
      hasKeywordSimple(p, "热销") ||
      hasKeywordSimple(p, "top") ||
      hasKeywordSimple(p, "best")
    );
  }

  // =========================
  // 分类 pills（优先 subCategory；没有就用 category）
  // =========================
  let productsRaw = [];
  let productsViewAll = [];
  let currentFilter = "all";

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
  // 排序（销量/价格）
  // =========================
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
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }

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
      // 默认销量高→低
      list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
    }

    if (!list.length) {
      showInline("当前筛选条件下没有畅销商品（可能后台没打 isBest / 标签没写 Best/Top/热销）。");
      return;
    }

    // ✅ 交给 renderer 画卡（按钮/徽章/单卖整箱拆卡/库存轮询/加购逻辑都一致）
    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
  }

  // =========================
  // Load
  // =========================
  async function loadBestProducts() {
    showInline("加载中…");

    const { res, data } = await apiFetch(`/api/products-simple?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("❌ /api/products-simple 失败:", res.status, data);
      showInline(`❌ 商品接口加载失败：${res.status}（检查 /api/products-simple）`, "#b91c1c");
      return;
    }

    const list = window.FBCard.extractList(data) || [];
    const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

    // ✅ 只保留 Best
    productsRaw = cleaned.filter((p) => isBestProduct(p));

    // ✅ 兜底：如果一个都没有，就按销量取前 60（保证页面不空）
    if (!productsRaw.length && cleaned.length) {
      console.warn("[Best] empty best, fallback by sales top 60");
      productsRaw = [...cleaned]
        .sort((a, b) => getSalesForSort(b) - getSalesForSort(a))
        .slice(0, 60);
    }

    if (!productsRaw.length) {
      showInline("没有可显示的商品（接口为空或全部被删除/下架）。", "#b91c1c");
      return;
    }

    // ✅ 拆卡：单卖/整箱两张
    productsViewAll = window.FBCard.expand(productsRaw);

    currentFilter = "all";
    rebuildCategoryPills();
    applyFilterAndRender();
  }

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // 1) renderer 全局绑定（按钮事件/徽章/黑框 +/-）
    if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
    // 2) 库存轮询
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // 3) 购物车抽屉（让右上角购物车能点开）
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

    // 4) 排序监听
    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    // 5) 加载
    loadBestProducts().catch((e) => {
      console.error("❌ loadBestProducts error:", e);
      showInline("加载畅销失败：请打开控制台看报错（Console）。", "#b91c1c");
    });
  });
})();
