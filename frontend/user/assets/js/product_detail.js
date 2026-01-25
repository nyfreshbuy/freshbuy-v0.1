// /user/assets/js/product_detail.js
// ======================================================
// 商品详情页逻辑（依赖 /api/products-simple + /user/assets/js/cart.js）
// ✅ 修复：主图显示
// ✅ 修复：右上角购物车徽章同步（cartCount）
// ✅ 修复：详情页胶囊徽章显示“购物车里该商品数量”
// ✅ 修复：推荐区每张卡片显示数量徽章
// ✅ 修复：+/- 直接触发加减购（逐个增减，不会一下清空）
// ✅ 规则：点击胶囊中间也 +1，不自动打开抽屉
// ======================================================

(function () {
  let currentProduct = null;

  // -------------------------
  // 工具
  // -------------------------
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search || "");
    return params.get(name);
  }

  function getPid(p) {
    return String(p?._id || p?.id || p?.sku || p?.name || "");
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // -------------------------
  // 读取当前购物车中某商品数量（兼容多种 cart.js 结构）
  // -------------------------
  const CART_KEYS = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items", "fresh_cart"];

  function readCartObjectFromStorage() {
    for (const k of CART_KEYS) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") return obj;
      } catch (e) {}
    }
    return null;
  }

  function getQtyInCart(pid) {
    if (!pid) return 0;

    // 1) 新 Cart（如果它提供 getQty / getState）
    try {
      if (window.Cart) {
        if (typeof window.Cart.getQty === "function") return toNum(window.Cart.getQty(pid));
        if (typeof window.Cart.getState === "function") {
          const st = window.Cart.getState() || {};
          const items = Array.isArray(st.items) ? st.items : [];
          const hit = items.find((it) => String(it.id || it.pid) === String(pid));
          if (hit) return toNum(hit.qty);
        }
      }
    } catch (e) {}

    // 2) 旧 window.cart 结构：cart[pid] = { qty }
    if (window.cart && window.cart[pid]) return toNum(window.cart[pid].qty);

    // 3) localStorage 兜底：常见结构
    const obj = readCartObjectFromStorage();
    if (obj) {
      // a) { [pid]: { qty } }
      if (obj[pid] && typeof obj[pid] === "object") return toNum(obj[pid].qty);

      // b) { items: [...] }
      if (Array.isArray(obj.items)) {
        const hit = obj.items.find((it) => String(it.id || it.pid) === String(pid));
        if (hit) return toNum(hit.qty);
      }

      // c) 直接数组
      if (Array.isArray(obj)) {
        const hit = obj.find((it) => String(it.id || it.pid) === String(pid));
        if (hit) return toNum(hit.qty);
      }
    }

    return 0;
  }

  // 统计购物车总数量（用于右上角徽章）
  function getCartTotalCount() {
    // 1) Cart API
    try {
      if (window.Cart) {
        if (typeof window.Cart.getTotalCount === "function") return toNum(window.Cart.getTotalCount());
        if (typeof window.Cart.getState === "function") {
          const st = window.Cart.getState() || {};
          const items = Array.isArray(st.items) ? st.items : [];
          return items.reduce((s, it) => s + toNum(it.qty), 0);
        }
      }
    } catch (e) {}

    // 2) window.cart
    if (window.cart && typeof window.cart === "object") {
      return Object.keys(window.cart).reduce((s, k) => s + toNum(window.cart[k]?.qty), 0);
    }

    // 3) localStorage
    const obj = readCartObjectFromStorage();
    if (obj) {
      if (obj.items && Array.isArray(obj.items)) {
        return obj.items.reduce((s, it) => s + toNum(it.qty), 0);
      }
      if (Array.isArray(obj)) return obj.reduce((s, it) => s + toNum(it.qty), 0);
      // { [pid]: { qty } }
      return Object.keys(obj).reduce((s, k) => s + toNum(obj[k]?.qty), 0);
    }

    return 0;
  }

  // -------------------------
  // 写入购物车（加1 / 减1 / 设定 qty）
  // -------------------------
  function buildProductForCart(p) {
    const pid = getPid(p);

    // 统一销售价
    let finalPrice = 0;
    if (p.specialEnabled && typeof p.specialPrice === "number") finalPrice = toNum(p.specialPrice);
    else if (typeof p.price === "number") finalPrice = toNum(p.price);
    else finalPrice = toNum(p.originPrice);

    return {
      id: pid,
      name: p.name || "商品",
      price: finalPrice,
      priceNum: finalPrice,
      tag: p.tag || "",
      type: p.type || "",
      isSpecial: !!p.isSpecial,
      isDeal: !!(p.isDeal || p.specialEnabled || p.isSpecial || String(p.tag || "").includes("爆品")),
      image: p.image || (Array.isArray(p.images) ? p.images[0] : "") || "",
    };
  }

  function setQty(pid, newQty, productForCart) {
    const qty = Math.max(0, Math.floor(toNum(newQty)));

    // ✅ 优先：能直接 setQty 的 API（最稳）
    if (window.Cart) {
      if (typeof window.Cart.setQty === "function") return window.Cart.setQty(pid, qty);
      if (typeof window.Cart.updateQty === "function") return window.Cart.updateQty(pid, qty);
      if (typeof window.Cart.changeQty === "function") return window.Cart.changeQty(pid, qty);

      // 次选：有 removeItem / addItem
      if (qty <= 0 && typeof window.Cart.removeItem === "function") return window.Cart.removeItem(pid);
      if (typeof window.Cart.addItem === "function" && productForCart) {
        const cur = getQtyInCart(pid);
        const diff = qty - cur;
        if (diff > 0) return window.Cart.addItem(productForCart, diff);
        // diff < 0 没有减法 API 时不要乱删，避免“一下清空”
      }
    }

    // ✅ 旧 API：addToCart(pid) / removeFromCart(pid)（如果存在）
    if (typeof window.addToCart === "function" && qty > getQtyInCart(pid)) {
      const diff = qty - getQtyInCart(pid);
      for (let i = 0; i < diff; i += 1) window.addToCart(pid);
      return;
    }
    if (typeof window.removeFromCart === "function" && qty < getQtyInCart(pid)) {
      const diff = getQtyInCart(pid) - qty;
      for (let i = 0; i < diff; i += 1) window.removeFromCart(pid);
      return;
    }

    // ✅ window.cart 兜底（尽量不碰，如果存在就温和处理）
    if (window.cart && typeof window.cart === "object") {
      if (qty <= 0) delete window.cart[pid];
      else {
        window.cart[pid] = window.cart[pid] || {};
        window.cart[pid].qty = qty;
      }
      if (typeof window.renderCart === "function") window.renderCart();
      return;
    }
  }

  function incOne(p) {
    const pid = getPid(p);
    if (!pid) return;
    const cur = getQtyInCart(pid);
    const productForCart = buildProductForCart(p);

    // ✅ 最常见：Cart.addItem
    if (window.Cart && typeof window.Cart.addItem === "function") {
      window.Cart.addItem(productForCart, 1);
      return;
    }

    // ✅ 兼容：addToCart
    if (typeof window.addToCart === "function") {
      window.addToCart(pid);
      return;
    }

    // ✅ 兜底：setQty
    setQty(pid, cur + 1, productForCart);
  }

  function decOne(p) {
    const pid = getPid(p);
    if (!pid) return;
    const cur = getQtyInCart(pid);
    const next = Math.max(0, cur - 1);

    // ✅ 优先：能 setQty（避免“一下清空”）
    if (window.Cart && (typeof window.Cart.setQty === "function" || typeof window.Cart.updateQty === "function" || typeof window.Cart.changeQty === "function")) {
      setQty(pid, next, null);
      return;
    }

    // ✅ 次选：如果有 decItem/removeOne
    if (window.Cart && typeof window.Cart.decItem === "function") {
      window.Cart.decItem(pid, 1);
      return;
    }
    if (window.Cart && typeof window.Cart.removeOne === "function") {
      window.Cart.removeOne(pid);
      return;
    }

    // ✅ 再次：removeFromCart 逐个减（如果它是逐个减的实现）
    if (typeof window.removeFromCart === "function") {
      window.removeFromCart(pid);
      return;
    }

    // ✅ 最后兜底：只有当 next==0 才调用 removeItem（避免“cur>1 也清空”）
    if (next <= 0 && window.Cart && typeof window.Cart.removeItem === "function") {
      window.Cart.removeItem(pid);
      return;
    }

    // ✅ window.cart 兜底
    setQty(pid, next, null);
  }

  // -------------------------
  // UI：刷新顶部徽章/胶囊徽章/推荐卡片徽章
  // -------------------------
  function refreshTopCartBadge() {
    const el = document.getElementById("cartCount") || document.getElementById("cartCountBadge");
    if (!el) return;
    const total = getCartTotalCount();
    el.textContent = String(total);
    el.style.display = total > 0 ? "inline-flex" : "none";
  }

  function refreshPillBadge() {
    const badge = document.getElementById("detailCartBadge");
    if (!badge || !currentProduct) return;
    const pid = getPid(currentProduct);
    const qty = getQtyInCart(pid);
    badge.textContent = String(qty);
    badge.style.display = qty > 0 ? "inline-flex" : "none";

    const mainTextEl = document.getElementById("detailCartMainText");
    const subTextEl = document.getElementById("detailCartSubText");
    if (mainTextEl) {
      if (qty > 0) {
        mainTextEl.textContent = `已加入 ${qty} 件商品`;
        if (subTextEl) subTextEl.textContent = "点击中间继续 +1；点 +/- 直接加减购";
      } else {
        mainTextEl.textContent = `加入 1 件商品`;
        if (subTextEl) subTextEl.textContent = "点击中间区域加入购物车";
      }
    }
  }

  function refreshRecommendBadges() {
    const nodes = document.querySelectorAll("[data-rec-badge]");
    nodes.forEach((node) => {
      const pid = node.getAttribute("data-rec-badge") || "";
      const qty = getQtyInCart(pid);
      node.textContent = String(qty);
      node.style.display = qty > 0 ? "inline-flex" : "none";
    });
  }

  function refreshAllBadges() {
    refreshTopCartBadge();
    refreshPillBadge();
    refreshRecommendBadges();
  }

  // -------------------------
  // 渲染主信息（含主图）
  // -------------------------
  function renderDetailMain(p) {
    const titleEl = document.getElementById("detailTitle");
    const descEl = document.getElementById("detailDesc");
    const priceEl = document.getElementById("detailPrice");
    const originEl = document.getElementById("detailOrigin");
    const tagsRow = document.getElementById("detailTagRow");
    const extraNoteEl = document.getElementById("detailExtraNote");
    const crumbEl = document.getElementById("crumbProductName");

    const imgEl = document.getElementById("detailImage");
    const imgTextEl = document.getElementById("detailImageText");

    if (crumbEl) crumbEl.textContent = p.name || "商品详情";
    if (titleEl) titleEl.textContent = p.name || "未命名商品";
    if (descEl) descEl.textContent = p.desc || "";

    let currPrice = 0;
    if (typeof p.price === "number") currPrice = p.price;
    else if (typeof p.specialPrice === "number") currPrice = p.specialPrice;
    else currPrice = toNum(p.originPrice);

    if (priceEl) priceEl.textContent = "$" + toNum(currPrice).toFixed(2);

    if (originEl) {
      const origin = typeof p.originPrice === "number" ? p.originPrice : null;
      if (origin && origin > currPrice) originEl.textContent = "$" + origin.toFixed(2);
      else originEl.textContent = "";
    }

    if (tagsRow) {
      tagsRow.innerHTML = "";
      const tags = [];
      if (p.tag) tags.push(p.tag);
      if (Array.isArray(p.labels)) tags.push(...p.labels);
      Array.from(new Set(tags)).forEach((t) => {
        const span = document.createElement("span");
        span.className = "detail-tag";
        span.textContent = t;
        tagsRow.appendChild(span);
      });
    }

    if (extraNoteEl) {
      if (
        p.tag === "爆品" ||
        p.isSpecial ||
        p.specialEnabled ||
        (Array.isArray(p.labels) && p.labels.includes("特价"))
      ) {
        extraNoteEl.textContent =
          "爆品日测试价：短期用来测试需求和体量，价格大概率会比附近超市便宜。";
      } else {
        extraNoteEl.textContent =
          "当前为日常价：大致参考周边超市正常标价，测试期不会乱涨价。";
      }
    }

    // ✅ 主图
    const imgUrl =
      (typeof p.image === "string" && p.image) ||
      (Array.isArray(p.images) && p.images[0]) ||
      "";

    if (imgEl) {
      if (imgUrl) {
        imgEl.src = imgUrl;
        imgEl.style.display = "block";
        if (imgTextEl) imgTextEl.style.display = "none";
      } else {
        imgEl.style.display = "none";
        if (imgTextEl) {
          imgTextEl.style.display = "block";
          imgTextEl.textContent = "商品图占位 · " + (p.name || "");
        }
      }
    }
  }

  // -------------------------
  // 绑定：胶囊点击=+1；+/- 直接加减购
  // -------------------------
  function bindPillControls() {
    const pill = document.getElementById("btnAddToCartDetail");
    const minusBtn = document.getElementById("btnQtyMinusBig");
    const plusBtn = document.getElementById("btnQtyPlusBig");

    if (minusBtn) {
      minusBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentProduct) return;
        decOne(currentProduct);
        refreshAllBadges();
      });
    }

    if (plusBtn) {
      plusBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentProduct) return;
        incOne(currentProduct);
        refreshAllBadges();
      });
    }

    if (pill) {
      pill.addEventListener("click", (e) => {
        // 点击中间区域也 +1
        if (!currentProduct) return;
        incOne(currentProduct);
        refreshAllBadges();
      });
    }
  }

  function bindFavButton() {
    const favBtn = document.getElementById("btnDetailFav");
    if (!favBtn) return;
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      alert("收藏功能后续接入，这里先做占位提示。");
    });
  }

  // -------------------------
  // 推荐区：带数量徽章 + 加购按钮
  // -------------------------
  function createRecommendCard(p, isTop) {
    const card = document.createElement("div");
    card.className = "detail-recommend-card";

    const pid = getPid(p);
    const imgUrl =
      (typeof p.image === "string" && p.image) ||
      (Array.isArray(p.images) && p.images[0]) ||
      `https://picsum.photos/seed/${encodeURIComponent(pid || "fb")}/640/400`;

    const currPrice =
      typeof p.price === "number"
        ? p.price
        : typeof p.specialPrice === "number"
        ? p.specialPrice
        : toNum(p.originPrice);

    const origin = typeof p.originPrice === "number" ? p.originPrice : null;

    card.innerHTML = `
      <div class="detail-recommend-img-wrap">
        <img class="detail-recommend-img" src="${imgUrl}" alt="${p.name || ""}" />
        ${isTop ? '<div class="detail-recommend-top-badge">TOP1</div>' : ""}
        <!-- ✅ 推荐卡数量徽章 -->
        <span class="rec-badge" data-rec-badge="${pid}" style="
          position:absolute; right:10px; top:10px;
          min-width:22px; height:22px; padding:0 6px;
          border-radius:999px; background:#ef4444; color:#fff;
          font-size:12px; font-weight:800; display:none;
          align-items:center; justify-content:center;
          box-shadow:0 10px 18px rgba(15,23,42,0.25);
        ">0</span>
      </div>
      <div class="detail-recommend-body">
        <div class="detail-recommend-name">${p.name || ""}</div>
        <div class="detail-recommend-desc">${p.desc || ""}</div>
        <div class="detail-recommend-price-row">
          <span class="detail-recommend-price">$${toNum(currPrice).toFixed(2)}</span>
          ${
            origin && origin > currPrice
              ? `<span class="detail-recommend-origin">$${origin.toFixed(2)}</span>`
              : ""
          }
        </div>
        <div class="detail-recommend-bottom-row">
          <button type="button" class="detail-recommend-fav-btn">☆ 收藏</button>
          <button type="button" class="detail-recommend-add-btn" data-rec-add-id="${pid}">
            加入购物车
          </button>
        </div>
      </div>
    `;

    // 收藏占位
    card.querySelector(".detail-recommend-fav-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      alert("收藏功能后续接入，这里先做占位提示。");
    });

    // 加购（+1）
    card.querySelector("[data-rec-add-id]").addEventListener("click", (e) => {
      e.stopPropagation();
      incOne(p);
      refreshAllBadges();
    });

    // 点击卡片跳转
    card.addEventListener("click", () => {
      if (!pid) return;
      window.location.href = "product_detail.html?id=" + encodeURIComponent(pid);
    });

    return card;
  }

  function bindRecommendArrows() {
    const viewport = document.querySelector(".detail-recommend-viewport");
    const prev = document.getElementById("recPrev");
    const next = document.getElementById("recNext");

    if (!viewport || !prev || !next) return;

    const step = viewport.clientWidth * 0.8 || 300;

    const update = () => {
      const maxScroll = viewport.scrollWidth - viewport.clientWidth - 2;
      prev.disabled = viewport.scrollLeft <= 0;
      next.disabled = viewport.scrollLeft >= maxScroll;
    };

    prev.onclick = () => {
      viewport.scrollBy({ left: -step, behavior: "smooth" });
      setTimeout(update, 300);
    };
    next.onclick = () => {
      viewport.scrollBy({ left: step, behavior: "smooth" });
      setTimeout(update, 300);
    };

    update();
  }

  function renderRecommendList() {
    const track = document.getElementById("recommendList");
    if (!track) return;

    let list = Array.isArray(window.allProducts) ? window.allProducts.slice() : [];
    if (!list.length) {
      track.innerHTML = '<div class="detail-empty">暂时没有推荐商品</div>';
      return;
    }

    // 排除当前商品
    if (currentProduct) {
      const cid = getPid(currentProduct);
      list = list.filter((p) => getPid(p) !== cid);
    }

    const recommend = list.slice(0, 8);
    if (!recommend.length) {
      track.innerHTML = '<div class="detail-empty">暂时没有推荐商品</div>';
      return;
    }

    track.innerHTML = "";
    recommend.forEach((p, idx) => track.appendChild(createRecommendCard(p, idx === 0)));

    bindRecommendArrows();
    refreshRecommendBadges();
  }

  // -------------------------
  // 根据 id/_id/sku/name 匹配商品
  // -------------------------
  function matchProductById(list, rawId) {
    if (!rawId || !Array.isArray(list)) return null;
    const idStr = String(rawId);

    return (
      list.find((p) => String(p.id) === idStr) ||
      list.find((p) => String(p._id) === idStr) ||
      list.find((p) => String(p.sku) === idStr) ||
      list.find((p) => String(p.name) === idStr)
    );
  }

  async function ensureProductsLoaded() {
    if (Array.isArray(window.allProducts) && window.allProducts.length) return;

    try {
      const res = await fetch("/api/products-simple");
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
      if (list.length) window.allProducts = list;
    } catch (e) {
      console.warn("详情页：请求 /api/products-simple 失败", e);
    }
  }

  async function initDetailPage() {
    const idFromUrl = getQueryParam("id");
    await ensureProductsLoaded();

    let list = Array.isArray(window.allProducts) ? window.allProducts : [];
    if (!list.length) {
      const titleEl = document.getElementById("detailTitle");
      if (titleEl) titleEl.textContent = "暂无商品数据";
      return;
    }

    if (!idFromUrl) {
      const titleEl = document.getElementById("detailTitle");
      if (titleEl) titleEl.textContent = "缺少商品ID（请从商品列表点击进入）";
      return;
    }

    const product = matchProductById(list, idFromUrl);
    if (!product) {
      const titleEl = document.getElementById("detailTitle");
      if (titleEl) titleEl.textContent = "未找到该商品（可能已下架）";
      return;
    }

    currentProduct = product;

    renderDetailMain(currentProduct);
    bindPillControls();
    bindFavButton();
    renderRecommendList();

    // 初始刷新所有徽章
    refreshAllBadges();

    // 监听其它地方加购导致的变化（跨组件同步）
    window.addEventListener("storage", refreshAllBadges);
    window.addEventListener("freshbuy:cartUpdated", refreshAllBadges);
    document.addEventListener("freshbuy:cartUpdated", refreshAllBadges);
  }

  window.addEventListener("DOMContentLoaded", initDetailPage);
})();
