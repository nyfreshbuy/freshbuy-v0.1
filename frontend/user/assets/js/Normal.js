// frontend/user/assets/js/normal.js
// =======================================================
// 普通配送 / 全部商品（与首页“全部商品”一致：展示【非爆品】商品）
// 数据源：/api/products-simple
// 功能：分类筛选 + 排序 + 加入购物车 + 跳详情
// + ✅ 数量徽章（与 newcomer.js 同一套）
// =======================================================

console.log("normal.js loaded");

let FILTERS = [{ key: "all", name: "全部" }];
let ALL = [];
let normalAll = [];
let activeCat = "all";

// 如果后台 categoryKey 是英文 key，这里映射成中文显示（可按你后台调整）
const CATEGORY_NAME_MAP = {
  fresh: "生鲜果蔬",
  meat: "肉禽海鲜",
  snacks: "零食饮品",
  staples: "粮油主食",
  seasoning: "调味酱料",
  frozen: "冷冻食品",
  household: "日用清洁",
};

/* ========= 通用工具 ========= */
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

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

  // 固定顺序（存在就按这个排，不存在的放后面）
  const preferred = [
    "fresh",
    "meat",
    "snacks",
    "staples",
    "seasoning",
    "frozen",
    "household",
  ];
  keys.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return [{ key: "all", name: "全部" }].concat(
    keys.map((k) => ({ key: k, name: getCategoryLabel(k) }))
  );
}

function matchCat(p, catKey) {
  if (catKey === "all") return true;
  return getCategoryKey(p) === catKey;
}

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

function sortList(list, sortKey) {
  const arr = [...list];
  if (sortKey === "price_asc") arr.sort((a, b) => getPrice(a) - getPrice(b));
  else if (sortKey === "price_desc") arr.sort((a, b) => getPrice(b) - getPrice(a));
  else arr.sort((a, b) => getSales(b) - getSales(a)); // 默认销量高→低
  return arr;
}

/* ========= 与首页一致：爆品判断（用于排除爆品） ========= */
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
  ];
  if (fields.some((f) => norm(f).includes(kw))) return true;

  if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
  if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;

  return false;
}

function isHotProduct(p) {
  return (
    isTrueFlag(p?.isHot) ||
    isTrueFlag(p?.isHotDeal) ||
    isTrueFlag(p?.hotDeal) ||
    isTrueFlag(p?.isSpecial) ||
    hasKeyword(p, "爆品") ||
    hasKeyword(p, "爆品日") ||
    hasKeyword(p, "hot")
  );
}

/* ========= UI ========= */
function showToast() {
  const el = document.getElementById("addCartToast");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 900);
}

/* =========================================================
   ✅ 数量徽章（购物车数量）统一逻辑（与 newcomer.js 同一套）
   ========================================================= */
function fbPid(p) {
  return String(p?._id || p?.id || p?.sku || p?.code || p?.productId || "").trim();
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

  // 情况1：数组 [{id, qty}...]
  if (Array.isArray(raw)) {
    for (const it of raw) {
      const pid = String(it?._id || it?.id || it?.sku || it?.code || it?.productId || "").trim();
      const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
      if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
    }
    return map;
  }

  // 情况2：对象 { items: [...] }
  if (raw && Array.isArray(raw.items)) {
    for (const it of raw.items) {
      const pid = String(it?._id || it?.id || it?.sku || it?.code || it?.productId || "").trim();
      const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
      if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
    }
    return map;
  }

  // 情况3：对象本身就是 { pid: qty }
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
  const grid = document.getElementById("normal-list");
  if (!grid) return;
  const qtyMap = fbBuildQtyMap();
  grid.querySelectorAll(".product-card[data-pid]").forEach((card) => {
    const pid = String(card.getAttribute("data-pid") || "").trim();
    if (pid) fbRenderQtyBadge(card, pid, qtyMap);
  });
}

