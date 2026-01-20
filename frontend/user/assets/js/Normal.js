// frontend/user/assets/js/Normal.js
console.log("✅ Normal.js loaded (renderer-driven + cart drawer hard-bind)");

(() => {
  // =========================
  // DOM
  // =========================
  const gridEl = document.getElementById("normalGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  // cart dom (Normal.html 里必须存在)
  const cartIconEl = document.getElementById("cartIcon");
  const cartBackdropEl = document.getElementById("cartBackdrop");
  const cartDrawerEl = document.getElementById("cartDrawer");
  const cartCloseBtnEl = document.getElementById("cartCloseBtn");
  const goCartBtnEl = document.getElementById("goCartBtn");

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.5;">${msg}</div>`;
  }

  if (!gridEl) {
    console.error("❌ normalGrid 不存在：检查 Normal.html 里 <div id='normalGrid'>");
    return;
  }

  // renderer 必须有
  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：Normal.html 必须先引入 product_card_renderer.js（且在 Normal.js 前）");
    showInline("❌ 缺少商品卡渲染器：请确认已引入 product_card_renderer.js（且在 Normal.js 之前）。", "#b91c1c");
    return;
  }

  // =========================
  // Auth helpers（跟你其他页一致）
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

  function getCreatedAt(p) {
    const t =
      p?.createdAt ||
      p?.created_at ||
      p?.updatedAt ||
      p?.updated_at ||
      p?.publishAt ||
      p?.publish_at ||
      null;
    const ts = t ? Date.parse(t) : NaN;
    return Number.isNaN(ts) ? 0 : ts;
  }

  // ✅ 爆品识别：Normal 页排除爆品
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeywordSimple(p, "爆品") ||
      hasKeywordSimple(p, "爆品日") ||
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
    const vPrice = p?.__displayPrice;
    if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }
  function getSalesForSort(p) {
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }

  // =========================
  // Pills（优先 subCategory；没有用 category）
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
    } else if (sortVal === "sales_desc") {
      list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
    } else {
      // 兜底：最新
      list.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    }

    if (!list.length) {
      showInline("当前筛选条件下没有商品。", "#6b7280");
      return;
    }

    // ✅ renderer 渲染（跟首页一致）
    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
  }

  // =========================
  // Load：除爆品外所有商品
  // =========================
  async function loadNormalProducts() {
    showInline("加载中…");

    const { res, data } = await apiFetch(`/api/products-simple?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("❌ /api/products-simple 失败:", res.status, data);
      showInline(`❌ 商品接口加载失败：${res.status}`, "#b91c1c");
      return;
    }

    const list = window.FBCard.extractList(data) || [];
    const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

    // ✅ Normal：排除爆品
    productsRaw = cleaned.filter((p) => !isHotProduct(p));

    if (!productsRaw.length) {
      showInline("没有可显示的商品（可能所有商品都被识别为爆品或被删除/下架）。", "#b91c1c");
      return;
    }

    // ✅ 拆卡：单卖/整箱两张（跟首页一致）
    productsViewAll = window.FBCard.expand(productsRaw);

    currentFilter = "all";
    rebuildCategoryPills();
    applyFilterAndRender();
  }

  // =========================
  // ✅ 购物车抽屉：硬绑定兜底（解决“只灰屏不出抽屉”）
  // =========================
  function openDrawer() {
    if (cartBackdropEl) cartBackdropEl.classList.add("active");
    if (cartDrawerEl) cartDrawerEl.classList.add("active");
    if (cartDrawerEl) cartDrawerEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    if (cartBackdropEl) cartBackdropEl.classList.remove("active");
    if (cartDrawerEl) cartDrawerEl.classList.remove("active");
    if (cartDrawerEl) cartDrawerEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function bindDrawerFallback() {
    // 点击购物车
    if (cartIconEl) {
      cartIconEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDrawer();
      });
    }
    // 关闭按钮
    if (cartCloseBtnEl) {
      cartCloseBtnEl.addEventListener("click", (e) => {
        e.preventDefault();
        closeDrawer();
      });
    }
    // 点击遮罩关闭
    if (cartBackdropEl) {
      cartBackdropEl.addEventListener("click", (e) => {
        e.preventDefault();
        closeDrawer();
      });
    }
    // ESC 关闭
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer();
    });
    // 去购物车
    if (goCartBtnEl) {
      goCartBtnEl.addEventListener("click", () => {
        location.href = "/user/cart.html";
      });
    }
  }

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // renderer 的全局事件（加购/黑框 +/- / 徽章）
    if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // ✅ 先尝试用 cart.js 的官方 init（如果它存在）
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
      console.warn("⚠️ FreshCart.initCartUI 不存在，启用抽屉兜底绑定");
    }

    // ✅ 不管 initCartUI 成不成功，都加兜底绑定（解决你现在的灰屏问题）
    bindDrawerFallback();

    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    loadNormalProducts().catch((e) => {
      console.error("❌ loadNormalProducts error:", e);
      showInline("加载商品失败：请打开控制台看报错。", "#b91c1c");
    });
  });
})();
