// /user/assets/js/Normal.js
console.log("✅ Normal.js loaded (homepage card + homepage cart + sticky top)");

(() => {
  const gridEl = document.getElementById("normalGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.6;">${msg}</div>`;
  }

  if (!gridEl) return console.error("❌ normalGrid 不存在：检查 Normal.html");
  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：Normal.html 必须先引入 product_card_renderer.js（在 Normal.js 之前）");
    showInline("❌ 缺少渲染器 product_card_renderer.js（脚本顺序不对）。", "#b91c1c");
    return;
  }

  // =========================
  // Auth fetch（跟你其它页一致）
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
  // 判定工具
  // =========================
  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }
  function norm(v) { return v ? String(v).toLowerCase() : ""; }
  function hasKeywordSimple(p, keyword) {
    if (!p) return false;
    const kw = String(keyword).toLowerCase();
    const fields = [
      p.tag, p.type, p.category, p.subCategory, p.mainCategory,
      p.subcategory, p.section, p.name, p.desc
    ];
    if (fields.some((f) => norm(f).includes(kw))) return true;
    if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
    if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;
    return false;
  }

  function getCreatedAt(p) {
    const t = p?.createdAt || p?.created_at || p?.updatedAt || p?.updated_at || p?.publishAt || p?.publish_at || null;
    const ts = t ? Date.parse(t) : NaN;
    return Number.isNaN(ts) ? 0 : ts;
  }

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

    // 30 天兜底：最近上架也算新品
    const ts = getCreatedAt(p);
    if (ts > 0) {
      const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (days >= 0 && days <= 30) return true;
    }
    return false;
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
      hasKeywordSimple(p, "畅销") ||
      hasKeywordSimple(p, "热销") ||
      hasKeywordSimple(p, "top") ||
      hasKeywordSimple(p, "best") ||
      hasKeywordSimple(p, "bestseller")
    );
  }

  // =========================
  // pills：优先 subCategory；没有就 category
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
  // 排序（跟 New 风格）
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
      list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
    }

    if (!list.length) {
      showInline("当前筛选条件下没有商品。", "#6b7280");
      return;
    }

    // ✅ 关键：用 renderer 渲染（卡片就跟首页一致）
    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
  }

  // =========================
  // Load：Normal = 排除 爆品/特价/新品/畅销
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

    productsRaw = cleaned.filter((p) => {
      if (isHotProduct(p)) return false;
      if (isDailySpecialProduct(p)) return false;
      if (isNewProduct(p)) return false;
      if (isBestSellerProduct(p)) return false;
      return true;
    });

    // ✅ 兜底：如果 normal 被排空，就至少显示“非爆品”
    if (!productsRaw.length && cleaned.length) {
      console.warn("[Normal] normal empty fallback: use non-hot products");
      productsRaw = cleaned.filter((p) => !isHotProduct(p));
    }

    // ✅ 关键：expand（单卖/整箱拆成两张卡）→ 跟首页一致
    productsViewAll = window.FBCard.expand(productsRaw);

    currentFilter = "all";
    rebuildCategoryPills();
    applyFilterAndRender();
  }

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // ✅ renderer 全局绑定（按钮/黑框 +/- /徽章/点击图&名跳详情），跟首页一致
    if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // ✅ 购物车抽屉（右上角购物车必须能点开）
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

    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    loadNormalProducts().catch((e) => {
      console.error("❌ loadNormalProducts error:", e);
      showInline("加载失败：请打开控制台看报错（Console）。", "#b91c1c");
    });
  });
})();
