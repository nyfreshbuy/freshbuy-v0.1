// frontend/user/assets/js/newcomer.js
console.log("✅ newcomer.js loaded (HOT ONLY + renderer-driven)");

(() => {
  // -------------------------
  // DOM refs（必须存在）
  // -------------------------
  const gridEl = document.getElementById("newcomerGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.5;">${msg}</div>`;
  }

  // ✅ grid 必须有
  if (!gridEl) {
    console.error("❌ newcomerGrid 不存在：检查 newcomer.html 里 <div id='newcomerGrid'>");
    return;
  }

  // ✅ 必须先有 renderer
  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：newcomer.html 必须先引入 product_card_renderer.js（在 newcomer.js 之前）");
    showInline("❌ 缺少商品卡渲染器 product_card_renderer.js（script 顺序不对或文件不存在）", "#b91c1c");
    return;
  }

  // -------------------------
  // Auth helpers（跟你其它页一致）
  // -------------------------
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

  // -------------------------
  // Helpers
  // -------------------------
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

  function getNum(p, keys, def = 0) {
    for (const k of keys) {
      const v = p?.[k];
      const n = Number(v);
      if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
    }
    return def;
  }
  function getPriceForSort(p) {
    // ✅ renderer 拆卡后可能有 __displayPrice（整箱卡）
    const vPrice = p?.__displayPrice;
    if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }
  function getSalesForSort(p) {
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }

  // -------------------------
  // ✅ Hot Only（爆品）识别
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
  // ✅ 分类 pills（优先 subCategory；没有用 category）
  // -------------------------
  let productsRaw = [];       // 原始（不拆卡）
  let productsViewAll = [];   // expand 后（拆卡）
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
        try { filterBarEl.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch {}
      });
      return btn;
    };

    filterBarEl.appendChild(makeBtn("全部", "all", currentFilter === "all"));
    cats.forEach((c) => filterBarEl.appendChild(makeBtn(c, c, currentFilter === c)));
  }

  // -------------------------
  // ✅ 过滤 + 排序 + 渲染（核心：FBCard.renderGrid）
  // -------------------------
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
    const sortVal = sortSelectEl?.value || "sales_desc";
    if (sortVal === "price_asc" || sortVal === "price_desc") {
      list.sort((a, b) => {
        const pa = getPriceForSort(a);
        const pb = getPriceForSort(b);
        return sortVal === "price_asc" ? pa - pb : pb - pa;
      });
    } else if (sortVal === "sales_desc") {
      const hasAnySales = list.some((p) => getSalesForSort(p) > 0);
      if (hasAnySales) list.sort((a, b) => getSalesForSort(b) - getSalesForSort(a));
    } else {
      // newest_desc（如果你以后加这个 option）
      list.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    }

    if (!list.length) {
      showInline("当前筛选条件下没有爆品商品。", "#6b7280");
      return;
    }

    // ✅ 关键：用首页同款 renderer 渲染
    // badgeText 传空：让 renderer 自己决定 badge（或你想强制“爆品”也行）
    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
  }

  // -------------------------
  // ✅ Load Hot Only products
  // -------------------------
  async function loadHotProducts() {
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

    // ✅ 只保留爆品
    productsRaw = cleaned.filter((p) => isHotProduct(p));

    // ✅ 兜底：如果爆品字段没打，但你希望页面不空，就按销量取前 60（仍然算爆品页兜底）
    if (!productsRaw.length && cleaned.length) {
      console.warn("[Newcomer] hot empty -> fallback top sales 60");
      productsRaw = [...cleaned]
        .sort((a, b) => getSalesForSort(b) - getSalesForSort(a))
        .slice(0, 60);
    }

    if (!productsRaw.length) {
      showInline("没有可显示的爆品商品（后台可能没打 isHot/爆品 标签）。", "#b91c1c");
      return;
    }

    // ✅ 拆卡：单卖/整箱两张（首页同款）
    productsViewAll = window.FBCard.expand(productsRaw);

    currentFilter = "all";
    rebuildCategoryPills();
    applyFilterAndRender();

    console.log("[Newcomer] raw:", list.length, "cleaned:", cleaned.length, "hotRaw:", productsRaw.length, "view:", productsViewAll.length);
  }

  // -------------------------
  // Init
  // -------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // ✅ renderer bindings（加购黑框 +/- / 徽章等）
    if (window.FBCard?.ensureGlobalBindings) window.FBCard.ensureGlobalBindings();
    if (window.FBCard?.startStockPolling) window.FBCard.startStockPolling();

    // ✅ 购物车抽屉 UI（点击右上角购物车必须有反应）
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

    loadHotProducts().catch((e) => {
      console.error("❌ loadHotProducts error:", e);
      showInline("加载失败：请打开控制台查看报错。", "#b91c1c");
    });
  });
})();
