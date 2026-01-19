// frontend/user/assets/js/DailySpecial.js
// 最终稳定版：家庭必备专区（特价=家庭必备，排除爆品）
// ✅ 商品卡：复用首页 product_card_renderer.js（自动识别导出函数名）
// ✅ 兼容：API 兜底 + 特价判定 + 排除爆品
// ✅ 购物车数量徽章：自动创建 .product-qty-badge（渲染器没给也能显示）
// ✅ 修复：点击右上角购物车没反应（绑定 #cartIcon 打开购物车抽屉/跳转）
// ✅ 保留：跨标签页 storage 刷新 + freshbuy:cart_updated 刷新

console.log("✅ DailySpecial.js loaded (FINAL STABLE)");

(() => {
  const GRID_ID = "dailyGrid";
  const CART_ICON_ID = "cartIcon";
  const CART_COUNT_ID = "cartCount";

  // 你首页正在用的 + 兜底
  const API_CANDIDATES = ["/api/products-simple", "/api/products/public", "/api/products"];

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
  // ✅ pid 统一
  // =========================
  function fbPid(p) {
    return String(p?._id || p?.id || p?.sku || p?.code || p?.productId || "").trim();
  }

  // =========================
  // ✅ 购物车读取 + 数量汇总
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

    // 情况1：数组
    if (Array.isArray(raw)) {
      for (const it of raw) {
        const pid = String(it?._id || it?.id || it?.sku || it?.code || it?.productId || "").trim();
        const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
        if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
      }
      return map;
    }

    // 情况2：{ items: [...] }
    if (raw && Array.isArray(raw.items)) {
      for (const it of raw.items) {
        const pid = String(it?._id || it?.id || it?.sku || it?.code || it?.productId || "").trim();
        const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
        if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
      }
      return map;
    }

    // 情况3：{ pid: qty }
    for (const [k, v] of Object.entries(raw)) {
      const qty = Number(v) || 0;
      if (k && qty > 0) map[k] = qty;
    }
    return map;
  }

  function fbTotalQty(qtyMap) {
    let sum = 0;
    for (const v of Object.values(qtyMap)) sum += Number(v || 0) || 0;
    return sum;
  }

  // =========================
  // ✅ 顶部购物车角标更新
  // =========================
  function fbRefreshTopCartBadge() {
    const el = $(CART_COUNT_ID);
    if (!el) return;
    const qtyMap = fbBuildQtyMap();
    const total = fbTotalQty(qtyMap);
    if (total > 0) {
      el.textContent = String(total);
      el.style.display = "inline-block";
    } else {
      el.style.display = "none";
    }
  }

  // =========================
  // ✅ 数量徽章：自动创建 + 刷新
  // =========================
  function fbEnsureQtyBadge(cardEl) {
    let badge = cardEl.querySelector(".product-qty-badge");
    if (badge) return badge;

    // 尝试放到常见图片容器里（不同渲染器结构都尽量兼容）
    const host =
      cardEl.querySelector(".product-image-wrap") ||
      cardEl.querySelector(".product-media") ||
      cardEl.querySelector(".product-thumb") ||
      cardEl.querySelector(".media") ||
      cardEl;

    badge = document.createElement("span");
    badge.className = "product-qty-badge";
    badge.style.display = "none";
    host.appendChild(badge);
    return badge;
  }

  function fbRenderQtyBadge(cardEl, pid, qtyMap) {
    const badge = fbEnsureQtyBadge(cardEl);
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

    // 商品卡右下角 badge
    grid.querySelectorAll(".product-card[data-pid]").forEach((card) => {
      const pid = String(card.getAttribute("data-pid") || "").trim();
      if (pid) fbRenderQtyBadge(card, pid, qtyMap);
    });

    // 顶部购物车红点
    fbRefreshTopCartBadge();
  }

  // =========================
  // ✅ 特价判定 + 排除爆品
  // =========================
  function isSpecialDeal(p) {
    if (
      isTrueFlag(p.isSpecial) ||
      isTrueFlag(p.onSale) ||
      isTrueFlag(p.isSale) ||
      isTrueFlag(p.isDailySpecial)
    ) return true;

    const basePrice = toNum(p.price ?? p.regularPrice ?? p.originPrice ?? 0);
    const salePrice = toNum(p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0);
    if (basePrice > 0 && salePrice > 0 && salePrice < basePrice) return true;

    const origin = toNum(p.originPrice ?? p.originalPrice ?? 0);
    const price = toNum(p.price ?? 0);
    if (origin > 0 && price > 0 && origin > price) return true;

    const discount = toNum(p.discount ?? p.discountPercent ?? 0);
    if (discount > 0) return true;

    return false;
  }

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
  // ✅ API 结构兼容 + 拉取
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
  // ✅ 渲染器自动识别（不再死依赖 renderProductCard）
  // =========================
  function resolveRendererFn() {
    // 1) 你预期的名字
    if (typeof window.renderProductCard === "function") return window.renderProductCard;

    // 2) 常见对象导出：ProductCardRenderer.render
    if (window.ProductCardRenderer && typeof window.ProductCardRenderer.render === "function") {
      return window.ProductCardRenderer.render.bind(window.ProductCardRenderer);
    }

    // 3) 兼容别名
    if (typeof window.renderCard === "function") return window.renderCard;
    if (typeof window.renderProduct === "function") return window.renderProduct;

    return null;
  }

  // =========================
  // ✅ 生成卡片（复用首页结构）
  // =========================
  function createCardViaRenderer(p, qtyMap) {
    const name = String(p.name || p.title || "未命名商品").trim();
    const pid = fbPid(p) || name;

    const renderer = resolveRendererFn();
    if (typeof renderer !== "function") {
      console.warn("❌ 商品卡渲染器未找到：请确认已引入 /user/assets/js/product_card_renderer.js");
      return null;
    }

    const card = renderer(p, {
      scene: "dailySpecial",
      badgeText: "家庭必备",
      forceBadge: true,
    });

    if (!card || card.nodeType !== 1) return null;

    // 强制统一标识
    card.classList.add("product-card");
    card.setAttribute("data-pid", pid);

    // 初次徽章
    fbRenderQtyBadge(card, pid, qtyMap);

    // 兜底：点击进详情（点按钮/链接不跳转）
    card.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && (t.closest("button") || t.closest("a") || t.closest("[data-action]"))) return;
      window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(pid);
    });

    // 兜底：任何点击后刷新徽章（兼容渲染器内部加购）
    card.addEventListener(
      "click",
      () => {
        setTimeout(() => fbRefreshAllBadges(), 60);
        window.dispatchEvent(new Event("freshbuy:cart_updated"));
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

  // =========================
  // ✅ 修复：点击右上角购物车没反应
  // =========================
  function bindCartIcon() {
    const icon = $(CART_ICON_ID);
    if (!icon) return;

    icon.addEventListener("click", () => {
      // 1) 优先：FreshCart.openDrawer / toggleDrawer
      if (window.FreshCart) {
        if (typeof window.FreshCart.openDrawer === "function") return window.FreshCart.openDrawer();
        if (typeof window.FreshCart.toggleDrawer === "function") return window.FreshCart.toggleDrawer();
        if (typeof window.FreshCart.open === "function") return window.FreshCart.open();
      }

      // 2) 兼容：Cart.openDrawer / toggleDrawer
      if (window.Cart) {
        if (typeof window.Cart.openDrawer === "function") return window.Cart.openDrawer();
        if (typeof window.Cart.toggleDrawer === "function") return window.Cart.toggleDrawer();
        if (typeof window.Cart.open === "function") return window.Cart.open();
      }

      // 3) 兜底：尝试触发你 cart.js 监听的事件
      window.dispatchEvent(new Event("freshbuy:cart_open"));
      window.dispatchEvent(new Event("cart:open"));

      // 4) 最后兜底：跳转到结算页（如果你有）
      // 不强制跳转，给用户提示
      console.warn("⚠️ 未找到购物车打开方法：请确认 cart.js 是否提供 openDrawer/toggleDrawer");
    });
  }

  async function main() {
    const grid = $(GRID_ID);
    if (!grid) {
      console.warn("❌ 找不到容器 #dailyGrid");
      return;
    }

    bindCartIcon();

    try {
      const all = await fetchProducts();
      const specialList = all.filter((p) => isSpecialDeal(p) && !isHotProduct(p));
      console.log("🧮 total:", all.length, "special=>family:", specialList.length);

      grid.innerHTML = "";
      if (!specialList.length) {
        renderEmpty("已获取商品，但没有任何商品满足“特价”判定（请确认后台 salePrice/flashPrice/isSpecial 等字段）。");
        fbRefreshAllBadges();
        return;
      }

      const qtyMap = fbBuildQtyMap();

      for (const p of specialList) {
        const card = createCardViaRenderer(p, qtyMap);
        if (card) grid.appendChild(card);
      }

      fbRefreshAllBadges();
    } catch (e) {
      console.error("❌ DailySpecial load failed:", e);
      renderEmpty("加载失败：无法获取商品列表（请检查 API 是否正常返回）。");
      fbRefreshAllBadges();
    }
  }

  // 购物车在其他页面/标签页变化时，刷新徽章
  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (CART_KEYS.includes(e.key)) fbRefreshAllBadges();
  });

  window.addEventListener("freshbuy:cart_updated", fbRefreshAllBadges);

  window.addEventListener("DOMContentLoaded", () => {
    // 首次刷新顶部角标（避免空）
    fbRefreshTopCartBadge();
    main();
  });
})();
