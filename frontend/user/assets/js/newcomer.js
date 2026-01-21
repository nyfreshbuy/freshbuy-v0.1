// frontend/user/assets/js/newcomer.js
console.log("✅ newcomer.js loaded (renderer-driven + sticky category pills + HOT ONLY)");

(() => {
  // =========================
  // Auth helpers（跟 category.js / DailySpecial.js 一致）
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
  // DOM refs
  // =========================
  const gridEl = document.getElementById("newcomerGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");
  const searchInputEl = document.getElementById("searchInput"); // 页面没有也没事
  const globalSearchInput = document.getElementById("globalSearchInput"); // 页面没有也没事

  // ✅ empty tip 兜底（页面没有 #emptyTip 也不报错）
  let emptyTipEl = document.getElementById("emptyTip");
  function ensureEmptyTip() {
    if (emptyTipEl) return emptyTipEl;
    if (!gridEl) return null;

    const div = document.createElement("div");
    div.id = "emptyTip";
    div.style.display = "none";
    div.style.padding = "12px";
    div.style.fontSize = "13px";
    div.style.color = "#6b7280";
    div.textContent = "暂无商品";
    gridEl.parentElement?.insertBefore(div, gridEl);
    emptyTipEl = div;
    return emptyTipEl;
  }

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.6;">${msg}</div>`;
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

  // =========================
  // State
  // =========================
  let productsRaw = [];       // 原始商品（不拆卡）
  let productsViewAll = [];   // 拆卡后的全量视图（单卖/整箱两张）
  let currentFilter = "all";  // pills 选中值

  // =========================
  // Helpers
  // =========================
  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }

  function hasKeywordSimple(p, keyword) {
    if (!p) return false;
    const kw = String(keyword).toLowerCase();
    const norm = (v) => (v ? String(v).toLowerCase() : "");
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
    // ✅ 拆卡视图：整箱卡优先 __displayPrice
    const vPrice = p?.__displayPrice;
    if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }

  function getSalesForSort(p) {
    return getNum(p, ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount"], 0);
  }

  // =========================
  // ✅ 爆品识别（Newcomer = 只显示爆品）
  // =========================
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      isTrueFlag(p?.hot) ||
      hasKeywordSimple(p, "爆品") ||
      hasKeywordSimple(p, "爆品日") ||
      hasKeywordSimple(p, "hot") ||
      hasKeywordSimple(p, "hotdeal")
    );
  }

  // =========================
  // 分类 pills（优先 subCategory；没有就用 category）
  // =========================
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

    // ✅ 更稳定的排序（中文/英文自然排序）
    const cats = Array.from(set).sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));

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

        try {
          filterBarEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } catch {}
      });

      return btn;
    };

    filterBarEl.appendChild(makeBtn("全部", "all", currentFilter === "all"));
    cats.forEach((c) => filterBarEl.appendChild(makeBtn(c, c, currentFilter === c)));
  }

  // =========================
  // 过滤 / 排序 / 渲染
  // =========================
  function applyFilterAndRender() {
    if (!gridEl || !window.FBCard) return;

    ensureEmptyTip();

    let list = [...productsViewAll];

    // 搜索（可选：页面有输入框才生效）
    const kw =
      (searchInputEl && searchInputEl.value.trim()) ||
      (globalSearchInput && globalSearchInput.value.trim()) ||
      "";

    if (kw) {
      const lower = kw.toLowerCase();
      list = list.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(lower) ||
          (p.__displayName || "").toLowerCase().includes(lower) ||
          (p.desc || "").toLowerCase().includes(lower)
      );
    }

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
    } else if (sortVal === "newest_desc") {
      list.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    }

    // 渲染
    if (!list.length) {
      gridEl.innerHTML = "";
      if (emptyTipEl) {
        emptyTipEl.style.display = "block";
        emptyTipEl.textContent = "当前筛选条件下没有爆品商品。";
      }
      return;
    }

    if (emptyTipEl) emptyTipEl.style.display = "none";

    // ✅ 用首页同款 renderer 渲染
    window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
  }

  // =========================
  // Load（只拿数据 -> 爆品过滤 -> expand -> pills -> render）
  // =========================
  async function loadHotProducts() {
    ensureEmptyTip();
    gridEl.innerHTML = "";
    if (emptyTipEl) emptyTipEl.style.display = "none";

    try {
      const { res, data } = await apiFetch(`/api/products-simple?ts=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) throw new Error(data?.message || data?.msg || "加载失败");

      const list = window.FBCard.extractList(data) || [];
      const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

      // ✅ 只保留爆品
      productsRaw = cleaned.filter((p) => isHotProduct(p));

      // ✅ 兜底：爆品为空就按销量 top 60（避免空页）
      if (!productsRaw.length && cleaned.length) {
        console.warn("[Newcomer] hot empty -> fallback top sales 60");
        productsRaw = [...cleaned]
          .sort((a, b) => getSalesForSort(b) - getSalesForSort(a))
          .slice(0, 60);
      }

      if (!productsRaw.length) {
        if (emptyTipEl) {
          emptyTipEl.style.display = "block";
          emptyTipEl.textContent = "没有可显示的爆品商品（后台可能没打 isHot/爆品 标签）。";
        }
        return;
      }

      // ✅ 拆卡：单卖/整箱两张（首页同款）
      productsViewAll = window.FBCard.expand(productsRaw);

      currentFilter = "all";
      rebuildCategoryPills();
      applyFilterAndRender();

      console.log("[Newcomer] list:", list.length, "cleaned:", cleaned.length, "hotRaw:", productsRaw.length, "view:", productsViewAll.length);
    } catch (err) {
      console.error("加载 Newcomer 爆品失败:", err);
      if (emptyTipEl) {
        emptyTipEl.style.display = "block";
        emptyTipEl.textContent = "加载商品失败（请检查商品接口是否为 DB 版）。";
      }
    }
  }

  // =========================
  // Init（绑定事件 + 购物车抽屉 + 库存轮询）
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // 1) FBCard 全局绑定（加购/黑框+/-/徽章）
    if (window.FBCard && typeof window.FBCard.ensureGlobalBindings === "function") {
      window.FBCard.ensureGlobalBindings();
    } else {
      console.warn("❌ FBCard.ensureGlobalBindings 不存在：检查 product_card_renderer.js 是否引入/顺序是否正确");
    }

    // 2) 库存轮询（跟首页/分类页一致）
    if (window.FBCard && typeof window.FBCard.startStockPolling === "function") {
      window.FBCard.startStockPolling();
    }

    // 3) 购物车抽屉 UI（需要 newcomer.html 有对应 DOM：cartBackdrop/cartDrawer/...）
    if (window.FreshCart && window.FreshCart.initCartUI) {
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
      console.warn("❌ FreshCart.initCartUI 不存在：请确认 cart.js 已引入且顺序正确");
    }

    // 4) 加载商品
    loadHotProducts();

    // 5) 控件监听
    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    if (searchInputEl) {
      searchInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") applyFilterAndRender();
      });
    }
    if (globalSearchInput) {
      globalSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") applyFilterAndRender();
      });
    }
  });
})();
