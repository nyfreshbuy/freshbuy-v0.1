// frontend/user/assets/js/New.js
console.log("✅ New.js loaded (renderer-driven + field-fallback + cart-ready)");

(() => {
  // =========================
  // DOM
  // =========================
  const gridEl = document.getElementById("newGrid");
  const filterBarEl = document.getElementById("filterBar");
  const sortSelectEl = document.getElementById("sortSelect");

  function showInline(msg, color = "#6b7280") {
    if (!gridEl) return;
    gridEl.innerHTML = `<div style="padding:12px;font-size:13px;color:${color};line-height:1.55;">${msg}</div>`;
  }

  if (!gridEl) {
    console.error("❌ newGrid 不存在：检查 New.html 里 <div id='newGrid'>");
    return;
  }

  // ✅ 你的 renderer 可能不是 FBCard 版，但你现在要“只改 New.js”
  // 所以：如果没有 FBCard，就直接提示（不再硬渲染）
  if (!window.FBCard) {
    console.error("❌ window.FBCard 不存在：你当前 product_card_renderer.js 不是 FBCard 版本");
    showInline(
      "❌ 当前页面缺少 FBCard 渲染器（product_card_renderer.js 版本不匹配）。<br>请先确保 renderer 提供 window.FBCard（包含 extractList / expand / renderGrid）。",
      "#b91c1c"
    );
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
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";

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
  // Basic helpers
  // =========================
  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }
  function s(v) {
    return v == null ? "" : String(v);
  }
  function norm(v) {
    return s(v).toLowerCase();
  }

  // ✅ 更强的 keyword 检测：字段 + tags/labels
  function hasKeyword(p, keyword) {
    if (!p) return false;
    const kw = norm(keyword);

    const fields = [
      p.tag,
      p.type,
      p.category,
      p.subCategory,
      p.subcategory,
      p.mainCategory,
      p.section,
      p.name,
      p.title,
      p.desc,
      p.description,
    ];

    if (fields.some((f) => norm(f).includes(kw))) return true;

    if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
    if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;

    return false;
  }

  // ✅ createdAt 兜底
  function getCreatedAt(p) {
    const t =
      p?.createdAt ||
      p?.created_at ||
      p?.updatedAt ||
      p?.updated_at ||
      p?.publishAt ||
      p?.publish_at ||
      p?.ctime ||
      p?.mtime ||
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
    // ✅ 拆卡后会带 __displayPrice（整箱/单卖）
    const vPrice = p?.__displayPrice;
    if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }

  function getSalesForSort(p) {
    return getNum(
      p,
      ["sales", "sold", "soldCount", "monthlySales", "salesCount", "orderCount", "saleCount"],
      0
    );
  }

  // =========================
  // Product tags
  // =========================
  function isHotProduct(p) {
    return (
      isTrueFlag(p?.isHot) ||
      isTrueFlag(p?.isHotDeal) ||
      isTrueFlag(p?.hotDeal) ||
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "hot")
    );
  }

  // ✅ 新品识别：flag/keyword/30天兜底（如果 createdAt 没有，就只靠 flag/keyword）
  function isNewProduct(p) {
    const flag =
      isTrueFlag(p?.isNew) ||
      isTrueFlag(p?.isNewArrival) ||
      isTrueFlag(p?.newArrival) ||
      isTrueFlag(p?.new) ||
      hasKeyword(p, "新品") ||
      hasKeyword(p, "新上架") ||
      hasKeyword(p, "new");

    if (flag) return true;

    const ts = getCreatedAt(p);
    if (ts > 0) {
      const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (days >= 0 && days <= 30) return true;
    }
    return false;
  }

  // =========================
  // Category pills (field fallback)
  // =========================
  let productsRaw = []; // 不拆卡
  let productsViewAll = []; // 拆卡后（单卖/整箱）
  let currentFilter = "all";

  function getCatValue(p) {
    // ✅ 你说“没有这个字段”，所以这里一次性兜底所有可能
    // 优先 subCategory 其次 category 其次 mainCategory/section/tag/type
    return (
      s(p?.subCategory).trim() ||
      s(p?.subcategory).trim() ||
      s(p?.category).trim() ||
      s(p?.mainCategory).trim() ||
      s(p?.section).trim() ||
      s(p?.tag).trim() ||
      s(p?.type).trim()
    );
  }

  function rebuildCategoryPills() {
    if (!filterBarEl) return;

    const set = new Set();
    productsRaw.forEach((p) => {
      const c = getCatValue(p);
      if (c) set.add(c);
    });

    const cats = Array.from(set).filter(Boolean);
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
  // Render
  // =========================
  function applyFilterAndRender() {
    let list = [...productsViewAll];

    if (currentFilter && currentFilter !== "all") {
      list = list.filter((p) => getCatValue(p) === currentFilter);
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
      // ✅ 如果 createdAt 全是 0，这个排序不会乱报错
      list.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    }

    if (!list.length) {
      showInline("当前筛选条件下没有新品。", "#6b7280");
      return;
    }

    // ✅ 渲染（跟分类页一致）
    gridEl.innerHTML = "";
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
    const cleaned = list.filter((p) => !p?.isDeleted && p?.deleted !== true && p?.status !== "deleted");

    console.log("[New] raw:", list.length, "cleaned:", cleaned.length);

    // ✅ 新品过滤
    productsRaw = cleaned.filter((p) => isNewProduct(p) && !isHotProduct(p));
    console.log("[New] after isNew & !hot:", productsRaw.length);

    // ✅ 兜底：如果没打新品标签/字段，就取“最新 60”
    // - 有 createdAt：按时间取
    // - 没 createdAt：就按销量取（至少不空）
    if (!productsRaw.length && cleaned.length) {
      const hasAnyTime = cleaned.some((p) => getCreatedAt(p) > 0);
      productsRaw = [...cleaned]
        .filter((p) => !isHotProduct(p))
        .sort((a, b) => {
          if (hasAnyTime) return getCreatedAt(b) - getCreatedAt(a);
          return getSalesForSort(b) - getSalesForSort(a);
        })
        .slice(0, 60);

      console.warn("[New] fallback latest/most-sold 60:", productsRaw.length);
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

    // ✅ 拆卡（单卖/整箱）
    productsViewAll = window.FBCard.expand(productsRaw) || [];
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
    if (typeof window.FBCard.ensureGlobalBindings === "function") window.FBCard.ensureGlobalBindings();
    if (typeof window.FBCard.startStockPolling === "function") window.FBCard.startStockPolling();

    // cart drawer（你 New.html 里现在没有抽屉 DOM，这里不强依赖）
    if (typeof window.FreshCart?.initCartUI === "function") {
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
    }

    if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

    loadNewProducts().catch((e) => {
      console.error("❌ loadNewProducts error:", e);
      showInline("加载新品失败：请打开控制台看报错（Console）。", "#b91c1c");
    });
  });
})();