/* ========= 商品卡片 ========= */
function createCard(p, qtyMap) {
  const article = document.createElement("article");
  article.className = "product-card";

  // ✅ 统一 pid：跨页面一致（并且永不为空：兜底 name）
  const pid = fbPid(p) || String(p?.name || "").trim();
  const safeId = pid || String(p?.name || "fb").trim();
  const useId = pid || safeId;

  article.setAttribute("data-pid", useId);

  const price = getPrice(p);
  const origin = getNum(p, ["originPrice"], 0);
  const hasOrigin = origin > 0 && origin > price;

  const img =
    p?.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(useId || p?.name || "fb")}/500/400`;

  const limitQty = p?.limitQty || p?.limitPerUser || p?.maxQty || p?.purchaseLimit || 0;

  // ✅ 普通商品不强制显示 badge（更像“全部商品”）
  const badge = ""; // 需要的话改成 "普通价"

  article.innerHTML = `
    <div class="product-image-wrap">
      ${badge ? `<span class="special-badge">${badge}</span>` : ""}
      <img src="${img}" class="product-image" alt="${p?.name || ""}" />

      <!-- ✅ 数量徽章（右下角） -->
      <span class="product-qty-badge"></span>
    </div>

    <div class="product-name">${p?.name || ""}</div>
    <div class="product-desc">${p?.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${Number(price || 0).toFixed(2)}</span>
      ${hasOrigin ? `<span class="product-origin">$${Number(origin).toFixed(2)}</span>` : ""}
    </div>

    <button type="button" class="add-btn">
      <span class="add-btn__icon">🛒</span>
      <span class="add-btn__text">加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}</span>
    </button>
  `;

  // ✅ 初次渲染刷新徽章
  fbRenderQtyBadge(article, useId, qtyMap);

  // ✅ 加入购物车
  const btn = article.querySelector(".add-btn");
  if (btn) {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();

      const cartApi =
        (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
        (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
        null;

      if (!cartApi) {
        alert("购物车模块未就绪（请确认 cart.js 已加载且 window.FreshCart 存在）");
        return;
      }

      // ✅ 关键：写入购物车时同时带 id/_id，跨页面数量才一致
      cartApi.addItem(
        {
          id: useId,
          _id: useId,
          sku: p?.sku || "",
          code: p?.code || "",
          productId: p?.productId || "",
          name: p?.name || "商品",
          price: Number(price || 0),
          priceNum: Number(price || 0),
          image: p?.image || img,
          tag: p?.tag || "",
          type: p?.type || "",
          // ✅ 普通商品标识（与首页“全部商品”一致：非爆品）
          isSpecial: false,
          isDeal: false,
          serviceMode: "normal",
        },
        1
      );

      showToast();

      // ✅ 加购后立刻刷新徽章
      fbRefreshAllBadges();

      // ✅ 广播事件（如果别处也监听）
      window.dispatchEvent(new Event("freshbuy:cart_updated"));
    });
  }

  // ✅ 点卡片去详情（没做详情页可注释）
  article.addEventListener("click", () => {
    if (!useId) return;
    window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(useId);
  });

  return article;
}

function renderFilters() {
  const bar = document.getElementById("filterBar");
  if (!bar) {
    console.warn("❌ filterBar not found");
    return;
  }
  bar.innerHTML = "";

  FILTERS.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-pill" + (f.key === activeCat ? " active" : "");
    btn.textContent = f.name;
    btn.dataset.key = f.key;

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
  const grid = document.getElementById("normal-list");
  const sortSel = document.getElementById("sortSelect");

  if (!grid) {
    console.error("❌ normal-list container not found");
    return;
  }

  const sortKey = sortSel ? sortSel.value : "sales_desc";

  let list = normalAll.filter((p) => matchCat(p, activeCat));
  list = sortList(list, sortKey);

  console.log("[normal filter]", activeCat, "matched:", list.length, "sort:", sortKey);

  grid.innerHTML = "";

  if (!list.length) {
    grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">该分类暂无商品</div>`;
    return;
  }

  // ✅ 每次渲染前取一次 qtyMap
  const qtyMap = fbBuildQtyMap();
  list.forEach((p) => grid.appendChild(createCard(p, qtyMap)));

  // ✅ 兜底刷新一次
  fbRefreshAllBadges();

  try {
    grid.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {}
}

/* ========= 数据加载 ========= */
async function loadProducts() {
  const res = await fetch("/api/products-simple", { cache: "no-store" });
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

  // ✅ 与首页一致：全部商品 = 非爆品（nonHotList）
  normalAll = list.filter((p) => !isHotProduct(p));

  // ✅ 用普通商品生成筛选
  FILTERS = buildFiltersFromProducts(normalAll);

  // activeCat 不在筛选里就回到 all
  if (!FILTERS.some((f) => f.key === activeCat)) activeCat = "all";

  renderFilters();
  renderList();

  console.log("[normal] ALL:", ALL.length, "normalAll(non-hot):", normalAll.length);
}

/* ========= 按钮样式注入（一次） ========= */
function injectButtonStylesOnce() {
  if (document.getElementById("normalBtnStyle")) return;
  const style = document.createElement("style");
  style.id = "normalBtnStyle";
  style.textContent = `
    .add-btn{
      width:100%;
      margin-top:10px;
      padding:10px 12px;
      border:none;
      border-radius:14px;
      background: linear-gradient(135deg,#22c55e,#16a34a);
      color:#fff;
      font-weight:900;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      box-shadow: 0 10px 18px rgba(22,163,74,.18);
      transition: transform .08s ease, filter .12s ease;
    }
    .add-btn:active{ transform: scale(.98); }
    .add-btn:hover{ filter: brightness(.98); }
    .add-btn__icon{ font-size:14px; }
    .add-btn__text{ font-size:14px; letter-spacing:.02em; }
  `;
  document.head.appendChild(style);
}

/* ✅ 购物车在别的标签页/页面变化，也同步刷新 */
window.addEventListener("storage", (e) => {
  if (!e) return;
  const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
  if (keys.includes(e.key)) fbRefreshAllBadges();
});

/* ✅ 如果 cart.js 未来派发这个事件，这里也会自动刷新 */
window.addEventListener("freshbuy:cart_updated", fbRefreshAllBadges);

/* ========= 启动 ========= */
window.addEventListener("DOMContentLoaded", () => {
  injectButtonStylesOnce();

  const sortSel = document.getElementById("sortSelect");
  if (sortSel) sortSel.addEventListener("change", renderList);

  loadProducts().catch((err) => {
    console.error("加载普通商品失败", err);
    const grid = document.getElementById("normal-list");
    if (grid)
      grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#b91c1c;">加载失败，请稍后重试</div>`;
  });
});
