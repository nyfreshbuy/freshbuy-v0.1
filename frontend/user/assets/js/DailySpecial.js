// frontend/user/assets/js/DailySpecial.js
// 家庭必备专区 = 所有“特价商品（Special Deals）”且排除“爆品”
// ✅ 商品卡：复用首页 product_card_renderer.js（renderProductCard）=> 样式/结构与首页一致
// ✅ 保留：API 兜底 + 特价判定 + 排除爆品 + 购物车数量徽章刷新（含 pid 兜底）+ 跨标签页刷新

console.log("✅ DailySpecial.js loaded (Family = Special, use renderer)");

(() => {
  const GRID_ID = "dailyGrid";

  // 你首页正在用的 + 兜底
  const API_CANDIDATES = [
    "/api/products-simple",
    "/api/products/public",
    "/api/products",
  ];

  // 购物车存储 key 兜底
  const CART_KEYS = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];

  function $(id) {
    return document.getElementById(id);
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }

  // =========================
  // ✅ pid 统一（用于徽章/详情页/加购一致）
  // =========================
  function fbPid(p) {
    return String(p?._id || p?.id || p?.sku || p?.code || p?.productId || "").trim();
  }

  // =========================
  // ✅ 购物车数量徽章：读取 + 汇总
  // =========================
  function fbGetCartRaw() {
    for (const k of CART_KEYS) {
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
    // 统一用 .product-qty-badge（首页渲染器也应输出这个）
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
    const grid = $(GRID_ID);
    if (!grid) return;
    const qtyMap = fbBuildQtyMap();
    grid.querySelectorAll(".product-card[data-pid]").forEach((card) => {
      const pid = String(card.getAttribute("data-pid") || "").trim();
      if (pid) fbRenderQtyBadge(card, pid, qtyMap);
    });
  }

  // =========================
  // ✅ 特价判定（与你之前保持一致）
  // =========================
  function isSpecialDeal(p) {
    // 1) 后台开关
    if (
      isTrueFlag(p.isSpecial) ||
      isTrueFlag(p.onSale) ||
      isTrueFlag(p.isSale) ||
      isTrueFlag(p.isDailySpecial)
    ) return true;

    // 2) sale/special/flash < basePrice
    const basePrice = toNum(p.price ?? p.regularPrice ?? p.originPrice ?? 0);
    const salePrice = toNum(p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0);
    if (basePrice > 0 && salePrice > 0 && salePrice < basePrice) return true;

    // 3) 划线价：originPrice > price
    const origin = toNum(p.originPrice ?? p.originalPrice ?? 0);
    const price = toNum(p.price ?? 0);
    if (origin > 0 && price > 0 && origin > price) return true;

    // 4) 折扣字段
    const discount = toNum(p.discount ?? p.discountPercent ?? 0);
    if (discount > 0) return true;

    return false;
  }

  // ❌ 爆品判定：用于从家庭必备中排除
  function isHotProduct(p) {
    if (isTrueFlag(p.isHot) || isTrueFlag(p.isHotDeal) || isTrueFlag(p.hotDeal)) return true;

    const kw = (v) => (v ? String(v).toLowerCase() : "");
    const fields = [p.tag, p.type, p.category, p.section];

    if (fields.some((f) => kw(f).includes("爆品") || kw(f).includes("hot"))) return true;
    if (Array.isArray(p.tags) && p.tags.some((t) => kw(t).includes("爆品") || kw(t).includes("hot")))
      return true;

    return false;
  }

  // =========================
  // ✅ API 返回结构兼容
  // =========================
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
        console.log("📦 fetched from", url, "count:", list.length);
        if (list.length) return list;
      } catch (e) {
        lastErr = e;
        console.warn("⚠️ fetch failed:", e?.message || e);
      }
    }
    throw lastErr || new Error("No product API available");
  }

  // =========================
  // ✅ 核心：用首页渲染器生成卡片（样式一致）
  // =========================
  function createCardViaRenderer(p, qtyMap) {
    const name = String(p.name || p.title || "未命名商品").trim();
    const pid = fbPid(p) || name;

    const renderer = window.renderProductCard;
    if (typeof renderer !== "function") {
      console.warn("❌ renderProductCard 未加载：请确认 DailySpecial.html 先引入 product_card_renderer.js");
      return null;
    }

    // 1) 用统一渲染器生成卡片
    const card = renderer(p, {
      scene: "dailySpecial",
      // 如果你的渲染器支持自定义角标/标签，这里给它提示
      badgeText: "家庭必备",
      forceBadge: true,
    });

    if (!card || card.nodeType !== 1) return null;

    // 2) 强制统一 pid（用于徽章刷新 / 详情跳转一致）
    card.classList.add("product-card");
    card.setAttribute("data-pid", pid);

    // 3) 数量徽章：初次渲染（要求渲染器有 .product-qty-badge）
    fbRenderQtyBadge(card, pid, qtyMap);

    // 4) 兜底：卡片点击进详情（如果渲染器已做，不影响）
    card.addEventListener("click", (ev) => {
      const t = ev.target;
      // 点击按钮/链接/交互元素，不跳转
      if (t && (t.closest("button") || t.closest("a") || t.closest("[data-action]"))) return;
      window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(pid);
    });

    // 5) 兜底：任何点击后稍延迟刷新徽章（兼容渲染器内部加购）
    card.addEventListener(
      "click",
      () => {
        setTimeout(() => fbRefreshAllBadges(), 50);
      },
      true
    );

    return card;
  }

  function renderEmpty(msg) {
    const grid = $(GRID_ID);
    if (!grid) return;
    grid.innerHTML = `
      <div style="padding:12px;font-size:13px;color:#6b7280;background:#fff;border-radius:12px;">
        ${msg}
      </div>
    `;
  }

  async function main() {
    const grid = $(GRID_ID);
    if (!grid) {
      console.warn("❌ 找不到容器 #dailyGrid");
      return;
    }

    try {
      const all = await fetchProducts();
      const specialList = all.filter((p) => isSpecialDeal(p) && !isHotProduct(p));
      console.log("🧮 total:", all.length, "special=>family:", specialList.length);

      grid.innerHTML = "";
      if (!specialList.length) {
        renderEmpty("已获取商品，但没有任何商品满足“特价”判定（请确认后台 salePrice/flashPrice/isSpecial 等字段）。");
        return;
      }

      // ✅ 一次性 qtyMap
      const qtyMap = fbBuildQtyMap();

      // ✅ 渲染：完全复用首页商品卡
      for (const p of specialList) {
        const card = createCardViaRenderer(p, qtyMap);
        if (card) grid.appendChild(card);
      }

      // ✅ 兜底再刷新一次
      fbRefreshAllBadges();
    } catch (e) {
      console.error("❌ DailySpecial load failed:", e);
      renderEmpty("加载失败：无法获取商品列表（请检查 API 是否正常返回）。");
    }
  }

  // ✅ 购物车在其他页面/标签页变化时，刷新徽章
  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (CART_KEYS.includes(e.key)) fbRefreshAllBadges();
  });

  // 你项目里其他地方会派发这个事件
  window.addEventListener("freshbuy:cart_updated", fbRefreshAllBadges);

  window.addEventListener("DOMContentLoaded", main);
})();
