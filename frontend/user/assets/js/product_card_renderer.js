// frontend/user/assets/js/product_card_renderer.js
// =======================================================
// Freshbuy 全站统一商品卡渲染器（对齐首页逻辑）- ✅ 防重复加载/防翻倍版
// -------------------------------------------------------
// ✅ 全部封装：
// 1) 首页卡片 HTML 模板（图片+overlay+徽章+价格+动作区）
// 2) 单卖/整箱拆卡（cartKey=productId::variantKey）
// 3) 库存上限：单个=stock；整箱=floor(stock/unitCount)；叠加限购
// 4) 徽章同步：badge = min(购物车数量, card.__maxQty)
// 5) 动作区切换：qty=0 显示“加入购物车”；qty>=1 显示黑框 +/-
// 6) overlay 加购统一（+1）
// 7) 只允许：图片区域 + 商品名 跳详情（按钮不跳）
// 8) 全站同步：freshbuy:cartUpdated + storage
// 9) 库存轮询：/api/products-simple -> 更新卡片库存UI + clamp + 徽章兜底
//
// ✅ 本版额外修复：
// A) 防止 renderer 被重复加载导致：+/- 翻倍、轮询多开、事件重复绑定
// =======================================================

(function () {
  "use strict";

  // ✅ 0) 防重复加载：如果这个文件被执行第二次，直接退出（避免重复绑事件、重复轮询）
  if (window.__FB_PRODUCT_CARD_RENDERER_LOADED__) {
    console.warn("⚠️ product_card_renderer.js duplicated load blocked.");
    return;
  }
  window.__FB_PRODUCT_CARD_RENDERER_LOADED__ = true;

  // ✅ 1) 复用已存在的 FBCard（更稳），避免覆盖导致旧监听残留 + 新监听又来一套
  const FBCard = (window.FBCard && typeof window.FBCard === "object") ? window.FBCard : {};
  window.FBCard = FBCard;

  // -----------------------
  // Config（可在页面覆盖）
  // -----------------------
  FBCard.config = FBCard.config || {
    apiProductsSimple: "/api/products-simple",
    stockRefreshMs: 15000,
    detailPage: "product_detail.html",
  };

  // -----------------------
  // Utils
  // -----------------------
  function money(n) {
    const v = Number(n || 0);
    return v % 1 === 0 ? String(v.toFixed(0)) : String(v.toFixed(2));
  }
  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1";
  }
  function hasKeyword(p, keyword) {
    if (!p) return false;
    const kw = String(keyword).toLowerCase();
    const norm = (v) => (v ? String(v).toLowerCase() : "");
    const fields = [p.tag, p.type, p.category, p.subCategory, p.mainCategory, p.subcategory, p.section];
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
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "爆品日") ||
      hasKeyword(p, "hot")
    );
  }
  function getStockUnits(p) {
    return Math.max(0, Math.floor(Number(p?.stock ?? p?.inventory ?? 0) || 0));
  }
  function getLimitQty(p) {
    return Number(p?.limitQty || p?.limitPerUser || p?.maxQty || p?.purchaseLimit || 0) || 0;
  }

  // -----------------------
  // Cart API
  // -----------------------
  function getCartApi() {
    return (window.FreshCart && window.FreshCart) || (window.Cart && window.Cart) || null;
  }

  function getCartSnapshot() {
    try {
      const api = getCartApi();
      if (api) {
        if (typeof api.getCart === "function") return api.getCart();
        if (typeof api.getState === "function") return api.getState();
        if (typeof api.getItems === "function") return { items: api.getItems() };
        if (Array.isArray(api.items)) return { items: api.items };
        if (api.cart) return api.cart;
        if (api.state) return api.state;
      }
    } catch {}

    // localStorage 兜底
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.toLowerCase().includes("cart")) keys.push(k);
      }
      keys.sort((a, b) => {
        const score = (s) =>
          (s.includes("freshbuy") ? 10 : 0) + (s.includes("fb") ? 3 : 0) + (s.includes("cart") ? 1 : 0);
        return score(b.toLowerCase()) - score(a.toLowerCase());
      });

      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const t = raw.trim();
        if (!t.startsWith("{") && !t.startsWith("[")) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed) return parsed;
        } catch {}
      }
    } catch {}

    return null;
  }

  function normalizeCartToQtyMap(cart) {
    const map = Object.create(null);
    if (!cart) return map;

    function findItems(obj, depth = 0) {
      if (!obj || typeof obj !== "object" || depth > 6) return null;

      if (Array.isArray(obj)) {
        if (obj.length && typeof obj[0] === "object") return obj;
        return null;
      }

      if (Array.isArray(obj.items)) return obj.items;
      if (Array.isArray(obj.cart?.items)) return obj.cart.items;
      if (Array.isArray(obj.state?.items)) return obj.state.items;
      if (Array.isArray(obj.state?.cart?.items)) return obj.state.cart.items;
      if (Array.isArray(obj.data?.items)) return obj.data.items;
      if (Array.isArray(obj.payload?.items)) return obj.payload.items;

      if (obj.itemsById) return obj.itemsById;
      if (obj.cartItems) return obj.cartItems;
      if (obj.lines) return obj.lines;
      if (obj.lineItems) return obj.lineItems;

      for (const k of Object.keys(obj)) {
        const got = findItems(obj[k], depth + 1);
        if (got) return got;
      }
      return null;
    }

    const items = findItems(cart);

    // map
    if (items && typeof items === "object" && !Array.isArray(items)) {
      for (const k of Object.keys(items)) {
        const it = items[k];
        if (!it || typeof it !== "object") continue;

        const id = String(
          it.id ||
            it.pid ||
            it.productId ||
            it.product_id ||
            it.sku ||
            it._id ||
            it.product?._id ||
            it.product?.id ||
            it.product?.sku ||
            k ||
            ""
        ).trim();

        const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.num ?? it.amount ?? it.n ?? it.q ?? 0);
        if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
      }
      return map;
    }

    // array
    if (Array.isArray(items)) {
      items.forEach((it) => {
        const id = String(
          it.id ||
            it.pid ||
            it.productId ||
            it.product_id ||
            it.sku ||
            it._id ||
            it.product?._id ||
            it.product?.id ||
            it.product?.sku ||
            ""
        ).trim();

        const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.num ?? it.amount ?? it.n ?? it.q ?? 0);
        if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
      });
      return map;
    }

    // fallback: obj key->qty
    if (typeof cart === "object") {
      for (const k of Object.keys(cart)) {
        if (!k) continue;
        const lk = String(k).toLowerCase();
        if (["total", "meta", "items", "cart", "state", "data"].includes(lk)) continue;

        const v = cart[k];
        const id = String(k).trim();
        const qty = Number(v?.qty ?? v?.quantity ?? v?.count ?? v ?? 0);
        if (id && Number.isFinite(qty)) map[id] = (map[id] || 0) + qty;
      }
    }
    return map;
  }

  function getCartQty(pid) {
    const api = getCartApi();
    try {
      if (api && typeof api.getQty === "function") {
        const n = Number(api.getQty(pid) || 0);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      }
    } catch {}
    const snap = getCartSnapshot();
    const map = normalizeCartToQtyMap(snap);
    return Math.max(0, Math.floor(Number(map[pid] || 0) || 0));
  }

  // ✅ setCartQty：保证“创建/更新”都只走一条路径，避免某些 cart.js 内部又叠加
  function setCartQty(pid, targetQty, normalizedItem) {
    const next = Math.max(0, Math.floor(Number(targetQty || 0) || 0));
    const api = getCartApi();
    if (!api) {
      alert("购物车模块暂未启用（请确认 cart.js 已加载）");
      return false;
    }

    const curQty = getCartQty(pid);

    // next=0
    if (next === 0) {
      try {
        if (typeof api.setQty === "function") {
          api.setQty(pid, 0);
          return true;
        }
      } catch {}
      try {
        if (typeof api.removeItem === "function") return (api.removeItem(pid), true);
        if (typeof api.remove === "function") return (api.remove(pid), true);
      } catch {}
      return true;
    }

    // 不存在 -> addItem（一次）
    if (curQty <= 0) {
      if (typeof api.addItem === "function") {
        try {
          api.addItem(normalizedItem || { id: pid }, next);
          return true;
        } catch {}
      }
      return false;
    }

    // 已存在 -> setQty（优先）
    try {
      if (typeof api.setQty === "function") return (api.setQty(pid, next), true);
      if (typeof api.updateQty === "function") return (api.updateQty(pid, next), true);
      if (typeof api.changeQty === "function") return (api.changeQty(pid, next), true);
      if (typeof api.setItemQty === "function") return (api.setItemQty(pid, next), true);
    } catch {}

    // fallback：差量
    const delta = next - curQty;
    if (delta === 0) return true;

    if (typeof api.addItem === "function") {
      try {
        api.addItem(normalizedItem || { id: pid }, delta);
        return true;
      } catch {}
    }
    return false;
  }

  // -----------------------
  // Badge
  // -----------------------
  function setProductBadge(pid, cartQty) {
    const els = document.querySelectorAll(`.product-qty-badge[data-pid="${pid}"]`);
    if (!els || !els.length) return;

    const raw = Math.max(0, Math.floor(Number(cartQty || 0) || 0));

    els.forEach((el) => {
      const card = el.closest(".product-card");
      const cap0 = Number(card?.__maxQty);
      const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : Infinity;
      const showQty = Math.min(raw, cap);

      if (showQty > 0) {
        el.textContent = showQty >= 99 ? "99+" : String(showQty);
        el.style.display = "flex";
      } else {
        el.textContent = "";
        el.style.display = "none";
      }
    });
  }

  let __badgeSyncTimer = null;
  function scheduleBadgeSync() {
    if (__badgeSyncTimer) return;
    __badgeSyncTimer = setTimeout(() => {
      __badgeSyncTimer = null;
      const snap = getCartSnapshot();
      const map = normalizeCartToQtyMap(snap);
      document.querySelectorAll(".product-qty-badge[data-pid]").forEach((el) => {
        const pid = el.getAttribute("data-pid");
        setProductBadge(pid, map[pid] || 0);
      });
    }, 50);
  }

  // -----------------------
  // 动作区渲染
  // -----------------------
  function renderCardAction(card) {
    if (!card) return;
    const pid = String(card.dataset.cartPid || "").trim();
    if (!pid) return;

    const qty = getCartQty(pid);

    const qtyRow = card.querySelector("[data-qty-row]");
    const addBtn = card.querySelector(".product-add-fixed[data-add-only]");
    const qtyDisplay = card.querySelector("[data-qty-display]");

    const cap0 = Number(card.__maxQty);
    const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : 0;

    if (addBtn) addBtn.style.display = qty <= 0 ? "" : "none";
    if (qtyRow) qtyRow.style.display = qty > 0 ? "flex" : "none";
    if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, qty || 1));

    const minus = card.querySelector("[data-qty-minus]");
    const plus = card.querySelector("[data-qty-plus]");
    if (minus) minus.disabled = qty <= 0 || cap <= 0;
    if (plus) plus.disabled = cap <= 0 || qty >= cap;
  }

  function renderAllCardsAction() {
    document.querySelectorAll(".product-card[data-cart-pid]").forEach((card) => renderCardAction(card));
  }

  // -------------------------------------------------------
  // 3) expand：单卖/整箱拆卡
  // -------------------------------------------------------
  FBCard.expand = function expandProductsWithVariants(list) {
    const out = [];
    const arr = Array.isArray(list) ? list : [];

    for (const p of arr) {
      const productId = String(p?._id || p?.id || "").trim();
      const variants = Array.isArray(p?.variants) ? p.variants : [];

      const pushSingle = () => {
        const vKey = "single";
        out.push({
          ...p,
          __productId: productId,
          __variantKey: vKey,
          __variantLabel: "单个",
          __unitCount: 1,
          __displayName: p?.name || "",
          __displayPrice: null,
          __cartKey: productId ? `${productId}::${vKey}` : String(p?.sku || p?.id || ""),
        });
      };

      if (!variants.length) {
        pushSingle();
        continue;
      }

      const enabledVars = variants.filter((v) => v && v.enabled !== false);
      if (!enabledVars.length) {
        pushSingle();
        continue;
      }

      for (const v of enabledVars) {
        const vKey = String(v.key || "single").trim() || "single";
        const unitCount = Math.max(1, Math.floor(Number(v.unitCount || 1)));
        const vLabel = String(v.label || "").trim() || (unitCount > 1 ? `整箱(${unitCount}个)` : "单个");
        const vPrice = v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null;

        out.push({
          ...p,
          __productId: productId,
          __variantKey: vKey,
          __variantLabel: vLabel,
          __unitCount: unitCount,
          __displayName: `${p?.name || ""} - ${vLabel}`,
          __displayPrice: vPrice,
          __cartKey: productId ? `${productId}::${vKey}` : String(p?.sku || p?.id || ""),
        });
      }
    }
    return out;
  };

  // -------------------------------------------------------
  // 4) createCard：卡片模板
  // -------------------------------------------------------
  FBCard.createCard = function createProductCard(p, extraBadgeText) {
    const article = document.createElement("article");
    article.className = "product-card";

    const productId = String(p.__productId || p._id || p.id || "").trim();
    const variantKey = String(p.__variantKey || "single").trim() || "single";

    article.dataset.productId = productId;
    article.dataset.variantKey = variantKey;

    const unitCount = Math.max(1, Math.floor(Number(p.__unitCount || 1) || 1));
    article.dataset.unitCount = String(unitCount);

    const cartKey = String(p.__cartKey || (productId ? `${productId}::${variantKey}` : p.sku || p.id || "")).trim();
    const pid = cartKey;
    article.dataset.cartPid = pid;

    const displayName = String(p.__displayName || p.name || "").trim();

    const displayPriceOverride =
      p.__displayPrice != null && Number.isFinite(Number(p.__displayPrice)) ? Number(p.__displayPrice) : null;

    const originUnit = Number(p.originPrice ?? p.originalPrice ?? p.regularPrice ?? p.price ?? 0) || 0;
    const basePrice = displayPriceOverride != null ? displayPriceOverride : originUnit;

    const specialEnabled = !!p.specialEnabled;
    const specialQty = Math.max(1, Math.floor(Number(p.specialQty || 1) || 1));
    const specialTotal =
      p.specialTotalPrice != null && p.specialTotalPrice !== ""
        ? Number(p.specialTotalPrice)
        : p.specialPrice != null && p.specialPrice !== ""
        ? Number(p.specialPrice)
        : 0;

    const isSingleVariant = String(variantKey || "single") === "single";

    let priceMainText = `$${Number(basePrice || 0).toFixed(2)}`;
    let priceSubText = "";

    if (isSingleVariant && specialEnabled && specialQty > 1 && specialTotal > 0) {
      priceMainText = `${specialQty} for $${money(specialTotal)}`;
      if (originUnit > 0) priceSubText = `单个原价 $${money(originUnit)}`;
    } else if (isSingleVariant && specialEnabled && specialQty === 1 && specialTotal > 0 && originUnit > specialTotal) {
      priceMainText = `$${money(specialTotal)}`;
      priceSubText = `原价 $${money(originUnit)}`;
    } else {
      if (!isSingleVariant && originUnit > 0) priceSubText = `单个原价 $${money(originUnit)}`;
    }

    const badgeText = extraBadgeText || ((p.tag || "").includes("爆品") ? "爆品" : "");
    const imageUrl =
      p.image && String(p.image).trim()
        ? String(p.image).trim()
        : `https://picsum.photos/seed/${encodeURIComponent(pid || displayName || "fb")}/500/400`;

    const tagline = (p.tag || p.category || "").slice(0, 18);
    const limitQty = getLimitQty(p);

    const stockUnits = getStockUnits(p);
    let maxQty = variantKey === "single" ? stockUnits : Math.floor(stockUnits / unitCount);
    if (Number(limitQty) > 0) {
      const lim = Math.max(0, Math.floor(Number(limitQty)));
      maxQty = Math.max(0, Math.min(maxQty, lim));
    }

    article.__stockUnits = stockUnits;
    article.__maxQty = maxQty;

    const maxText = unitCount > 1 ? `仅剩 ${Math.max(0, maxQty)} 箱` : `仅剩 ${Math.max(0, maxQty)}`;

    const normalized = {
      id: pid,
      productId,
      variantKey,
      name: displayName || "商品",
      price: isSingleVariant && originUnit > 0 ? originUnit : basePrice,
      priceNum: isSingleVariant && originUnit > 0 ? originUnit : basePrice,
      image: p.image || imageUrl,
      tag: p.tag || "",
      type: p.type || "",
      isSpecial: isHotProduct(p),
      isDeal: isHotProduct(p),
    };
    article.__normalizedItem = normalized;

    article.innerHTML = `
      <div class="product-image-wrap" data-go-detail>
        ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
        <img src="${imageUrl}" class="product-image" alt="${displayName}" />
        <div class="product-qty-badge" data-pid="${pid}"></div>

        <div class="product-overlay">
          <div class="overlay-btn-row">
            <button type="button" class="overlay-btn fav">⭐ 收藏</button>
            <button
              type="button"
              class="overlay-btn add"
              data-add-pid="${pid}"
              ${maxQty <= 0 ? "disabled" : ""}
            >${maxQty <= 0 ? "已售罄" : `加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}`}</button>
          </div>
        </div>
      </div>

      <div class="product-name" data-go-detail>${displayName}</div>
      <div class="product-desc">${p.desc || ""}</div>

      <div class="product-price-row" style="display:flex;flex-direction:column;gap:2px;">
        <span class="product-price" style="font-size:18px;font-weight:900;line-height:1.1;">
          ${priceMainText}
        </span>
        ${priceSubText ? `<span class="product-origin" style="font-size:12px;opacity:.75;">${priceSubText}</span>` : ""}
      </div>

      <div class="product-tagline">${tagline}</div>

      <div class="product-action" data-action-pid="${pid}" style="margin-top:10px;">
        <div class="qty-row" data-qty-row style="display:none;align-items:center;gap:8px;">
          <button type="button" class="qty-btn" data-qty-minus style="width:34px;height:34px;border-radius:10px;">-</button>

          <div
            data-qty-display
            style="
              width:64px;
              height:34px;
              border-radius:10px;
              display:flex;
              align-items:center;
              justify-content:center;
              border:2px solid #111;
              font-weight:800;
              background:#fff;
            "
          >1</div>

          <button type="button" class="qty-btn" data-qty-plus style="width:34px;height:34px;border-radius:10px;">+</button>

          <span data-qty-hint style="font-size:12px;opacity:.7;margin-left:auto;">
            ${maxQty <= 0 ? "已售罄" : maxText}
          </span>
        </div>

        <button
          type="button"
          class="product-add-fixed"
          data-add-pid="${pid}"
          data-add-only
          style="width:100%;"
          ${maxQty <= 0 ? "disabled" : ""}
        >${maxQty <= 0 ? "已售罄" : "加入购物车"}</button>
      </div>
    `;

    function goDetail(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!productId) return;
      const url =
        FBCard.config.detailPage +
        "?id=" +
        encodeURIComponent(productId) +
        "&variant=" +
        encodeURIComponent(variantKey);
      window.location.href = url;
    }

    article.querySelectorAll("[data-go-detail]").forEach((el) => {
      el.style.cursor = "pointer";
      el.addEventListener("click", goDetail);
    });

    const favBtn = article.querySelector(".overlay-btn.fav");
    if (favBtn) {
      favBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        alert("收藏功能后续接入，这里先做占位提示。");
      });
    }

    article.__refreshStockUI = function (newStockUnits) {
      const su = Math.max(0, Math.floor(Number(newStockUnits || 0) || 0));
      article.__stockUnits = su;

      let newMax = variantKey === "single" ? su : Math.floor(su / unitCount);
      if (Number(limitQty) > 0) {
        const lim = Math.max(0, Math.floor(Number(limitQty)));
        newMax = Math.max(0, Math.min(newMax, lim));
      }
      article.__maxQty = newMax;

      const hint = article.querySelector("[data-qty-hint]");
      if (hint) {
        const txt = unitCount > 1 ? `仅剩 ${Math.max(0, newMax)} 箱` : `仅剩 ${Math.max(0, newMax)}`;
        hint.textContent = newMax <= 0 ? "已售罄" : txt;
      }

      const overlayAdd = article.querySelector('.overlay-btn.add[data-add-pid]');
      const fixedAdd = article.querySelector('.product-add-fixed[data-add-pid]');
      if (overlayAdd) overlayAdd.disabled = newMax <= 0;
      if (fixedAdd) fixedAdd.disabled = newMax <= 0;

      renderCardAction(article);
      scheduleBadgeSync();
    };

    renderCardAction(article);
    return article;
  };

  // -------------------------------------------------------
  // 5) renderGrid
  // -------------------------------------------------------
  FBCard.renderGrid = function renderGrid(gridEl, viewList, options = {}) {
    if (!gridEl) return;

    const badgeText = options.badgeText || "";
    gridEl.innerHTML = "";

    const arr = Array.isArray(viewList) ? viewList : [];
    if (!arr.length) {
      gridEl.innerHTML = '<div style="padding:12px;font-size:13px;color:#6b7280;">暂时没有商品</div>';
      return;
    }

    arr.forEach((p) => gridEl.appendChild(FBCard.createCard(p, badgeText)));

    setTimeout(() => {
      try {
        scheduleBadgeSync();
        renderAllCardsAction();
      } catch {}
    }, 0);
  };

  // -------------------------------------------------------
  // 6) ensureGlobalBindings（✅ 全局只允许绑定一次）
  // -------------------------------------------------------
  FBCard.ensureGlobalBindings = function ensureGlobalBindings() {
    // ✅ 用 window 全局标记，避免重复加载导致 __bound 重新变 false
    if (window.__FB_CARD_BINDINGS_BOUND__) return;
    window.__FB_CARD_BINDINGS_BOUND__ = true;

    function emitCartUpdated(pid, delta) {
      try {
        window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta } }));
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent("freshbuy:cart_updated", { detail: { pid, delta } }));
      } catch {}
    }

    document.addEventListener("click", (e) => {
      const addOnlyBtn = e.target.closest(".product-add-fixed[data-add-only]");
      const overlayAddBtn = e.target.closest(".overlay-btn.add[data-add-pid]");
      const minusBtn = e.target.closest("[data-qty-minus]");
      const plusBtn = e.target.closest("[data-qty-plus]");
      if (!addOnlyBtn && !overlayAddBtn && !minusBtn && !plusBtn) return;

      const card = e.target.closest(".product-card");
      if (!card) return;

      e.preventDefault();
      e.stopPropagation();

      const pid = String(card.dataset.cartPid || "").trim();
      if (!pid) return;

      const normalizedItem = card.__normalizedItem || { id: pid };
      const cap0 = Number(card.__maxQty);
      const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : 0;

      const cur = getCartQty(pid);

      function renderInstant(nextQty) {
        const qtyRow = card.querySelector("[data-qty-row]");
        const addBtn = card.querySelector(".product-add-fixed[data-add-only]");
        const qtyDisplay = card.querySelector("[data-qty-display]");

        if (addBtn) addBtn.style.display = nextQty <= 0 ? "" : "none";
        if (qtyRow) qtyRow.style.display = nextQty > 0 ? "flex" : "none";
        if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, nextQty || 1));

        setProductBadge(pid, nextQty);
      }

      if (addOnlyBtn) {
        if (cap <= 0) return;
        const ok = setCartQty(pid, 1, normalizedItem);
        if (!ok) return;

        emitCartUpdated(pid, 1);
        renderInstant(1);
        scheduleBadgeSync();
        return;
      }

      if (overlayAddBtn) {
        if (cap <= 0) return;
        const next = Math.min(cap, cur + 1);
        setCartQty(pid, next, normalizedItem);

        emitCartUpdated(pid, 1);
        renderInstant(next);
        scheduleBadgeSync();
        return;
      }

      if (minusBtn) {
        const next = Math.max(0, cur - 1);
        setCartQty(pid, next, normalizedItem);

        emitCartUpdated(pid, -1);
        renderInstant(next);
        scheduleBadgeSync();
        return;
      }

      if (plusBtn) {
        if (cap <= 0) return;
        const next = Math.min(cap, cur + 1);
        setCartQty(pid, next, normalizedItem);

        emitCartUpdated(pid, 1);
        renderInstant(next);
        scheduleBadgeSync();
        return;
      }
    });

    window.addEventListener("freshbuy:cartUpdated", () => {
      scheduleBadgeSync();
      renderAllCardsAction();
    });
    window.addEventListener("freshbuy:cart_updated", () => {
      scheduleBadgeSync();
      renderAllCardsAction();
    });

    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (String(e.key).toLowerCase().includes("cart")) {
        scheduleBadgeSync();
        renderAllCardsAction();
      }
    });
  };

  // -------------------------------------------------------
  // 7) 库存轮询（✅ 全局只允许一份）
  // -------------------------------------------------------
  FBCard.startStockPolling = function startStockPolling(ms) {
    const interval = Math.max(3000, Number(ms || FBCard.config.stockRefreshMs || 15000) || 15000);

    // ✅ 用 window 保存 timer，避免多份 renderer 各自开定时器
    if (window.__FB_CARD_STOCK_POLL_TIMER__) return;

    async function refreshStockAndCards() {
      try {
        const res = await fetch(FBCard.config.apiProductsSimple || "/api/products-simple", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));

        const list = Array.isArray(data)
          ? data
          : Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.list)
          ? data.list
          : Array.isArray(data.products)
          ? data.products
          : [];

        if (!list.length) return;

        const stockMap = Object.create(null);
        list.forEach((p) => {
          const id = String(p?._id || p?.id || "").trim();
          if (!id) return;
          stockMap[id] = getStockUnits(p);
        });

        document.querySelectorAll(".product-card[data-product-id]").forEach((card) => {
          const pid = String(card.dataset.productId || "").trim();
          if (!pid) return;

          const su = stockMap[pid];
          if (!Number.isFinite(su)) return;

          if (typeof card.__refreshStockUI === "function") card.__refreshStockUI(su);
          else card.__stockUnits = su;
        });

        scheduleBadgeSync();
      } catch (e) {
        console.warn("FBCard stock polling failed:", e);
      }
    }

    refreshStockAndCards();
    window.__FB_CARD_STOCK_POLL_TIMER__ = setInterval(refreshStockAndCards, interval);
  };

  FBCard.stopStockPolling = function stopStockPolling() {
    if (window.__FB_CARD_STOCK_POLL_TIMER__) clearInterval(window.__FB_CARD_STOCK_POLL_TIMER__);
    window.__FB_CARD_STOCK_POLL_TIMER__ = null;
  };

  // -------------------------------------------------------
  // 8) extractList
  // -------------------------------------------------------
  FBCard.extractList = function extractList(data) {
    return Array.isArray(data)
      ? data
      : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.list)
      ? data.list
      : Array.isArray(data.products)
      ? data.products
      : [];
  };
})();
