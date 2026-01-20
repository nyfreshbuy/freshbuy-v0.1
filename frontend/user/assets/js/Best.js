// frontend/user/assets/js/Best.js
console.log("✅ Best.js loaded (final: sticky header + green add-to-cart + cart click fixed)");

(() => {
  // =========================
  // DOM refs
  // =========================
  const headerEl = document.querySelector("header.top-nav") || document.querySelector(".top-nav");
  const gridEl = document.getElementById("bestGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  const cartIconEl = document.getElementById("cartIcon");
  const cartCountEl = document.getElementById("cartCount");

  // 兜底抽屉（如果 Best.html 没这些 DOM，Best.js 会自动注入）
  let drawer = null;
  let backdrop = null;

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.55;">${msg}</div>`;
  }

  if (!gridEl) {
    console.error("❌ bestGrid 不存在：检查 Best.html 里 <div id='bestGrid'>");
    return;
  }

  // =========================
  // 1) 顶部两排固定（导航 + 分类/排序）+ 阴影
  // =========================
  function enableFixedHeader() {
    if (!headerEl) return;

    // 给 header 注入 fixed 样式（不改 HTML）
    const stId = "best_fixed_header_style";
    if (!document.getElementById(stId)) {
      const st = document.createElement("style");
      st.id = stId;
      st.textContent = `
        :root{ --best-header-h: 120px; }

        header.top-nav, .top-nav{
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          z-index: 50000 !important;
          background: #fff !important;
          transition: box-shadow .2s ease;
        }
        header.top-nav.is-scrolled, .top-nav.is-scrolled{
          box-shadow: 0 6px 16px rgba(15,23,42,.10) !important;
        }

        /* ✅ 给页面主体让位 */
        main.page, .page{
          padding-top: calc(var(--best-header-h) + 12px) !important;
        }
      `;
      document.head.appendChild(st);
    }

    function applyHeight() {
      const h = Math.ceil(headerEl.getBoundingClientRect().height || 0);
      document.documentElement.style.setProperty("--best-header-h", h + "px");
    }
    function onScroll() {
      if (window.scrollY > 4) headerEl.classList.add("is-scrolled");
      else headerEl.classList.remove("is-scrolled");
    }

    applyHeight();
    onScroll();
    window.addEventListener("resize", applyHeight, { passive: true });
    window.addEventListener("orientationchange", applyHeight, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // =========================
  // 2) 强制 renderer 按钮变绿色（你截图那个灰按钮）
  //    不管 class 叫啥，统一覆盖 grid 内所有 button
  // =========================
  function injectForceGreenBtnCss() {
    const id = "best_force_green_btn_css";
    if (document.getElementById(id)) return;

    const st = document.createElement("style");
    st.id = id;
    st.textContent = `
      /* ✅ 只影响 bestGrid 里的按钮，避免影响全站 */
      #bestGrid button{
        width: 100% !important;
        height: 46px !important;
        border-radius: 14px !important;

        background: linear-gradient(135deg,#22c55e,#16a34a) !important;
        color: #fff !important;

        border: none !important;
        outline: none !important;

        font-size: 14px !important;
        font-weight: 900 !important;
        letter-spacing: .02em !important;

        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;

        box-shadow: 0 10px 18px rgba(22,163,74,.18) !important;
      }
      #bestGrid button:active{ transform: scale(.98) !important; }
      #bestGrid button:disabled{
        opacity: .55 !important;
        box-shadow: none !important;
        transform: none !important;
      }
    `;
    document.head.appendChild(st);
  }

  // =========================
  // 3) 购物车：优先走 FreshCart.initCartUI
  //    如果你的 Best.html 没有抽屉 DOM，就自动注入一套兜底抽屉
  // =========================
  function ensureFallbackCartDom() {
    // 已存在就不注入
    if (document.getElementById("cartDrawer") && document.getElementById("cartBackdrop")) return;

    const cssId = "best_fallback_cart_css";
    if (!document.getElementById(cssId)) {
      const st = document.createElement("style");
      st.id = cssId;
      st.textContent = `
        /* 兜底抽屉 */
        #cartBackdrop{
          position: fixed;
          inset: 0;
          background: rgba(15,23,42,.45);
          display: none;
          z-index: 60000;
        }
        #cartBackdrop.active{ display:block; }

        #cartDrawer{
          position: fixed;
          right: 0;
          top: 0;
          height: 100vh;
          width: 360px;
          max-width: 92vw;
          background: #fff;
          border-left: 1px solid #eef2f7;
          box-shadow: -12px 0 30px rgba(15,23,42,.18);
          transform: translateX(110%);
          transition: transform .25s ease;
          z-index: 60001;
          display: flex;
          flex-direction: column;
        }
        #cartDrawer.active{ transform: translateX(0); }

        #cartDrawer .hd{
          padding: 12px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          border-bottom:1px solid #eef2f7;
          font-weight:900;
        }
        #cartDrawer .bd{ padding: 12px; overflow:auto; flex:1; }
        #cartDrawer .ft{ padding: 12px; border-top:1px solid #eef2f7; }
        #cartCloseBtn{
          width: 36px; height: 36px;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          background:#fff;
          font-weight:900;
          cursor:pointer;
        }
        #goCartBtn{
          width:100%;
          height:46px;
          border:none;
          border-radius:14px;
          background:#0f172a;
          color:#fff;
          font-weight:900;
          cursor:pointer;
        }
        #cartEmptyText{ color:#6b7280; font-size:13px; padding: 8px 0; display:none; }
      `;
      document.head.appendChild(st);
    }

    const bd = document.createElement("div");
    bd.id = "cartBackdrop";

    const as = document.createElement("aside");
    as.id = "cartDrawer";
    as.innerHTML = `
      <div class="hd">
        <div>购物车</div>
        <button type="button" id="cartCloseBtn">✕</button>
      </div>
      <div class="bd">
        <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">
          共 <span id="cartTotalItems">0</span> 件
        </div>
        <div id="cartEmptyText">购物车还是空的，快去挑点好东西～</div>
        <div id="cartItemsList"></div>
      </div>
      <div class="ft">
        <button type="button" id="goCartBtn">去购物车结算</button>
      </div>
    `;

    document.body.appendChild(bd);
    document.body.appendChild(as);
  }

  function openDrawer() {
    backdrop = document.getElementById("cartBackdrop");
    drawer = document.getElementById("cartDrawer");
    if (!backdrop || !drawer) return;
    backdrop.classList.add("active");
    drawer.classList.add("active");
  }
  function closeDrawer() {
    backdrop = document.getElementById("cartBackdrop");
    drawer = document.getElementById("cartDrawer");
    if (!backdrop || !drawer) return;
    backdrop.classList.remove("active");
    drawer.classList.remove("active");
  }

  function wireCartClickAlwaysWorks() {
    if (!cartIconEl) return;

    // 先移除旧监听（防止重复绑定）
    cartIconEl.onclick = null;

    cartIconEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // ✅ 1) 如果 FreshCart 提供打开抽屉的方法，优先用
      if (window.FreshCart && typeof window.FreshCart.open === "function") {
        window.FreshCart.open();
        return;
      }
      if (window.FreshCart && typeof window.FreshCart.toggle === "function") {
        window.FreshCart.toggle(true);
        return;
      }

      // ✅ 2) 否则用兜底抽屉
      ensureFallbackCartDom();
      openDrawer();
    });

    // 兜底抽屉关闭
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === "cartBackdrop" || t.id === "cartCloseBtn") closeDrawer();
    });
  }

  // 购物车数量徽章：尽量从 FreshCart 拿，不行就本地算
  function getCartRaw() {
    const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
    for (const k of keys) {
      const s = localStorage.getItem(k);
      if (s && String(s).trim()) {
        try { return JSON.parse(s); } catch {}
      }
    }
    return null;
  }
  function calcTotalItems(raw) {
    if (!raw) return 0;
    let total = 0;
    if (Array.isArray(raw)) {
      for (const it of raw) total += Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
      return total;
    }
    if (raw && Array.isArray(raw.items)) {
      for (const it of raw.items) total += Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
      return total;
    }
    if (typeof raw === "object") {
      for (const v of Object.values(raw)) total += Number(v) || 0;
      return total;
    }
    return 0;
  }
  function refreshCartCountBadge() {
    if (!cartCountEl) return;
    let n = 0;

    if (window.FreshCart && typeof window.FreshCart.getTotalQty === "function") {
      n = Number(window.FreshCart.getTotalQty() || 0) || 0;
    } else {
      n = calcTotalItems(getCartRaw());
    }

    cartCountEl.textContent = String(n);
    cartCountEl.style.display = n > 0 ? "inline-block" : "none";
  }

  // =========================
  // 4) Best 商品识别/加载/分类/排序（保持你原逻辑）
  // =========================
  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }
  function norm(v) {
    return v ? String(v).toLowerCase() : "";
  }
  function hasKeyword(p, kw) {
    const k = String(kw).toLowerCase();
    const fields = [p?.tag, p?.type, p?.category, p?.subCategory, p?.mainCategory, p?.subcategory, p?.section, p?.name, p?.desc];
    if (fields.some((f) => norm(f).includes(k))) return true;
    if (Array.isArray(p?.tags) && p.tags.some((t) => norm(t).includes(k))) return true;
    if (Array.isArray(p?.labels) && p.labels.some((t) => norm(t).includes(k))) return true;
    return false;
  }
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "hot")
    );
  }
  function isBestSellerProduct(p) {
    if (
      isTrueFlag(p?.isBest) ||
      isTrueFlag(p?.isBestSeller) ||
      isTrueFlag(p?.bestSeller) ||
      isTrueFlag(p?.isTop) ||
      isTrueFlag(p?.topSeller)
    ) return true;

    return (
      hasKeyword(p, "畅销") ||
      hasKeyword(p, "热销") ||
      hasKeyword(p, "top") ||
      hasKeyword(p, "best") ||
      hasKeyword(p, "bestseller")
    );
  }
  function getNum(p, keys, def = 0) {
    for (const k of keys) {
      const n = Number(p?.[k]);
      if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
    }
    return def;
  }
  function getSales(p) {
    return getNum(p, ["sales", "sold", "saleCount", "salesCount", "orderCount"], 0);
  }
  function getPrice(p) {
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }

  let ALL = [];
  let bestAll = [];
  let currentFilter = "all";
  let FILTERS = [{ key: "all", name: "全部" }];

  const CATEGORY_NAME_MAP = {
    fresh: "生鲜果蔬",
    meat: "肉禽海鲜",
    snacks: "零食饮品",
    staples: "粮油主食",
    seasoning: "调味酱料",
    frozen: "冷冻食品",
    household: "日用清洁",
  };

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
  function getCategoryLabel(key) {
    return CATEGORY_NAME_MAP[key] || key || "未分类";
  }
  function buildFiltersFromProducts(list) {
    const set = new Set();
    list.forEach((p) => {
      const k = getCategoryKey(p);
      if (k) set.add(k);
    });

    const keys = Array.from(set);
    const preferred = ["fresh", "meat", "snacks", "staples", "seasoning", "frozen", "household"];
    keys.sort((a, b) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    return [{ key: "all", name: "全部" }].concat(keys.map((k) => ({ key: k, name: getCategoryLabel(k) })));
  }

  function sortList(list, sortKey) {
    const arr = [...list];
    if (sortKey === "price_asc") arr.sort((a, b) => getPrice(a) - getPrice(b));
    else if (sortKey === "price_desc") arr.sort((a, b) => getPrice(b) - getPrice(a));
    else arr.sort((a, b) => getSales(b) - getSales(a));
    return arr;
  }

  function renderFilters() {
    if (!filterBarEl) return;
    filterBarEl.innerHTML = "";

    FILTERS.forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-pill" + (f.key === currentFilter ? " active" : "");
      btn.textContent = f.name;

      btn.addEventListener("click", () => {
        currentFilter = f.key;
        filterBarEl.querySelectorAll(".filter-pill").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        renderList();
      });

      filterBarEl.appendChild(btn);
    });
  }

  function renderList() {
    const sortKey = sortSelectEl ? sortSelectEl.value : "sales_desc";
    let list = bestAll.filter((p) => (currentFilter === "all" ? true : getCategoryKey(p) === currentFilter));
    list = sortList(list, sortKey);

    if (!list.length) {
      showInline("该分类暂无畅销商品", "#6b7280");
      return;
    }

    // ✅ 用 renderer（如果你 Best.html 引入了 product_card_renderer.js）
    if (window.FBCard && typeof window.FBCard.renderGrid === "function") {
      gridEl.innerHTML = "";
      window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
      // 渲染完成后，强制按钮变绿 + 刷新购物车徽章
      refreshCartCountBadge();
      return;
    }

    // 没 renderer 就提示
    showInline("❌ 缺少 product_card_renderer.js：请在 Best.html 里先引入它（在 Best.js 之前）。", "#b91c1c");
  }

  async function loadProducts() {
    showInline("加载中…");

    const res = await fetch(`/api/products-simple?ts=${Date.now()}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

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

    bestAll = list.filter((p) => isBestSellerProduct(p) && !isHotProduct(p));

    // ✅ 兜底：如果没打标签/字段，就按销量 Top 取前 60
    if (!bestAll.length && list.length) {
      bestAll = [...list]
        .filter((p) => !isHotProduct(p))
        .sort((a, b) => getSales(b) - getSales(a))
        .slice(0, 60);
    }

    if (!bestAll.length) {
      showInline("没有可显示的畅销商品（接口返回为空或全部被过滤）。", "#b91c1c");
      return;
    }

    FILTERS = buildFiltersFromProducts(bestAll);
    currentFilter = "all";

    renderFilters();
    renderList();
  }

  // =========================
  // 5) Init
  // =========================
  window.addEventListener("DOMContentLoaded", () => {
    enableFixedHeader();
    injectForceGreenBtnCss();

    // 确保 cart 点击有反应
    wireCartClickAlwaysWorks();

    // 如果 FreshCart 有 initCartUI，就初始化（让它管理抽屉/数量/结算）
    // 但就算没有，也不会影响“点击购物车弹出兜底抽屉”
    if (window.FreshCart && typeof window.FreshCart.initCartUI === "function") {
      // 如果你的 Best.html 没有抽屉 DOM，这里也先注入，避免 initCartUI 找不到
      ensureFallbackCartDom();

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
      // 没 FreshCart.initCartUI：至少保证 badge 能更新
      refreshCartCountBadge();
    }

    // 监听排序
    if (sortSelectEl) sortSelectEl.addEventListener("change", renderList);

    // 监听购物车变化（跨页面/跨 tab）
    window.addEventListener("storage", (e) => {
      const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
      if (e && keys.includes(e.key)) refreshCartCountBadge();
    });
    window.addEventListener("freshbuy:cart_updated", refreshCartCountBadge);

    // 拉商品
    loadProducts().catch((err) => {
      console.error("❌ loadProducts error:", err);
      showInline("加载失败，请打开 Console 看报错。", "#b91c1c");
    });
  });
})();
