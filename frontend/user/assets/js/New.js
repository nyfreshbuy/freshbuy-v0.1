// frontend/user/assets/js/New.js
// 新品上市专区：筛选 + 排序 + 加入购物车 + 跳详情
// ✅ 已加入：商品卡片数量徽章（购物车数量）统一逻辑

console.log("✅ New.js loaded (with qty badge)");

(() => {
  // =========================
  // 容器/控件 ID（你的 New.html 里大概率就是这些）
  // 如果你实际用了别的 id，本文件也做了 fallback
  // =========================
  const GRID_IDS = ["newGrid", "new-list", "productGrid", "newcomerGrid"];
  const FILTER_BAR_IDS = ["filterBar", "newFilterBar"];
  const SORT_IDS = ["sortSelect", "newSortSelect"];

  const API_CANDIDATES = ["/api/products-simple", "/api/products/public", "/api/products"];

  const CATEGORY_NAME_MAP = {
    fresh: "生鲜果蔬",
    meat: "肉禽海鲜",
    snacks: "零食饮品",
    staples: "粮油主食",
    seasoning: "调味酱料",
    frozen: "冷冻食品",
    household: "日用清洁",
  };

  let FILTERS = [{ key: "all", name: "全部" }];
  let ALL = [];
  let NEW_ALL = [];
  let activeCat = "all";

  function $byIds(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // =========================
  // ✅ 数量徽章：统一主键 + 读取购物车 + 显示徽章
  // =========================
  function fbPid(p) {
    return String(p?._id || p?.id || p?.sku || p?.productId || p?.code || "").trim();
  }

  function fbGetCartRaw() {
    const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
    for (const k of keys) {
      const s = localStorage.getItem(k);
      if (s && String(s).trim()) {
        try {
          return JSON.parse(s);
        } catch (e) {}
      }
    }
    return null;
  }

  function fbBuildQtyMap() {
    const raw = fbGetCartRaw();
    const map = Object.create(null);
    if (!raw) return map;

    // 情况1：数组
    if (Array.isArray(raw)) {
      for (const it of raw) {
        const pid = String(it?._id || it?.id || it?.sku || it?.productId || it?.code || "").trim();
        const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
        if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
      }
      return map;
    }

    // 情况2：对象 { items: [...] }
    if (raw && Array.isArray(raw.items)) {
      for (const it of raw.items) {
        const pid = String(it?._id || it?.id || it?.sku || it?.productId || it?.code || "").trim();
        const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
        if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
      }
      return map;
    }

    // 情况3：对象本身 { pid: qty }
    for (const [k, v] of Object.entries(raw)) {
      const qty = Number(v) || 0;
      if (k && qty > 0) map[k] = qty;
    }
    return map;
  }

  function fbRenderQtyBadge(cardEl, pid, qtyMap) {
    const badge = cardEl.querySelector(".product-qty-badge");
    if (!badge) return;

    const q = Number(qtyMap[pid] || 0) || 0;
    if (q > 0) {
      badge.textContent = String(q);
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  function fbRefreshAllBadges() {
    const grid = $byIds(GRID_IDS);
    if (!grid) return;

    const qtyMap = fbBuildQtyMap();
    grid.querySelectorAll(".product-card[data-pid]").forEach((card) => {
      const pid = String(card.getAttribute("data-pid") || "").trim();
      if (pid) fbRenderQtyBadge(card, pid, qtyMap);
    });
  }

  // =========================
  // 分类筛选
  // =========================
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

  function matchCat(p, catKey) {
    if (catKey === "all") return true;
    return getCategoryKey(p) === catKey;
  }

  // =========================
  // ✅ 新品判定（你截图标题说明：tag 含 NEW/新品上市/新上架 或 isNew）
  // =========================
  function hasKeyword(p, keyword) {
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
    ];
    if (fields.some((f) => norm(f).includes(kw))) return true;

    if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
    if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;

    return false;
  }

  function isNewProduct(p) {
    return (
      isTrueFlag(p?.isNew) ||
      isTrueFlag(p?.new) ||
      isTrueFlag(p?.isNewArrival) ||
      hasKeyword(p, "new") ||
      hasKeyword(p, "新品") ||
      hasKeyword(p, "新品上市") ||
      hasKeyword(p, "新上架")
    );
  }

  // =========================
  // 排序：最新上架/销量/价格
  // =========================
  function getNum(p, keys, def = 0) {
    for (const k of keys) {
      const v = p?.[k];
      const n = Number(v);
      if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
    }
    return def;
  }

  function getPrice(p) {
    return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
  }

  function getSales(p) {
    return getNum(p, ["sales", "sold", "saleCount", "salesCount", "orderCount"], 0);
  }

  function getCreatedAt(p) {
    // 兼容常见字段：createdAt/created_at/updatedAt
    const t =
      p?.createdAt ||
      p?.created_at ||
      p?.createdTime ||
      p?.updatedAt ||
      p?.updated_at ||
      p?.time ||
      0;
    const d = new Date(t);
    const ms = d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
    return ms;
  }

  function sortList(list, sortKey) {
    const arr = [...list];
    if (sortKey === "price_asc") arr.sort((a, b) => getPrice(a) - getPrice(b));
    else if (sortKey === "price_desc") arr.sort((a, b) => getPrice(b) - getPrice(a));
    else if (sortKey === "newest") arr.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
    else arr.sort((a, b) => getSales(b) - getSales(a));
    return arr;
  }

  function showToast() {
    const el = document.getElementById("addCartToast");
    if (!el) return;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 900);
  }

  // =========================
  // 卡片渲染（✅ 插入 product-qty-badge）
  // =========================
  function createCard(p, qtyMap) {
    const pid = fbPid(p);
    const safeId = pid || String(p?.name || "fb").trim();

    const name = String(p?.name || p?.title || "未命名商品");
    const price = getPrice(p);
    const origin = getNum(p, ["originPrice"], 0);
    const hasOrigin = origin > 0 && origin > price;

    const img =
      p?.image && String(p.image).trim()
        ? String(p.image).trim()
        : `https://picsum.photos/seed/${encodeURIComponent(safeId)}/600/450`;

    const limitQty = p?.limitQty || p?.limitPerUser || p?.maxQty || p?.purchaseLimit || 0;

    const card = document.createElement("article");
    card.className = "product-card";
    card.setAttribute("data-pid", pid || safeId);

    card.innerHTML = `
      <div class="product-image-wrap">
        <span class="special-badge">NEW</span>
        <img src="${img}" class="product-image" alt="${name}" loading="lazy" />

        <!-- ✅ 数量徽章（右下角） -->
        <span class="product-qty-badge"></span>

        <div class="product-overlay">
          <div class="overlay-btn-row">
            <button type="button" class="overlay-btn add">加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}</button>
          </div>
        </div>
      </div>

      <div class="product-name">${name}</div>
      <div class="product-desc">${String(p?.desc || "")}</div>

      <div class="product-price-row">
        <span class="product-price">$${Number(price || 0).toFixed(2)}</span>
        ${hasOrigin ? `<span class="product-origin">$${Number(origin).toFixed(2)}</span>` : ""}
      </div>
    `;

    // ✅ 初次渲染徽章
    fbRenderQtyBadge(card, pid || safeId, qtyMap);

    // ✅ 点卡片去详情
    card.addEventListener("click", () => {
      const id = pid || safeId;
      if (!id) return;
      window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(id);
    });

    // ✅ 加入购物车
    const addBtn = card.querySelector(".overlay-btn.add");
    if (addBtn) {
      addBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();

        const cartApi =
          (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
          (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
          null;

        if (!cartApi) {
          alert("购物车模块未就绪（请确认 cart.js 已加载且 window.FreshCart 存在）");
          return;
        }

        const id = pid || safeId;

        cartApi.addItem(
          {
            id,
            _id: id, // ✅ 多放一份，兼容别的页面按 _id 查
            sku: p?.sku || "",
            name,
            price: Number(price || 0),
            priceNum: Number(price || 0),
            image: p?.image || img,
            tag: p?.tag || "",
            type: p?.type || "",
            isNew: true,
          },
          1
        );

        // ✅ 立刻刷新徽章
        fbRefreshAllBadges();
        showToast();
      });
    }

    return card;
  }

  function renderFilters() {
    const bar = $byIds(FILTER_BAR_IDS);
    if (!bar) return;

    bar.innerHTML = "";
    FILTERS.forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-pill" + (f.key === activeCat ? " active" : "");
      btn.textContent = f.name;

      btn.addEventListener("click", () => {
        activeCat = f.key;
        bar.querySelectorAll(".filter-pill").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        renderList();
      });

      bar.appendChild(btn);
    });
  }

  function renderList() {
    const grid = $byIds(GRID_IDS);
    if (!grid) {
      console.error("❌ 找不到新品 grid 容器（尝试 id：", GRID_IDS.join(", "), "）");
      return;
    }

    const sortSel = $byIds(SORT_IDS);
    const sortKey = sortSel ? sortSel.value : "newest";

    let list = NEW_ALL.filter((p) => matchCat(p, activeCat));
    list = sortList(list, sortKey);

    grid.innerHTML = "";

    if (!list.length) {
      grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">该分类暂无新品</div>`;
      return;
    }

    const qtyMap = fbBuildQtyMap();
    list.forEach((p) => grid.appendChild(createCard(p, qtyMap)));

    // ✅ 渲染完再兜底刷一次
    fbRefreshAllBadges();
  }

  function normalizeList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.list)) return data.list;
    if (Array.isArray(data?.products)) return data.products;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  async function fetchProducts() {
    let lastErr = null;
    for (const url of API_CANDIDATES) {
      try {
        const res = await fetch(url + "?v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
        const json = await res.json().catch(() => ({}));
        const list = normalizeList(json);
        if (list.length) return list;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("No product API available");
  }

  async function main() {
    const grid = $byIds(GRID_IDS);
    if (!grid) return;

    try {
      ALL = await fetchProducts();
      NEW_ALL = ALL.filter(isNewProduct);

      FILTERS = buildFiltersFromProducts(NEW_ALL);
      if (!FILTERS.some((f) => f.key === activeCat)) activeCat = "all";

      renderFilters();
      renderList();

      // ✅ 排序切换
      const sortSel = $byIds(SORT_IDS);
      if (sortSel) sortSel.addEventListener("change", renderList);

      console.log("[New] ALL:", ALL.length, "NEW_ALL:", NEW_ALL.length);
    } catch (e) {
      console.error("❌ New load failed:", e);
      if (grid) {
        grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#b91c1c;">加载失败，请检查商品 API 是否正常</div>`;
      }
    }
  }

  // ✅ 购物车在其他页面/标签页变化时，也刷新徽章
  window.addEventListener("storage", (e) => {
    if (!e) return;
    const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
    if (keys.includes(e.key)) fbRefreshAllBadges();
  });

  // ✅ 如果你的 cart.js 有派发事件，这里也监听（你 DailySpecial 里也用了）
  window.addEventListener("freshbuy:cart_updated", fbRefreshAllBadges);

  window.addEventListener("DOMContentLoaded", main);
})();
