// frontend/user/assets/js/DailySpecial.js
console.log("✅ DailySpecial.js loaded (FINAL STABLE v2)");

(() => {
  const GRID_ID = "dailyGrid";
  const CART_ICON_ID = "cartIcon";
  const CART_COUNT_ID = "cartCount";

  const API_CANDIDATES = ["/api/products-simple", "/api/products/public", "/api/products"];
  const CART_KEYS = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];

  const $ = (id) => document.getElementById(id);

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const isTrueFlag = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "yes";

  function fbPid(p) {
    return String(p?._id || p?.id || p?.sku || p?.code || p?.productId || "").trim();
  }

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

    if (Array.isArray(raw)) {
      for (const it of raw) {
        const pid = String(it?._id || it?.id || it?.sku || it?.code || it?.productId || "").trim();
        const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
        if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
      }
      return map;
    }

    if (raw && Array.isArray(raw.items)) {
      for (const it of raw.items) {
        const pid = String(it?._id || it?.id || it?.sku || it?.code || it?.productId || "").trim();
        const qty = Number(it?.qty ?? it?.count ?? it?.quantity ?? 0) || 0;
        if (pid && qty > 0) map[pid] = (map[pid] || 0) + qty;
      }
      return map;
    }

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

  function refreshTopCartBadge() {
    const el = $(CART_COUNT_ID);
    if (!el) return;
    const total = fbTotalQty(fbBuildQtyMap());
    if (total > 0) {
      el.textContent = String(total);
      el.style.display = "inline-block";
    } else {
      el.style.display = "none";
    }
  }

  function ensureQtyBadge(cardEl) {
    let badge = cardEl.querySelector(".product-qty-badge");
    if (badge) return badge;

    const host =
      cardEl.querySelector(".product-image-wrap") ||
      cardEl.querySelector(".product-media") ||
      cardEl.querySelector(".product-thumb") ||
      cardEl;

    badge = document.createElement("span");
    badge.className = "product-qty-badge";
    badge.style.display = "none";
    host.appendChild(badge);
    return badge;
  }

  function renderQtyBadge(cardEl, pid, qtyMap) {
    const badge = ensureQtyBadge(cardEl);
    const q = Number(qtyMap[pid] || 0) || 0;
    if (q > 0) {
      badge.textContent = String(q);
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  function refreshAllBadges() {
    const grid = $(GRID_ID);
    if (!grid) return;
    const qtyMap = fbBuildQtyMap();

    grid.querySelectorAll(".product-card[data-pid]").forEach((card) => {
      const pid = String(card.getAttribute("data-pid") || "").trim();
      if (pid) renderQtyBadge(card, pid, qtyMap);
    });

    refreshTopCartBadge();
  }

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

  function resolveRendererFn() {
    if (typeof window.renderProductCard === "function") return window.renderProductCard;

    if (window.ProductCardRenderer && typeof window.ProductCardRenderer.render === "function") {
      return window.ProductCardRenderer.render.bind(window.ProductCardRenderer);
    }

    return null;
  }

  function createCardViaRenderer(p, qtyMap) {
    const name = String(p.name || p.title || "未命名商品").trim();
    const pid = fbPid(p) || name;

    const renderer = resolveRendererFn();
    if (typeof renderer !== "function") {
      console.warn("❌ 商品卡渲染器未找到：请确认 /user/assets/js/product_card_renderer.js 已加载且暴露 window.renderProductCard");
      return null;
    }

    const card = renderer(p, { scene: "dailySpecial", badgeText: "家庭必备", forceBadge: true });
    if (!card || card.nodeType !== 1) return null;

    card.classList.add("product-card");
    card.setAttribute("data-pid", pid);

    renderQtyBadge(card, pid, qtyMap);

    card.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && (t.closest("button") || t.closest("a") || t.closest("[data-action]"))) return;
      window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(pid);
    });

    // 无论渲染器内部怎么加购，都刷新一次徽章
    card.addEventListener(
      "click",
      () => {
        setTimeout(() => refreshAllBadges(), 80);
        window.dispatchEvent(new Event("freshbuy:cart_updated"));
      },
      true
    );

    return card;
  }

  // ✅ 修复：右上角购物车点击无反应（尽可能兼容你的 cart.js）
  function bindCartIcon() {
    const icon = $(CART_ICON_ID);
    if (!icon) return;

    icon.addEventListener("click", () => {
      const fc = window.FreshCart;
      const c = window.Cart;

      // 1) 尝试各种可能的方法名
      const tryCall = (obj, names) => {
        if (!obj) return false;
        for (const n of names) {
          if (typeof obj[n] === "function") {
            obj[n]();
            return true;
          }
        }
        return false;
      };

      if (tryCall(fc, ["openDrawer", "toggleDrawer", "open", "toggle", "show", "openCart", "toggleCart"]))
        return;
      if (tryCall(c, ["openDrawer", "toggleDrawer", "open", "toggle", "show", "openCart", "toggleCart"]))
        return;

      // 2) 事件兜底（如果 cart.js 监听事件）
      window.dispatchEvent(new Event("freshbuy:cart_open"));
      window.dispatchEvent(new Event("freshbuy:cart_toggle"));
      window.dispatchEvent(new Event("cart:open"));
      window.dispatchEvent(new Event("cart:toggle"));

      // 3) DOM 兜底：尝试点击页面上任何“打开购物车”的按钮（如果存在）
      const btn =
        document.querySelector("[data-cart-open]") ||
        document.querySelector("[data-cart-toggle]") ||
        document.querySelector("#cartToggle") ||
        document.querySelector(".cart-toggle") ||
        document.querySelector(".open-cart");
      if (btn) {
        btn.click();
        return;
      }

      console.warn("⚠️ 仍未找到打开购物车的方法：请在控制台展开 window.FreshCart 看有哪些函数名");
    });
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
    if (!grid) return;

    bindCartIcon();

    try {
      const all = await fetchProducts();
      const specialList = all.filter((p) => isSpecialDeal(p) && !isHotProduct(p));
      console.log("🧮 total:", all.length, "special=>family:", specialList.length);

      grid.innerHTML = "";
      if (!specialList.length) {
        renderEmpty("已获取商品，但没有任何商品满足“特价”判定（请确认后台特价字段）。");
        refreshAllBadges();
        return;
      }

      const qtyMap = fbBuildQtyMap();
      for (const p of specialList) {
        const card = createCardViaRenderer(p, qtyMap);
        if (card) grid.appendChild(card);
      }

      refreshAllBadges();
    } catch (e) {
      console.error("❌ DailySpecial load failed:", e);
      renderEmpty("加载失败：无法获取商品列表（请检查 API 是否正常返回）。");
      refreshAllBadges();
    }
  }

  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (CART_KEYS.includes(e.key)) refreshAllBadges();
  });

  window.addEventListener("freshbuy:cart_updated", refreshAllBadges);

  window.addEventListener("DOMContentLoaded", () => {
    refreshTopCartBadge();
    main();
  });
})();
