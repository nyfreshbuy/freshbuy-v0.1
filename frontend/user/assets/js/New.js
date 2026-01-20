// frontend/user/assets/js/New.js
console.log("✅ New.js loaded (renderer-driven, debug-safe)");

(() => {
  const gridEl = document.getElementById("newGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.5;">${msg}</div>`;
  }

  // ============ 必要依赖检查 ============
  if (!gridEl) {
    console.error("❌ newGrid 不存在：检查 New.html 里 <div id='newGrid'>");
    return;
  }

  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：New.html 必须先引入 product_card_renderer.js（且在 New.js 之前）");
    showInline("❌ 页面缺少渲染器：请在 New.html 底部先引入 product_card_renderer.js（在 New.js 之前）。", "#b91c1c");
    return;
  }

  // =========================
  // Auth helpers
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

  // ✅ 爆品识别：新品页排除爆品
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeywordSimple(p, "爆品") ||
      hasKeywordSimple(p, "hot")
    );
  }

  // ✅ 新品识别：flag/keyword/30天兜底
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

    const ts = getCreatedAt(p);
    if (ts > 0) {
      const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (days >= 0 && days <= 30) return true;
    }
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
    if (!window.FBCard) return;

    let list = [...productsViewAll];

    if (currentFilter && currentFilter !== "all") {
      list = list.filter((p) => {
        const cat = String(p.category || "").trim();
        const sub = String(p.subCategory || "").trim();
        return cat === currentFilter || sub === currentFilter;
      });
    }

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

    if (!list.length) {
      showInline("当前筛选条件下没有新品（可能是后台没打 isNew / 标签没写 NEW / createdAt 太旧）。", "#6b7280");
      return;
    }

    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
  }

  // =========================
  // Load
  // =========================
  async function loadNewProducts() {
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

    console.log("[New] raw:", list.length, "cleaned:", cleaned.length);

    productsRaw = cleaned.filter((p) => isNewProduct(p) && !isHotProduct(p));
    console.log("[New] after isNew & !hot:", productsRaw.length);

    // ✅ 兜底：没有新品就按时间取前 60
    if (!productsRaw.length && cleaned.length) {
      productsRaw = [...cleaned]
        .filter((p) => !isHotProduct(p))
        .sort((a, b) => getCreatedAt(b) - getCreatedAt(a))
        .slice(0, 60);
      console.warn("[New] fallback latest 60:", productsRaw.length);
    }

    if (!productsRaw.length) {
      showInline(
        `没有可显示的商品。<br>
         - 接口返回：${list.length} 条<br>
         - 清洗后：${cleaned.length} 条<br>
         - 新品过滤后：0 条<br>
         说明：要么接口没商品，要么全部被删除/下架。`,
        "#b91c1c"
      );
      return;
    }

    productsViewAll = window.FBCard.expand(productsRaw);
    console.log("[New] expanded view:", productsViewAll.length);

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

    // cart drawer
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

    loadNewProducts().catch((e) => {
      console.error("❌ loadNewProducts error:", e);
      showInline("加载新品失败：请打开控制台看报错（Console）。", "#b91c1c");
    });
  });
})();
