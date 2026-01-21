// frontend/user/assets/js/product_card_renderer.js
// =======================================================
// Freshbuy 全站统一商品卡渲染器（对齐首页逻辑）
// -------------------------------------------------------
// ✅ 修复整合版：
// - 修复：+/- 数量异常飙升（addItem 签名不匹配导致）
// - 兼容：addItem(item) / addItem(item, delta) / setQty/updateQty/changeQty
// - 统一：所有 qty/delta 强制转数字，避免字符串拼接
// - 防重复：renderer 初始化一次、事件绑定一次
// =======================================================

(function () {
  "use strict";

  // ✅ 防止同一页面重复加载两份 renderer（会导致事件重复或状态错乱）
  if (window.__FB_CARD_RENDERER_INITED__) {
    console.warn("⚠️ FBCard renderer already inited, skip duplicate load.");
    return;
  }
  window.__FB_CARD_RENDERER_INITED__ = true;

  const FBCard = {};
  window.FBCard = FBCard;

  // -----------------------
  // Config（可在页面覆盖）
  // -----------------------
  FBCard.config = {
    apiProductsSimple: "/api/products-simple",
    stockRefreshMs: 15000,
    detailPage: "product_detail.html",
  };

  // -----------------------
  // Utils
  // -----------------------
  function toInt(v, def = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.floor(n);
  }
  function clampInt(n, min, max) {
    const x = toInt(n, 0);
    if (x < min) return min;
    if (x > max) return max;
    return x;
  }
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
      isTrueFlag(p?.hot) ||
      hasKeyword(p, "爆品") ||
      hasKeyword(p, "爆品日") ||
      hasKeyword(p, "hot") ||
      hasKeyword(p, "hotdeal")
    );
  }
  function getStockUnits(p) {
    return Math.max(0, toInt(p?.stock ?? p?.inventory ?? 0, 0));
  }
  function getLimitQty(p) {
    const v = Number(p?.limitQty || p?.limitPerUser || p?.maxQty || p?.purchaseLimit || 0);
    return Number.isFinite(v) ? v : 0;
  }

  // -----------------------
  // Cart API
  // -----------------------
  function getCartApi() {
    return (window.FreshCart && window.FreshCart) || (window.Cart && window.Cart) || null;
  }

  function getCartSnapshot() {
    // 优先走 cart api
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

    // localStorage 兜底（找含 cart 的 key）
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

        const qty = toInt(it.qty ?? it.quantity ?? it.count ?? it.num ?? it.amount ?? it.n ?? it.q ?? 0, 0);
        if (id) map[id] = (map[id] || 0) + qty;
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

        const qty = toInt(it.qty ?? it.quantity ?? it.count ?? it.num ?? it.amount ?? it.n ?? it.q ?? 0, 0);
        if (id) map[id] = (map[id] || 0) + qty;
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
        const qty = toInt(v?.qty ?? v?.quantity ?? v?.count ?? v ?? 0, 0);
        if (id) map[id] = (map[id] || 0) + qty;
      }
    }

    return map;
  }

  function getCartQty(pid) {
    // ✅ 优先走 cart api 的 getQty（如果有）
    try {
      const api = getCartApi();
      if (api && typeof api.getQty === "function") {
        const n = toInt(api.getQty(pid), 0);
        return Math.max(0, n);
      }
    } catch {}

    const snap = getCartSnapshot();
    const map = normalizeCartToQtyMap(snap);
    return Math.max(0, toInt(map[pid] || 0, 0));
  }

  // ✅ 核心：设置购物车数量（强制兼容不同 cart.js 签名）
  function setCartQty(pid, targetQty, normalizedItem) {
    const api = getCartApi();
    if (!api) {
      alert("购物车模块暂未启用（请确认 cart.js 已加载）");
      return false;
    }

    const next = Math.max(0, toInt(targetQty, 0));
    const cur = Math.max(0, toInt(typeof api.getQty === "function" ? api.getQty(pid) : getCartQty(pid), 0));

    // next=0
    if (next === 0) {
      try {
        if (typeof api.setQty === "function") {
          api.setQty(pid, 0);
          return true;
        }
      } catch {}
      try {
        if (typeof api.removeItem === "function") {
          api.removeItem(pid);
          return true;
        }
        if (typeof api.remove === "function") {
          api.remove(pid);
          return true;
        }
      } catch {}
      return true;
    }

    // ✅ next>0 且当前不存在：必须创建条目
    // 这里是你之前出 7169 的根因：不要把 next 直接当 addItem 的第二参传进去
    if (cur <= 0) {
      const item = normalizedItem || { id: pid };

      if (typeof api.addItem === "function") {
        // 先安全地 +1
        try {
          api.addItem(item, 1);
        } catch {
          // 兼容 addItem(item) 只有一个参数
          try {
            api.addItem(item);
          } catch {
            return false;
          }
        }

        // 如果目标不是 1，再把 qty 抬到目标
        if (next > 1) {
          try {
            if (typeof api.setQty === "function") api.setQty(pid, next);
            else if (typeof api.updateQty === "function") api.updateQty(pid, next);
            else if (typeof api.changeQty === "function") api.changeQty(pid, next);
            else if (typeof api.setItemQty === "function") api.setItemQty(pid, next);
            else {
              // 最后兜底：补 (next-1) 次 +1
              for (let i = 0; i < next - 1; i++) {
                try {
                  api.addItem(item, 1);
                } catch {
                  api.addItem(item);
                }
              }
            }
          } catch {}
        }
        return true;
      }
      return false;
    }

    // ✅ 已存在：优先 setQty/updateQty
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
        api.changeQty(pid, next);
        return true;
      }
      if (typeof api.setItemQty === "function") {
        api.setItemQty(pid, next);
        return true;
      }
    } catch {}

    // 兜底差量
    const delta = next - cur;
    if (delta === 0) return true;

    const item = normalizedItem || { id: pid };

    if (delta > 0) {
      // 增加：尽量 addItem +1 多次（最兼容）
      for (let i = 0; i < delta; i++) {
        try {
          api.addItem(item, 1);
        } catch {
          try {
            api.addItem(item);
          } catch {}
        }
      }
      return true;
    }

    // 减少：尽量 decrease/removeOne；否则 addItem -1
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
  // Badge（min(cartQty, card.__maxQty)）
  // -----------------------
  function setProductBadge(pid, cartQty) {
    const els = document.querySelectorAll(`.product-qty-badge[data-pid="${pid}"]`);
    if (!els || !els.length) return;

    const raw = Math.max(0, toInt(cartQty, 0));

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
  // 动作区渲染（加入购物车 ↔ 黑框 +/-）
  // -----------------------
  function renderCardAction(card) {
    if (!card) return;
    const pid = String(card.dataset.cartPid || "").trim();
    if (!pid) return;

    const qty = Math.max(0, toInt(getCartQty(pid), 0));

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
  // 1) 单卖/整箱拆卡（公共）
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
        const unitCount = Math.max(1, toInt(v.unitCount || 1, 1));

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
  // 2) 卡片 HTML 模板（与首页结构一致）
  // -------------------------------------------------------
  FBCard.createCard = function createProductCard(p, extraBadgeText) {
    const article = document.createElement("article");
    article.className = "product-card";

    const productId = String(p.__productId || p._id || p.id || "").trim();
    const variantKey = String(p.__variantKey || "single").trim() || "single";

    article.dataset.productId = productId;
    article.dataset.variantKey = variantKey;

    const unitCount = Math.max(1, toInt(p.__unitCount || 1, 1));
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
    const specialQty = Math.max(1, toInt(p.specialQty || 1, 1));
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
      const lim = Math.max(0, toInt(limitQty, 0));
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
      isHot: isHotProduct(p),
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
            >${maxQty <= 0 ? "已售罄" : `加入购物车${limitQty > 0 ? `（限购${toInt(limitQty, 0)}）` : ""}`}</button>
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

    // overlay 收藏占位
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
      const su = Math.max(0, toInt(newStockUnits, 0));
      article.__stockUnits = su;

      let newMax = variantKey === "single" ? su : Math.floor(su / unitCount);
      if (Number(limitQty) > 0) {
        const lim = Math.max(0, toInt(limitQty, 0));
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

      renderCardAction(article);
      scheduleBadgeSync();
    };

    // 初次渲染：根据购物车数量决定显示
    renderCardAction(article);

    return article;
  };

  // -------------------------------------------------------
  // 3) renderGrid：其它页面直接调用
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
  // 4) 全局事件委托（加购/黑框 +/- / overlay 加购）
  // -------------------------------------------------------
  let __bound = false;

  FBCard.ensureGlobalBindings = function ensureGlobalBindings() {
    if (__bound) return;
    __bound = true;
    window.__FB_CARD_BINDINGS_BOUND__ = true;

    function emitCartUpdated(pid, delta) {
      try {
        window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta } }));
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent("freshbuy:cart_updated", { detail: { pid, delta } }));
      } catch {}
    }

    // ✅ 防抖：避免连点导致短时间多次触发（不是根因，但更稳）
    const clickLock = new WeakMap();
    function lockCard(card, ms = 140) {
      if (!card) return false;
      const now = Date.now();
      const last = clickLock.get(card) || 0;
      if (now - last < ms) return true;
      clickLock.set(card, now);
      return false;
    }

    document.addEventListener("click", (e) => {
      const addOnlyBtn = e.target.closest(".product-add-fixed[data-add-only]");
      const overlayAddBtn = e.target.closest(".overlay-btn.add[data-add-pid]");
      const minusBtn = e.target.closest("[data-qty-minus]");
      const plusBtn = e.target.closest("[data-qty-plus]");

      if (!addOnlyBtn && !overlayAddBtn && !minusBtn && !plusBtn) return;

      const card = e.target.closest(".product-card");
      if (!card) return;

      // ✅ 防连点
      if (lockCard(card)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const pid = String(card.dataset.cartPid || "").trim();
      if (!pid) return;

      const normalizedItem = card.__normalizedItem || { id: pid };

      const cap0 = Number(card.__maxQty);
      const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : 0;

      const cur = Math.max(0, toInt(getCartQty(pid), 0));

      function renderInstant(nextQty) {
        const q = Math.max(0, toInt(nextQty, 0));
        const qtyRow = card.querySelector("[data-qty-row]");
        const addBtn = card.querySelector(".product-add-fixed[data-add-only]");
        const qtyDisplay = card.querySelector("[data-qty-display]");

        if (addBtn) addBtn.style.display = q <= 0 ? "" : "none";
        if (qtyRow) qtyRow.style.display = q > 0 ? "flex" : "none";
        if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, q || 1));

        setProductBadge(pid, q);
      }

      // 加入购物车（底部）=> 1
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
        const next = clampInt(cur + 1, 0, cap);
        setCartQty(pid, next, normalizedItem);

        emitCartUpdated(pid, 1);
        renderInstant(next);
        scheduleBadgeSync();
        return;
      }

      // -
      if (minusBtn) {
        const next = clampInt(cur - 1, 0, cap || 999999);
        setCartQty(pid, next, normalizedItem);

        emitCartUpdated(pid, -1);
        renderInstant(next);
        scheduleBadgeSync();
        return;
      }

      // +
      if (plusBtn) {
        if (cap <= 0) return;
        const next = clampInt(cur + 1, 0, cap);
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
  // 5) 库存轮询刷新
  // -------------------------------------------------------
  let __pollTimer = null;

  FBCard.startStockPolling = function startStockPolling(ms) {
    const interval = Math.max(3000, Number(ms || FBCard.config.stockRefreshMs || 15000) || 15000);
    if (__pollTimer) return;

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
            card.__stockUnits = su;
          }
        });

        scheduleBadgeSync();
      } catch (e) {
        console.warn("FBCard stock polling failed:", e);
      }
    }

    refreshStockAndCards();
    __pollTimer = setInterval(refreshStockAndCards, interval);
  };

  FBCard.stopStockPolling = function stopStockPolling() {
    if (__pollTimer) clearInterval(__pollTimer);
    __pollTimer = null;
  };

  // -------------------------------------------------------
  // 6) extractList helper
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

// ✅ expose renderProductCard（如果你项目里另有同名函数）
try {
  const renderProductCardFn =
    typeof renderProductCard === "function"
      ? renderProductCard
      : typeof window.renderProductCard === "function"
      ? window.renderProductCard
      : null;

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
