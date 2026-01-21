// frontend/user/assets/js/product_card_renderer.js
// =======================================================
// Freshbuy 全站统一商品卡渲染器（对齐首页逻辑）
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
// ✅ 其它页面用法：
//   FBCard.ensureGlobalBindings();         // 只需一次（建议每页都调用也行，会去重）
//   const view = FBCard.expand(rawList);   // rawList=后端原始商品数组
//   FBCard.renderGrid(gridEl, view, { badgeText: "" });
//   FBCard.startStockPolling();            // 需要库存轮询就开
//
// window 上挂：window.FBCard
// =======================================================

(function () {
  "use strict";

  const FBCard = {};
  window.FBCard = FBCard;

  // -----------------------
  // Config（可在页面覆盖）
  // -----------------------
  FBCard.config = {
    apiProductsSimple: "/api/products-simple",
    stockRefreshMs: 15000,
    detailPage: "product_detail.html", // 详情页路径
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
      isTrueFlag(p.isHot) ||
      isTrueFlag(p.isHotDeal) ||
      isTrueFlag(p.hotDeal) ||
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "爆品日") ||
      hasKeyword(p, "hot")
    );
  }

  function getStockUnits(p) {
    return Math.max(0, Math.floor(Number(p.stock ?? p.inventory ?? 0) || 0));
  }

  function getLimitQty(p) {
    return Number(p.limitQty || p.limitPerUser || p.maxQty || p.purchaseLimit || 0) || 0;
  }

  // -----------------------
  // Cart snapshot / qty map（与首页思想一致）
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

      // map 形式
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

    // items 是对象映射
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

        const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.num ?? it.amount ?? it.n ?? it.q ?? 0);
        if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
      });
      return map;
    }

    // 兜底：对象 key->qty
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
    const snap = getCartSnapshot();
    const map = normalizeCartToQtyMap(snap);
    return Math.max(0, Math.floor(Number(map[pid] || 0) || 0));
  }

  // ✅ 重要：第一次加购必须走 addItem（setQty 不会凭空创建）
  function setCartQty(pid, targetQty, normalizedItem) {
    const next = Math.max(0, Math.floor(Number(targetQty || 0) || 0));
    const api = getCartApi();
    if (!api) {
      alert("购物车模块暂未启用（请确认 cart.js 已加载）");
      return false;
    }

    const curQty =
      (typeof api.getQty === "function" ? Number(api.getQty(pid) || 0) : getCartQty(pid)) || 0;

    // next=0
    if (next === 0) {
      // 已存在：优先 setQty/updateQty
try {
  if (typeof api.setQty === "function") {
    api.setQty(pid, next);
    return true;
  }
  if (typeof api.updateQty === "function") {
    api.updateQty(pid, next);
    return true;
  }
  // ✅ changeQty 通常是“增量”
  if (typeof api.changeQty === "function") {
    const delta = next - curQty;
    if (delta !== 0) api.changeQty(pid, delta);
    return true;
  }
  if (typeof api.setItemQty === "function") {
    api.setItemQty(pid, next);
    return true;
  }
} catch {}
      return true;
    }

    // next>0 且当前不存在：必须 addItem
    if (curQty <= 0) {
      if (typeof api.addItem === "function") {
        try {
          api.addItem(normalizedItem || { id: pid }, next);
          return true;
        } catch {}
      }
      return false;
    }

    // 已存在：优先 setQty/updateQty
    try {
      if (typeof api.setQty === "function") {
        api.setQty(pid, next);
        return true;
      }
      if (typeof api.updateQty === "function") {
        api.updateQty(pid, next);
        return true;
      }
      if (typeof api.changeQty === "function") {
  const delta = next - curQty; // ✅ changeQty 一般要增量
  if (delta !== 0) api.changeQty(pid, delta);
  return true;
}
      if (typeof api.setItemQty === "function") {
        api.setItemQty(pid, next);
        return true;
      }
    } catch {}

    // 兜底差量
    const delta = next - curQty;
    if (delta === 0) return true;

    if (delta > 0) {
      if (typeof api.addItem === "function") {
        try {
          api.addItem(normalizedItem || { id: pid }, delta);
          return true;
        } catch {}
      }
      return false;
    }

    // 减少：尽量 removeOne/decrease
    const steps = Math.abs(delta);
    for (let i = 0; i < steps; i++) {
      try {
        if (typeof api.decreaseItem === "function") api.decreaseItem(pid, 1);
        else if (typeof api.removeOne === "function") api.removeOne(pid);
        else if (typeof api.addItem === "function") api.addItem({ id: pid }, -1);
      } catch {}
    }
    return true;
  }

  // -----------------------
  // Badge（与首页一致：min(cartQty, card.__maxQty)）
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
  // 动作区渲染（加入购物车 ↔ 黑框）
  // -----------------------
  function renderCardAction(card) {
  if (!card) return;
  const pid = String(card.dataset.cartPid || "").trim();
  if (!pid) return;

  const api = getCartApi();
  const qty = Math.max(
    0,
    Math.floor(
      Number((api && typeof api.getQty === "function" ? api.getQty(pid) : getCartQty(pid)) || 0)
    )
  );

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
    document.querySelectorAll(".product-card[data-cart-pid]").forEach((card) => {
      renderCardAction(card);
    });
  }

  // -------------------------------------------------------
  // 3) 单卖/整箱拆卡（公共）
  // -------------------------------------------------------
  FBCard.expand = function expandProductsWithVariants(list) {
    const out = [];
    const arr = Array.isArray(list) ? list : [];

    for (const p of arr) {
      const productId = String(p?._id || p?.id || "").trim();
      const variants = Array.isArray(p?.variants) ? p.variants : [];

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
  };

  // -------------------------------------------------------
  // 4) 卡片 HTML 模板（与首页结构一致）
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

    // ✅ 库存 maxQty（唯一口径）
    const stockUnits = getStockUnits(p);
    let maxQty = variantKey === "single" ? stockUnits : Math.floor(stockUnits / unitCount);
    if (Number(limitQty) > 0) {
      const lim = Math.max(0, Math.floor(Number(limitQty)));
      maxQty = Math.max(0, Math.min(maxQty, lim));
    }

    article.__stockUnits = stockUnits;
    article.__maxQty = maxQty;

    const maxText = unitCount > 1 ? `仅剩 ${Math.max(0, maxQty)} 箱` : `仅剩 ${Math.max(0, maxQty)}`;

    // ✅ normalizedItem（给统一 setCartQty / addItem 用）
    const normalized = {
      id: pid, // cartKey（productId::variantKey）
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

    // ✅ 卡片 HTML（结构与首页一致）
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

    // ✅ 只允许图片&名字跳详情
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

    // ✅ overlay 收藏占位（保持与首页一致）
    const favBtn = article.querySelector(".overlay-btn.fav");
    if (favBtn) {
      favBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        alert("收藏功能后续接入，这里先做占位提示。");
      });
    }

    // ✅ 卡片提供刷新库存入口（供轮询调用）
    article.__refreshStockUI = function (newStockUnits) {
      const su = Math.max(0, Math.floor(Number(newStockUnits || 0) || 0));
      article.__stockUnits = su;

      let newMax = variantKey === "single" ? su : Math.floor(su / unitCount);
      if (Number(limitQty) > 0) {
        const lim = Math.max(0, Math.floor(Number(limitQty)));
        newMax = Math.max(0, Math.min(newMax, lim));
      }
      article.__maxQty = newMax;

      // 更新 hint & 按钮禁用
      const hint = article.querySelector("[data-qty-hint]");
      if (hint) {
        const txt = unitCount > 1 ? `仅剩 ${Math.max(0, newMax)} 箱` : `仅剩 ${Math.max(0, newMax)}`;
        hint.textContent = newMax <= 0 ? "已售罄" : txt;
      }

      const overlayAdd = article.querySelector('.overlay-btn.add[data-add-pid]');
      const fixedAdd = article.querySelector('.product-add-fixed[data-add-pid]');
      if (overlayAdd) overlayAdd.disabled = newMax <= 0;
      if (fixedAdd) fixedAdd.disabled = newMax <= 0;

      // 动作区 & 徽章兜底
      renderCardAction(article);
      scheduleBadgeSync();
    };

    // 初次渲染：根据购物车数量决定显示
    renderCardAction(article);

    return article;
  };

  // -------------------------------------------------------
  // 5) renderGrid：其它页面直接调用
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

    arr.forEach((p) => {
      gridEl.appendChild(FBCard.createCard(p, badgeText));
    });

    // 初次兜底同步
    setTimeout(() => {
      try {
        scheduleBadgeSync();
        renderAllCardsAction();
      } catch {}
    }, 0);
  };

  // -------------------------------------------------------
  // 6) 全局事件委托（加购/黑框 +/- / overlay 加购）
  // -------------------------------------------------------
  let __bound = false;

  FBCard.ensureGlobalBindings = function ensureGlobalBindings() {
    if (__bound) return;
    __bound = true;

    // ✅ 全站购物车更新事件（兼容你可能存在的两种名字）
    function emitCartUpdated(pid, delta) {
      try {
        window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta } }));
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent("freshbuy:cart_updated", { detail: { pid, delta } }));
      } catch {}
    }

    // 点击事件委托：底部加入/overlay加入/黑框+-
    document.addEventListener("click", (e) => {
      const addOnlyBtn = e.target.closest(".product-add-fixed[data-add-only]");
      const overlayAddBtn = e.target.closest(".overlay-btn.add[data-add-pid]");
      const minusBtn = e.target.closest("[data-qty-minus]");
      const plusBtn = e.target.closest("[data-qty-plus]");

      if (!addOnlyBtn && !overlayAddBtn && !minusBtn && !plusBtn) return;

      const card = e.target.closest(".product-card");
      if (!card) return;

      // 阻止触发详情跳转
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

      // 加入购物车（底部）=> 变成 1
      if (addOnlyBtn) {
        if (cap <= 0) return;
        const ok = setCartQty(pid, 1, normalizedItem);
        if (!ok) return;

        emitCartUpdated(pid, 1);
        renderInstant(1);
        scheduleBadgeSync();
        return;
      }

      // overlay 加购 => +1
      if (overlayAddBtn) {
        if (cap <= 0) return;
        const next = Math.min(cap, cur + 1);
        setCartQty(pid, next, normalizedItem);

        emitCartUpdated(pid, 1);
        renderInstant(next);
        scheduleBadgeSync();
        return;
      }

      // -
      if (minusBtn) {
        const next = Math.max(0, cur - 1);
        setCartQty(pid, next, normalizedItem);

        emitCartUpdated(pid, -1);
        renderInstant(next);
        scheduleBadgeSync();
        return;
      }

      // +
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

    // 购物车更新：刷新徽章 + 动作区
    window.addEventListener("freshbuy:cartUpdated", () => {
      scheduleBadgeSync();
      renderAllCardsAction();
    });
    window.addEventListener("freshbuy:cart_updated", () => {
      scheduleBadgeSync();
      renderAllCardsAction();
    });

    // 多标签页同步
    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (String(e.key).toLowerCase().includes("cart")) {
        scheduleBadgeSync();
        renderAllCardsAction();
      }
    });
  };

  // -------------------------------------------------------
  // 7) 库存轮询刷新（全站统一）
  // -------------------------------------------------------
  let __pollTimer = null;

  FBCard.startStockPolling = function startStockPolling(ms) {
    const interval = Math.max(3000, Number(ms || FBCard.config.stockRefreshMs || 15000) || 15000);
    if (__pollTimer) return; // 已开启

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

          if (typeof card.__refreshStockUI === "function") {
            card.__refreshStockUI(su);
          } else {
            // 极端兜底
            card.__stockUnits = su;
          }
        });

        scheduleBadgeSync();
      } catch (e) {
        console.warn("FBCard stock polling failed:", e);
      }
    }

    // 立即跑一次
    refreshStockAndCards();
    __pollTimer = setInterval(refreshStockAndCards, interval);
  };

  FBCard.stopStockPolling = function stopStockPolling() {
    if (__pollTimer) clearInterval(__pollTimer);
    __pollTimer = null;
  };

  // -------------------------------------------------------
  // 8) 小助手：从接口数据里取数组（方便页面直接用）
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

  // 默认：不自动绑定/不自动轮询（由页面决定）
})();
// ✅ expose to window for all pages (DailySpecial / others)
try {
  // 你渲染函数如果叫别的名，把 renderProductCardFn 换成你真实函数名
  const renderProductCardFn =
    typeof renderProductCard === "function"
      ? renderProductCard
      : (typeof window.renderProductCard === "function" ? window.renderProductCard : null);

  if (renderProductCardFn) {
    window.renderProductCard = renderProductCardFn;
    window.ProductCardRenderer = window.ProductCardRenderer || {};
    window.ProductCardRenderer.render = renderProductCardFn;
  } else {
    console.warn("⚠️ product_card_renderer.js loaded but no renderProductCard function found");
  }
} catch (e) {
  console.warn("⚠️ expose renderProductCard failed:", e);
}
