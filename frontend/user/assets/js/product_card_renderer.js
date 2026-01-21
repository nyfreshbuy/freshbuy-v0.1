// frontend/user/assets/js/product_card_renderer.js
// =======================================================
// Freshbuy / 在鲜购拼好货 - 商品卡片公共渲染器（抽离自 index.js）
//
// 功能：
// 1) expandProductsWithVariants：把同一商品拆成“单个/整箱”等多张展示卡
// 2) createProductCard：生成卡片 DOM（含 overlay + badge + 加购/黑框 +/- 切换）
// 3) 购物车兜底：从 FreshCart / Cart / localStorage 读取数量并同步徽章
// 4) 库存上限：单个 max=stock；整箱 max=floor(stock/unitCount)；叠加 limitQty
// 5) 徽章 = min(购物车数量, 卡片可买上限 card.__maxQty)
// 6) 卡片挂载：card.__refreshStockUI(stockUnits) 用于轮询库存刷新
//
// 使用方式：
//   const R = window.ProductCardRenderer;
//   const viewList = R.expandProductsWithVariants(list);
//   grid.appendChild(R.createProductCard(p, badgeText));
//
// 可选：R.bindGlobalCartDelegationOnce(); // 全站事件委托只需绑一次
// =======================================================

(function () {
  "use strict";

  console.log("✅ product_card_renderer.js loaded at:", new Date().toISOString());

  // =========================
  // 小工具
  // =========================
  function money(n) {
    const v = Number(n || 0);
    return v % 1 === 0 ? String(v.toFixed(0)) : String(v.toFixed(2));
  }

  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
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
      isTrueFlag(p.isHot) ||
      isTrueFlag(p.isHotDeal) ||
      isTrueFlag(p.hotDeal) ||
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "爆品日") ||
      hasKeyword(p, "hot")
    );
  }

  // ✅ 你 index.js 的特价显示口径（specialEnabled + specialQty + specialTotalPrice / specialPrice）
  function getSpecialText(p) {
    if (!p || !p.specialEnabled) return "";
    const qty = Math.max(1, Math.floor(Number(p.specialQty || 1)));
    const total = p.specialTotalPrice == null ? null : Number(p.specialTotalPrice);
    if (qty > 1 && Number.isFinite(total) && total > 0) {
      return `${qty} for $${money(total)}`;
    }
    const sp = p.specialPrice == null ? null : Number(p.specialPrice);
    if (Number.isFinite(sp) && sp > 0) return `特价 $${money(sp)}`;
    return "";
  }

  // =========================
  // ✅ variants 展开：同一商品 -> 多个展示商品（单个/整箱）
  // =========================
  function expandProductsWithVariants(list) {
    const out = [];
    const arr = Array.isArray(list) ? list : [];

    for (const p of arr) {
      const productId = String(p?._id || p?.id || "").trim();
      const variants = Array.isArray(p?.variants) ? p.variants : [];

      // 无 variants -> 默认单个
      if (!variants.length) {
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
        continue;
      }

      const enabledVars = variants.filter((v) => v && v.enabled !== false);
      if (!enabledVars.length) {
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
  }

  // =========================
  // ✅ 购物车快照兜底（FreshCart / Cart / localStorage）
  // =========================
  function getCartSnapshot() {
    // 1) FreshCart 优先
    try {
      const fc = window.FreshCart;
      if (fc) {
        if (typeof fc.getState === "function") return fc.getState();
        if (fc.state) return fc.state;
        if (fc.cart) return fc.cart;
      }
    } catch {}

    // 2) Cart 兼容
    try {
      const c = window.Cart;
      if (c) {
        if (typeof c.getState === "function") return c.getState();
        if (c.state) return c.state;
        if (c.cart) return c.cart;
      }
    } catch {}

    // 3) localStorage 扫描兜底
    try {
      const candidates = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.toLowerCase().includes("cart")) candidates.push(k);
      }

      candidates.sort((a, b) => {
        const A = a.toLowerCase();
        const B = b.toLowerCase();
        const score = (s) =>
          (s.includes("freshbuy") ? 10 : 0) + (s.includes("fb") ? 3 : 0) + (s.includes("cart") ? 1 : 0);
        return score(B) - score(A);
      });

      for (const k of candidates) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const t = raw.trim();
        if (!t.startsWith("{") && !t.startsWith("[")) continue;

        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        if (parsed) return parsed;
      }
    } catch {}

    return null;
  }

  // ✅ 把各种“购物车结构”统一成 { [id]: qty }
  function normalizeCartToQtyMap(cart) {
    const map = {};
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

      // ✅ 常见 map 结构
      if (obj.itemsById) return obj.itemsById;
      if (obj.cartItems) return obj.cartItems;
      if (obj.lines) return obj.lines;
      if (obj.lineItems) return obj.lineItems;

      for (const key of Object.keys(obj)) {
        const got = findItems(obj[key], depth + 1);
        if (got) return got;
      }
      return null;
    }

    const items = findItems(cart);

    // items 是对象映射
    if (items && typeof items === "object" && !Array.isArray(items)) {
      Object.keys(items).forEach((k) => {
        const it = items[k];
        if (!it || typeof it !== "object") return;

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

        const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.q ?? 0);
        if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
      });
      return map;
    }

    // items 是数组
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

        const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.q ?? 0);
        if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
      });
      return map;
    }

    // 最后兜底：把 cart 当成键值对
    if (typeof cart === "object") {
      for (const k of Object.keys(cart)) {
        const v = cart[k];
        if (!k) continue;

        const lk = String(k).toLowerCase();
        if (lk === "total" || lk === "meta" || lk === "items" || lk === "cart" || lk === "state" || lk === "data")
          continue;

        const id = String(k).trim();
        const qty = Number(v?.qty ?? v?.quantity ?? v?.count ?? v ?? 0);
        if (id && Number.isFinite(qty)) map[id] = (map[id] || 0) + qty;
      }
    }

    return map;
  }

  function getCartQty(pid) {
    const snap = getCartSnapshot();
    const map = normalizeCartToQtyMap(snap);
    return Math.max(0, Math.floor(Number(map[pid] || 0) || 0));
  }

  // ✅ 徽章：min(购物车数量, card.__maxQty)
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

  function trySyncBadgesFromCart() {
    const cart = getCartSnapshot();
    const qtyMap = normalizeCartToQtyMap(cart);

    document.querySelectorAll(".product-qty-badge[data-pid]").forEach((el) => {
      const pid = el.getAttribute("data-pid");
      setProductBadge(pid, qtyMap[pid] || 0);
    });
  }

  let __badgeSyncTimer = null;
  function scheduleBadgeSync() {
    if (__badgeSyncTimer) return;
    __badgeSyncTimer = setTimeout(() => {
      __badgeSyncTimer = null;
      trySyncBadgesFromCart();
    }, 50);
  }

  // =========================
  // ✅ 购物车写入：setCartQty（严格按你 index.js 口径）
  // =========================
  function setCartQty(pid, targetQty, normalizedItem) {
    const next = Math.max(0, Math.floor(Number(targetQty || 0) || 0));

    const cartApi = (window.FreshCart && window.FreshCart) || (window.Cart && window.Cart) || null;
    if (!cartApi) {
      alert("购物车模块暂未启用（请确认 cart.js 已加载）");
      return false;
    }

    const curQty = getCartQty(pid);

    // next=0：优先 setQty/remove
    if (next === 0) {
      try {
        if (typeof cartApi.setQty === "function") {
          cartApi.setQty(pid, 0);
          return true;
        }
      } catch {}
      try {
        if (typeof cartApi.removeItem === "function") {
          cartApi.removeItem(pid);
          return true;
        }
        if (typeof cartApi.remove === "function") {
          cartApi.remove(pid);
          return true;
        }
      } catch {}
      return true;
    }

    // ✅ next>0 且当前不存在：必须 addItem
    if (curQty <= 0) {
      if (typeof cartApi.addItem === "function") {
        cartApi.addItem(normalizedItem || { id: pid }, next);
        return true;
      }
      return true;
    }

    // ✅ 已存在：用 setQty / updateQty / changeQty
    try {
      if (typeof cartApi.setQty === "function") {
        cartApi.setQty(pid, next);
        return true;
      }
      if (typeof cartApi.updateQty === "function") {
        cartApi.updateQty(pid, next);
        return true;
      }
      if (typeof cartApi.changeQty === "function") {
        const delta = next - curQty;
        cartApi.changeQty(pid, delta);
        return true;
      }
      if (typeof cartApi.setItemQty === "function") {
        cartApi.setItemQty(pid, next);
        return true;
      }
    } catch {}

    // 差量兜底
    const delta = next - curQty;
    if (delta === 0) return true;

    if (delta > 0) {
      if (typeof cartApi.addItem === "function") {
        const item = normalizedItem || { id: pid };
        try {
          cartApi.addItem(item, delta);
          return true;
        } catch {}
        try {
          cartApi.addItem(pid, delta);
          return true;
        } catch {}
        try {
          cartApi.addItem({ ...item, qty: delta, quantity: delta, count: delta });
          return true;
        } catch {}
        return false;
      }
      return false;
    }

    // delta < 0：优先 remove 到 0
    if (next === 0) {
      try {
        if (typeof cartApi.removeItem === "function") {
          cartApi.removeItem(pid);
          return true;
        }
        if (typeof cartApi.remove === "function") {
          cartApi.remove(pid);
          return true;
        }
      } catch {}
      return true;
    }

    // 逐个减少兜底
    const steps = Math.abs(delta);
    for (let i = 0; i < steps; i++) {
      if (typeof cartApi.decreaseItem === "function") cartApi.decreaseItem(pid, 1);
      else if (typeof cartApi.removeOne === "function") cartApi.removeOne(pid);
    }
    return true;
  }

  // =========================
  // ✅ 卡片动作切换：加入购物车 <-> 黑框 +/-
  // =========================
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
    if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, qty));

    const minus = card.querySelector("[data-qty-minus]");
    const plus = card.querySelector("[data-qty-plus]");
    if (minus) minus.disabled = qty <= 0 || cap <= 0;
    if (plus) plus.disabled = cap <= 0 || qty >= cap;
  }

  function renderAllCardsAction() {
    document.querySelectorAll(".product-card[data-cart-pid]").forEach((card) => renderCardAction(card));
  }

  // =========================
  // ✅ 核心：createProductCard（按你 index.js 口径生成 DOM）
  // =========================
  function createProductCard(p, extraBadgeText) {
    const article = document.createElement("article");
    article.className = "product-card";

    // 展示层：同一个商品拆成单个/整箱两张卡
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

    // 价格：保持你 index.js 的口径
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
      priceMainText = `${specialQty} for $${specialTotal.toFixed(2)}`;
      if (originUnit > 0) priceSubText = `单个原价 $${originUnit.toFixed(2)}`;
    } else if (isSingleVariant && specialEnabled && specialQty === 1 && specialTotal > 0 && originUnit > specialTotal) {
      priceMainText = `$${specialTotal.toFixed(2)}`;
      priceSubText = `原价 $${originUnit.toFixed(2)}`;
    } else {
      if (!isSingleVariant && originUnit > 0) priceSubText = `单个原价 $${originUnit.toFixed(2)}`;
    }

    const badgeText = extraBadgeText || ((p.tag || "").includes("爆品") ? "爆品" : "");

    const imageUrl =
      p.image && String(p.image).trim()
        ? String(p.image).trim()
        : `https://picsum.photos/seed/${encodeURIComponent(pid || displayName || "fb")}/500/400`;

    const tagline = (p.tag || p.category || "").slice(0, 18);
    const limitQty = p.limitQty || p.limitPerUser || p.maxQty || p.purchaseLimit || 0;

    // ✅ 唯一库存口径
    const stockUnits = Math.max(0, Math.floor(Number(p.stock ?? p.inventory ?? 0) || 0));
    let maxQty = variantKey === "single" ? stockUnits : Math.floor(stockUnits / unitCount);

    if (Number(limitQty) > 0) {
      const lim = Math.max(0, Math.floor(Number(limitQty)));
      maxQty = Math.max(0, Math.min(maxQty, lim));
    }

    article.__stockUnits = stockUnits;
    article.__maxQty = maxQty;

    const maxText = unitCount > 1 ? `仅剩 ${Math.max(0, maxQty)} 箱` : `仅剩 ${Math.max(0, maxQty)}`;

    // clamp（内部用）
    function clampQty(q) {
      let n = Math.floor(Number(q || 1));
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (maxQty <= 0) return 0;
      if (n > maxQty) n = maxQty;
      return n;
    }
    let selectedQty = 1;

    // 预备 normalizedItem（给全局事件委托使用）
    const normalized = {
      id: pid,
      productId: productId,
      variantKey: variantKey,
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
            <button type="button" class="overlay-btn add" data-add-pid="${pid}" ${maxQty <= 0 ? "disabled" : ""}>
              ${maxQty <= 0 ? "已售罄" : `加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}`}
            </button>
          </div>
        </div>
      </div>

      <div class="product-name" data-go-detail>${displayName}</div>
      <div class="product-desc">${p.desc || ""}</div>

      <div class="product-price-row" style="display:flex;flex-direction:column;gap:2px;">
        <span class="product-price" style="font-size:18px;font-weight:900;line-height:1.1;">
          ${priceMainText}
        </span>
        ${
          priceSubText
            ? `<span class="product-origin" style="font-size:12px;opacity:.75;">${priceSubText}</span>`
            : ""
        }
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
          ${maxQty <= 0 ? "disabled" : ""}>
          ${maxQty <= 0 ? "已售罄" : "加入购物车"}
        </button>
      </div>
    `;

    // ✅ 只允许：图片 + 商品名 跳详情
    function goDetail(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!productId) return;
      const url =
        "product_detail.html?id=" +
        encodeURIComponent(productId) +
        "&variant=" +
        encodeURIComponent(variantKey);
      window.location.href = url;
    }
    article.querySelectorAll("[data-go-detail]").forEach((el) => {
      el.style.cursor = "pointer";
      el.addEventListener("click", goDetail);
    });

    // 收藏占位
    const favBtn = article.querySelector(".overlay-btn.fav");
    if (favBtn) {
      favBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        alert("收藏功能后续接入，这里先做占位提示。");
      });
    }

    // UI 同步（库存变化时）
    const qtyHint = article.querySelector("[data-qty-hint]");
    function syncQtyUI() {
      selectedQty = clampQty(selectedQty);

      const minus = article.querySelector("[data-qty-minus]");
      const plus = article.querySelector("[data-qty-plus]");

      if (minus) minus.disabled = selectedQty <= 1 || maxQty <= 0;
      if (plus) plus.disabled = maxQty <= 0 || selectedQty >= maxQty;

      const newMaxText = unitCount > 1 ? `仅剩 ${Math.max(0, maxQty)} 箱` : `仅剩 ${Math.max(0, maxQty)}`;
      if (qtyHint) qtyHint.textContent = maxQty <= 0 ? "已售罄" : newMaxText;

      const overlayAdd = article.querySelector('.overlay-btn.add[data-add-pid]');
      const fixedAdd = article.querySelector('.product-add-fixed[data-add-pid]');
      if (overlayAdd) overlayAdd.disabled = maxQty <= 0;
      if (fixedAdd) fixedAdd.disabled = maxQty <= 0;
    }

    // ✅ 提供库存刷新入口（轮询用）
    article.__refreshStockUI = function refreshStockUI(newStockUnits) {
      const su = Math.max(0, Math.floor(Number(newStockUnits || 0) || 0));
      article.__stockUnits = su;

      let newMax = variantKey === "single" ? su : Math.floor(su / unitCount);
      if (Number(limitQty) > 0) {
        const lim = Math.max(0, Math.floor(Number(limitQty)));
        newMax = Math.max(0, Math.min(newMax, lim));
      }

      maxQty = newMax;
      article.__maxQty = newMax;

      selectedQty = clampQty(selectedQty);
      syncQtyUI();
      renderCardAction(article);

      try {
        scheduleBadgeSync();
      } catch {}
    };

    // 初次渲染：先按购物车决定显示状态
    syncQtyUI();
    renderCardAction(article);

    return article;
  }

  // =========================
  // ✅ 全站事件委托（只绑一次）
  // =========================
  let __delegationBound = false;

  function bindGlobalCartDelegationOnce() {
    if (__delegationBound) return;
    __delegationBound = true;

    document.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".product-add-fixed[data-add-only]");
      const overlayAddBtn = e.target.closest(".overlay-btn.add[data-add-pid]");
      const minusBtn = e.target.closest("[data-qty-minus]");
      const plusBtn = e.target.closest("[data-qty-plus]");
      if (!addBtn && !overlayAddBtn && !minusBtn && !plusBtn) return;

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

      function renderActionInstant(nextQty) {
        const qtyRow = card.querySelector("[data-qty-row]");
        const addBtn2 = card.querySelector(".product-add-fixed[data-add-only]");
        const qtyDisplay = card.querySelector("[data-qty-display]");

        if (addBtn2) addBtn2.style.display = nextQty <= 0 ? "" : "none";
        if (qtyRow) qtyRow.style.display = nextQty > 0 ? "flex" : "none";
        if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, nextQty || 1));

        try {
          setProductBadge(pid, nextQty);
        } catch {}
      }

      // 加入购物车（底部按钮）：直接变 1
      if (addBtn) {
        if (cap <= 0) return;

        const ok = setCartQty(pid, 1, normalizedItem);
        if (!ok) return;

        try {
          window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } }));
        } catch {}

        renderCardAction(card);
        scheduleBadgeSync();
        return;
      }

      // overlay 加购：+1
      if (overlayAddBtn) {
        if (cap <= 0) return;

        const next = Math.min(cap, cur + 1);
        setCartQty(pid, next, normalizedItem);

        try {
          window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } }));
        } catch {}

        renderActionInstant(next);
        scheduleBadgeSync();
        return;
      }

      // -
      if (minusBtn) {
        const next = Math.max(0, cur - 1);
        setCartQty(pid, next, normalizedItem);

        try {
          window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: -1 } }));
        } catch {}

        renderActionInstant(next);
        scheduleBadgeSync();
        return;
      }

      // +
      if (plusBtn) {
        if (cap <= 0) return;

        const next = Math.min(cap, cur + 1);
        setCartQty(pid, next, normalizedItem);

        try {
          window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } }));
        } catch {}

        renderActionInstant(next);
        scheduleBadgeSync();
        return;
      }
    });

    // 多标签页同步
    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (String(e.key).toLowerCase().includes("cart")) {
        scheduleBadgeSync();
        renderAllCardsAction();
      }
    });

    // cart 广播同步
    window.addEventListener("freshbuy:cartUpdated", () => {
      scheduleBadgeSync();
      renderAllCardsAction();
    });
  }

  // =========================
  // 对外暴露
  // =========================
  window.ProductCardRenderer = {
    // data -> view
    expandProductsWithVariants,

    // dom
    createProductCard,

    // cart/badge helpers
    getCartSnapshot,
    normalizeCartToQtyMap,
    getCartQty,
    setCartQty,
    setProductBadge,
    scheduleBadgeSync,

    // ui refresh
    renderCardAction,
    renderAllCardsAction,

    // delegation
    bindGlobalCartDelegationOnce,

    // util (可选)
    isHotProduct,
    getSpecialText,
  };
})();
