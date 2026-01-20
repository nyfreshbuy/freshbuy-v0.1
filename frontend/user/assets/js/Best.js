// frontend/user/assets/js/Best.js
console.log("✅ Best.js loaded (renderer-driven, debug-safe)");

(() => {
  const gridEl = document.getElementById("bestGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.6;">${msg}</div>`;
  }

  // ============ DOM 检查 ============
  if (!gridEl) {
    console.error("❌ bestGrid 不存在：检查 Best.html 里 <div id='bestGrid'>");
    return;
  }

  // ============ 依赖检查：必须先加载 renderer ============
  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：Best.html 必须先引入 product_card_renderer.js（在 Best.js 之前）");
    showInline(
      "❌ 页面缺少渲染器 FBCard：请在 Best.html 底部先引入 <b>/user/assets/js/product_card_renderer.js</b>（并放在 Best.js 之前）。",
      "#b91c1c"
    );
    return;
  }

  // =========================
  // Auth helpers（兼容你项目 token）
  // =========================
  const AUTH_TOKEN_KEYS = [
    "freshbuy_token",
    "auth_token",
    "token",
    "access_token",
    "jwt",
  ];
  function getToken() {
    for (const k of AUTH_TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }
  function clearToken() {
    for (const k of AUTH_TOKEN_KEYS) localStorage.removeItem(k);
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
  function hasKeyword(p, keyword) {
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

  function getNum(p, keys, def = 0) {
    for (const k of keys) {
      const v = p?.[k];
      const n = Number(v);
      if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
    }
    return def;
  }
  function getSales(p) {
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }
  function getPriceForSort(p) {
    const vPrice = p?.__displayPrice;
    if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
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

  // ✅ 爆品识别：畅销页排除爆品
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "hot")
    );
  }

  // ✅ 畅销识别：字段 or 关键词
  function isBestProduct(p) {
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

  // =========================
  // 分类 pills：优先 subCategory；没有用 category；再没有用 categoryKey
  // =========================
  let cleanedAll = [];
  let bestRaw = [];
  let bestViewAll = [];
  let currentFilter = "all";

  function pickCatLabel(p) {
    const sub = String(p?.subCategory || p?.subcategory || "").trim();
    const cat = String(p?.category || p?.mainCategory || p?.section || "").trim();
    const key = String(p?.categoryKey || p?.category_key || p?.catKey || "").trim();
    return sub || cat || key || "";
  }

  function rebuildCategoryPills() {
    if (!filterBarEl) return;

    const set = new Set();
    bestRaw.forEach((p) => {
      const label = pickCatLabel(p);
      if (label) set.add(label);
    });

    const cats = Array.from(set);
    filterBarEl.innerHTML = "";

    const makeBtn = (label, val, active) => {
      const btn = document.createElement("button");
      btn.type = "button";
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
  // Render：交给 FBCard（卡片/按钮/加购逻辑一致）
  // =========================
  function applyFilterAndRender() {
    let list = [...bestViewAll];

    if (currentFilter && currentFilter !== "all") {
      list = list.filter((p) => pickCatLabel(p) === currentFilter);
    }

    const sortVal = sortSelectEl?.value || "sales_desc";
    if (sortVal === "price_asc" || sortVal === "price_desc") {
      list.sort((a, b) => {
        const pa = getPriceForSort(a);
        const pb = getPriceForSort(b);
        return sortVal === "price_asc" ? pa - pb : pb - pa;
      });
    } else if (sortVal === "sales_desc") {
      list.sort((a, b) => getSales(b) - getSales(a));
    } else if (sortVal === "newest_desc") {
      list.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    }

    if (!list.length) {
      showInline("当前筛选条件下没有畅销商品。", "#6b7280");
      return;
    }

    // ✅ 用 renderer 渲染（按钮字大小/绿色加购等会一致）
    window.FBCard.renderGrid(gridEl, list, { badgeText: "畅销" });
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
    cleanedAll = list.filter((p) => !p?.isDeleted && p?.deleted !== true && p?.status !== "deleted");

    console.log("[Best] raw:", list.length, "cleaned:", cleanedAll.length);

    // 畅销 & 排除爆品
    bestRaw = cleanedAll.filter((p) => isBestProduct(p) && !isHotProduct(p));
    console.log("[Best] after isBest & !hot:", bestRaw.length);

    // ✅ 兜底：没有畅销标签 → 取销量 Top 60（排除爆品）
    if (!bestRaw.length && cleanedAll.length) {
      bestRaw = [...cleanedAll]
        .filter((p) => !isHotProduct(p))
        .sort((a, b) => getSales(b) - getSales(a))
        .slice(0, 60);
      console.warn("[Best] fallback sales top 60:", bestRaw.length);
    }

    if (!bestRaw.length) {
      showInline(
        `没有可显示的商品。<br>
         - 接口返回：${list.length} 条<br>
         - 清洗后：${cleanedAll.length} 条<br>
         - 畅销过滤后：0 条<br>
         说明：要么接口没商品，要么全部被删除/下架。`,
        "#b91c1c"
      );
      return;
    }

    // ✅ expand：把单卖/整箱拆开等（跟首页一致）
    bestViewAll = window.FBCard.expand(bestRaw);
    console.log("[Best] expanded view:", bestViewAll.length);

    currentFilter = "all";
    rebuildCategoryPills();
    applyFilterAndRender();
  }

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // renderer global bindings
    if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // cart drawer（如果 Best.html 没放 cart DOM，这里不会报错）
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
      console.warn("⚠️ FreshCart.initCartUI 不存在：cart.js 没加载成功或报错");
    }

    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    loadBestProducts().catch((e) => {
      console.error("❌ loadBestProducts error:", e);
      showInline("加载畅销失败：请打开控制台看报错（Console）。", "#b91c1c");
    });
  });
})();
