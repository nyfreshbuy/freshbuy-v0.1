// frontend/user/assets/js/newcomer.js
console.log("✅ newcomer.js loaded (HOT ONLY + homepage-render + cart fix)");

(() => {
  // -------------------------
  // DOM refs
  // -------------------------
  const gridEl = document.getElementById("newcomerGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  const ids = {
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
  };

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.6;">${msg}</div>`;
  }

  if (!gridEl) {
    console.error("❌ newcomerGrid 不存在：检查 newcomer.html 里 <div id='newcomerGrid'>");
    return;
  }

  // -------------------------
  // Renderer API detection
  // 目标：用“首页同款渲染”
  // 1) window.renderProductCard  (你 renderer 警告里提到的函数名)
  // 2) window.FBCard.renderGrid  (我之前给你的封装)
  // -------------------------
  function hasHomepageRenderer() {
    return typeof window.renderProductCard === "function" || !!window.FBCard?.renderGrid;
  }

  // -------------------------
  // Auth helpers
  // -------------------------
  const AUTH_TOKEN_KEY = "freshbuy_token";
  const getToken = () => localStorage.getItem(AUTH_TOKEN_KEY) || "";
  const clearToken = () => localStorage.removeItem(AUTH_TOKEN_KEY);

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

  // -------------------------
  // Helpers
  // -------------------------
  const isTrueFlag = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  const norm = (v) => (v ? String(v).toLowerCase() : "");

  function hasKeyword(p, keyword) {
    if (!p) return false;
    const kw = String(keyword).toLowerCase();
    const fields = [p.tag, p.type, p.category, p.subCategory, p.mainCategory, p.subcategory, p.section, p.name, p.desc];
    if (fields.some((f) => norm(f).includes(kw))) return true;
    if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
    if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;
    return false;
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
    const vPrice = p?.__displayPrice;
    if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }

  function getSalesForSort(p) {
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }

  // -------------------------
  // HOT ONLY
  // -------------------------
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "爆品日") ||
      hasKeyword(p, "hot") ||
      hasKeyword(p, "hotdeal")
    );
  }

  // -------------------------
  // Pills
  // -------------------------
  let productsRaw = [];
  let productsViewAll = [];
  let currentFilter = "all";

  function pickCategoryLabel(p) {
    const sub = String(p?.subCategory || "").trim();
    const cat = String(p?.category || "").trim();
    return sub || cat || "";
  }

  function rebuildCategoryPills() {
    if (!filterBarEl) return;

    const set = new Set();
    productsRaw.forEach((p) => {
      const label = pickCategoryLabel(p);
      if (label) set.add(label);
    });

    const cats = Array.from(set).sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
    filterBarEl.innerHTML = "";

    const makeBtn = (label, val, active) => {
      const btn = document.createElement("button");
      btn.className = "filter-pill" + (active ? " active" : "");
      btn.type = "button";
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

  // -------------------------
  // ✅ 使用“首页同款渲染”渲染网格
  // 优先：window.renderProductCard
  // 兜底：window.FBCard.renderGrid
  // -------------------------
  function renderWithHomepageRenderer(list) {
    // 方式1：renderProductCard 一张一张拼（最兼容你当前 renderer 警告）
    if (typeof window.renderProductCard === "function") {
      gridEl.innerHTML = "";
      const frag = document.createDocumentFragment();

      for (const p of list) {
        // renderProductCard 返回 HTML 字符串 / 或 DOM 节点（做两种兼容）
        const out = window.renderProductCard(p);
        if (!out) continue;

        if (typeof out === "string") {
          const tmp = document.createElement("div");
          tmp.innerHTML = out;
          // 通常 card 会是第一个元素
          const node = tmp.firstElementChild || tmp;
          frag.appendChild(node);
        } else if (out instanceof HTMLElement) {
          frag.appendChild(out);
        } else {
          // 其它类型，忽略
        }
      }

      gridEl.appendChild(frag);

      // ✅ 如果首页渲染器需要绑定事件（有的写在 ensureGlobalBindings）
      if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
      return true;
    }

    // 方式2：FBCard.renderGrid
    if (window.FBCard?.renderGrid) {
      window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
      return true;
    }

    return false;
  }

  function applyFilterAndRender() {
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
    const sortVal = sortSelectEl?.value || "sales_desc";
    if (sortVal === "price_asc" || sortVal === "price_desc") {
      list.sort((a, b) => {
        const pa = getPriceForSort(a);
        const pb = getPriceForSort(b);
        return sortVal === "price_asc" ? pa - pb : pb - pa;
      });
    } else {
      const hasAnySales = list.some((p) => getSalesForSort(p) > 0);
      if (hasAnySales) list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
    }

    if (!list.length) {
      showInline("当前筛选条件下没有爆品商品。", "#6b7280");
      return;
    }

    // ✅ 渲染
    const ok = renderWithHomepageRenderer(list);
    if (!ok) {
      console.error("❌ 找不到首页渲染器：需要 window.renderProductCard 或 window.FBCard.renderGrid");
      showInline(
        "❌ 商品卡渲染器接口不匹配：<br>请确认 product_card_renderer.js 是否与首页同版本，并且首页确实定义了 renderProductCard 或 FBCard.renderGrid。",
        "#b91c1c"
      );
    }
  }

  // -------------------------
  // Load HOT products
  // -------------------------
  async function loadHotProducts() {
    showInline("加载中…");

    const { res, data } = await apiFetch(`/api/products-simple?ts=${Date.now()}`, { method: "GET", cache: "no-store" });

    if (!res.ok) {
      console.error("❌ /api/products-simple 失败:", res.status, data);
      showInline(`❌ 商品接口加载失败：${res.status}（检查 /api/products-simple）`, "#b91c1c");
      return;
    }

    const list = window.FBCard?.extractList ? window.FBCard.extractList(data) : (
      Array.isArray(data) ? data :
      Array.isArray(data?.items) ? data.items :
      Array.isArray(data?.products) ? data.products :
      Array.isArray(data?.list) ? data.list : []
    );

    const cleaned = (list || []).filter((p) => !p?.isDeleted && p?.deleted !== true && p?.status !== "deleted");
    productsRaw = cleaned.filter(isHotProduct);

    // ✅ 兜底：爆品为空就按销量 top 60（避免空页）
    if (!productsRaw.length && cleaned.length) {
      console.warn("[Newcomer] hot empty -> fallback top sales 60");
      productsRaw = [...cleaned].sort((a, b) => getSalesForSort(b) - getSalesForSort(a)).slice(0, 60);
    }

    if (!productsRaw.length) {
      showInline("没有可显示的爆品商品（后台可能没打 isHot/爆品 标签）。", "#b91c1c");
      return;
    }

    // ✅ expand：如果 FBCard.expand 存在就拆卡，否则不拆（也能渲染）
    productsViewAll = window.FBCard?.expand ? window.FBCard.expand(productsRaw) : [...productsRaw];

    currentFilter = "all";
    rebuildCategoryPills();
    applyFilterAndRender();

    console.log(
      "[Newcomer] raw:", (list || []).length,
      "cleaned:", cleaned.length,
      "hotRaw:", productsRaw.length,
      "view:", productsViewAll.length,
      "hasHomepageRenderer:", hasHomepageRenderer()
    );
  }

  // -------------------------
  // ✅ 购物车：修复“只灰屏/抽屉不出/点购物车没反应”
  // 不改 cart.js，只在本页兜底
  // -------------------------
  function ensureCartLayerOnTop() {
    const topFixed = document.getElementById("topFixed");
    const backdrop = document.getElementById(ids.cartBackdropId);
    const drawer = document.getElementById(ids.cartDrawerId);

    // 关键：让抽屉层级高于顶部固定栏
    if (topFixed) topFixed.style.zIndex = "99990";
    if (backdrop) backdrop.style.zIndex = "99995";
    if (drawer) drawer.style.zIndex = "99996";
  }

  function cartFallbackCloseWiring() {
    const backdrop = document.getElementById(ids.cartBackdropId);
    const drawer = document.getElementById(ids.cartDrawerId);
    const closeBtn = document.getElementById(ids.cartCloseBtnId);

    if (!backdrop || !drawer) return;

    const closeCart = () => {
      backdrop.classList.remove("active", "open", "show");
      drawer.classList.remove("active", "open", "show");
      drawer.setAttribute("aria-hidden", "true");
    };

    backdrop.addEventListener("click", closeCart);
    if (closeBtn) closeBtn.addEventListener("click", closeCart);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCart();
    });
  }

  // -------------------------
  // Init
  // -------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // ✅ 层级修复
    ensureCartLayerOnTop();

    // ✅ renderer bindings（如果你 FBCard 版本支持）
    if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // ✅ cart init（必须有，否则右上角不会打开抽屉）
    if (window.FreshCart?.initCartUI) {
      window.FreshCart.initCartUI({
        cartIconId: ids.cartIconId,
        cartBackdropId: ids.cartBackdropId,
        cartDrawerId: ids.cartDrawerId,
        cartCloseBtnId: ids.cartCloseBtnId,
        cartCountId: ids.cartCountId,
        cartTotalItemsId: ids.cartTotalItemsId,
        cartEmptyTextId: ids.cartEmptyTextId,
        cartItemsListId: ids.cartItemsListId,
        toastId: ids.toastId,
        goCartBtnId: ids.goCartBtnId,
        cartPageUrl: "/user/cart.html",
      });
    } else {
      console.warn("❌ FreshCart.initCartUI 不存在：但你说其它页面没问题，说明 newcomer.html 的 script 顺序/路径可能不对");
    }

    // ✅ 本页兜底：避免“只灰屏不出抽屉/关不掉”
    cartFallbackCloseWiring();

    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    // ✅ 最后加载数据
    loadHotProducts().catch((e) => {
      console.error("❌ loadHotProducts error:", e);
      showInline("加载失败：请打开控制台查看报错。", "#b91c1c");
    });
  });
})();
