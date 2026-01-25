// user/assets/js/product_detail.js
// ======================================================
// 详情页：
// ✅ 点击 + = 加购 1
// ✅ 点击 - = 减购 1
// ✅ 点击胶囊中间 = 加购 currentQty 件（可选）
// ✅ 不自动打开抽屉，只更新徽章/文字
// ======================================================

(function () {
  let currentProduct = null;
  let currentQty = 1;

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

  function getImageUrl(p) {
    if (!p) return "";
    const cands = [
      p.image,
      p.img,
      p.imageUrl,
      Array.isArray(p.images) ? p.images[0] : "",
      Array.isArray(p.pics) ? p.pics[0] : "",
    ].filter(Boolean);
    return cands.length ? String(cands[0]) : "";
  }

  // =========================
  // 购物车：读 qty
  // =========================
  function getQtyInCartByPid(pid) {
    const id = String(pid || "");
    if (!id) return 0;

    try {
      if (window.Cart && typeof window.Cart.getQty === "function") return toNum(window.Cart.getQty(id));
      if (window.Cart && typeof window.Cart.getItemQty === "function") return toNum(window.Cart.getItemQty(id));
    } catch (e) {}

    try {
      if (window.cart && window.cart[id]) return toNum(window.cart[id].qty);
    } catch (e) {}

    const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const data = JSON.parse(raw);

        if (data && typeof data === "object" && !Array.isArray(data)) {
          const v = data[id];
          if (typeof v === "number") return toNum(v);
          if (v && typeof v === "object") return toNum(v.qty ?? v.quantity ?? v.count ?? 0);
        }

        if (Array.isArray(data)) {
          const found = data.find((it) => String(it?.id || it?.pid || it?.productId || it?._id || "") === id);
          if (found) return toNum(found.qty ?? found.quantity ?? found.count ?? 0);
        }
      } catch (e) {}
    }
    return 0;
  }

  function calcTotalCartQty() {
    try {
      if (window.Cart && typeof window.Cart.getTotalQty === "function") return toNum(window.Cart.getTotalQty());
    } catch (e) {}

    try {
      if (window.cart && typeof window.cart === "object") {
        let sum = 0;
        Object.keys(window.cart).forEach((k) => (sum += toNum(window.cart[k]?.qty)));
        return sum;
      }
    } catch (e) {}

    const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);

        if (data && typeof data === "object" && !Array.isArray(data)) {
          let sum = 0;
          Object.keys(data).forEach((pid) => {
            const v = data[pid];
            if (typeof v === "number") sum += toNum(v);
            else sum += toNum(v?.qty ?? v?.quantity ?? v?.count ?? 0);
          });
          return sum;
        }

        if (Array.isArray(data)) {
          let sum = 0;
          data.forEach((it) => (sum += toNum(it?.qty ?? it?.quantity ?? it?.count ?? 0)));
          return sum;
        }
      } catch (e) {}
    }
    return 0;
  }

  function refreshTopCartBadge() {
    const el = document.getElementById("cartCount") || document.getElementById("cartCountBadge");
    if (!el) return;
    const n = calcTotalCartQty();
    el.textContent = String(n);
    el.style.display = n > 0 ? "inline-flex" : "none";
  }

  function renderDetailBadge(pid) {
    const badge = document.getElementById("detailCartBadge");
    if (!badge) return;
    const qtyInCart = getQtyInCartByPid(pid);
    if (qtyInCart > 0) {
      badge.textContent = String(qtyInCart);
      badge.style.display = "inline-flex";
    } else {
      badge.textContent = "0";
      badge.style.display = "none";
    }
  }

  // =========================
  // ✅ 统一构造 cart 商品对象
  // =========================
  function buildProductForCart(p) {
    const pid = getPid(p);
    let finalPrice = 0;

    if (p.specialEnabled && typeof p.specialPrice === "number") finalPrice = Number(p.specialPrice) || 0;
    else if (typeof p.price === "number") finalPrice = Number(p.price) || 0;
    else if (typeof p.originPrice === "number") finalPrice = Number(p.originPrice) || 0;

    return {
      id: pid,
      name: p.name || "商品",
      price: finalPrice,
      priceNum: finalPrice,
      isDeal: !!(p.isDeal || p.specialEnabled || p.isSpecial || (p.tag || "").includes("爆品")),
      tag: p.tag || "",
      type: p.type || "",
      isSpecial: !!p.isSpecial,
    };
  }

  // =========================
  // ✅ 加购 1（不打开抽屉）
  // =========================
  function addOne(p) {
    const pid = getPid(p);
    const productForCart = buildProductForCart(p);

    if (window.Cart && typeof window.Cart.addItem === "function") {
      window.Cart.addItem(productForCart, 1);
    } else if (typeof window.addToCart === "function") {
      window.addToCart(pid);
    } else {
      alert("购物车模块未加载");
      return;
    }

    renderDetailBadge(pid);
    refreshTopCartBadge();
    refreshCenterText();
  }

  // =========================
  // ✅ 减购 1（不打开抽屉）
  // =========================
  function decOne(p) {
    const pid = getPid(p);
    if (!pid) return;

    const cur = getQtyInCartByPid(pid);
    if (cur <= 0) {
      renderDetailBadge(pid);
      refreshTopCartBadge();
      refreshCenterText();
      return;
    }

    // 1) 优先用 Cart 的 remove/dec 方法（你 cart.js 里可能不同命名）
    try {
      if (window.Cart) {
        if (typeof window.Cart.removeItem === "function") {
          window.Cart.removeItem(pid, 1);
        } else if (typeof window.Cart.decItem === "function") {
          window.Cart.decItem(pid, 1);
        } else if (typeof window.Cart.decreaseItem === "function") {
          window.Cart.decreaseItem(pid, 1);
        } else if (typeof window.Cart.setQty === "function") {
          window.Cart.setQty(pid, Math.max(0, cur - 1));
        } else if (typeof window.Cart.updateQty === "function") {
          window.Cart.updateQty(pid, Math.max(0, cur - 1));
        } else {
          // 没有减法 API，就走 localStorage 兜底（尽量不碰 cart.js）
          fallbackDecByStorage(pid);
        }
      } else {
        fallbackDecByStorage(pid);
      }
    } catch (e) {
      fallbackDecByStorage(pid);
    }

    renderDetailBadge(pid);
    refreshTopCartBadge();
    refreshCenterText();
  }

  // ✅ 兜底：直接改 localStorage（只有当 Cart 没提供减法 API 才用）
  function fallbackDecByStorage(pid) {
    const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object") continue;

        // object-map
        if (!Array.isArray(data) && data[pid]) {
          const v = data[pid];
          const cur = typeof v === "number" ? toNum(v) : toNum(v?.qty ?? v?.quantity ?? v?.count ?? 0);
          const next = Math.max(0, cur - 1);

          if (typeof v === "number") data[pid] = next;
          else if (v && typeof v === "object") v.qty = next;

          if (next === 0) delete data[pid];
          localStorage.setItem(key, JSON.stringify(data));
          return;
        }

        // array
        if (Array.isArray(data)) {
          const idx = data.findIndex((it) => String(it?.id || it?.pid || it?.productId || it?._id || "") === pid);
          if (idx >= 0) {
            const it = data[idx];
            const cur = toNum(it?.qty ?? it?.quantity ?? it?.count ?? 0);
            const next = Math.max(0, cur - 1);
            if ("qty" in it) it.qty = next;
            else if ("quantity" in it) it.quantity = next;
            else it.qty = next;

            if (next === 0) data.splice(idx, 1);
            localStorage.setItem(key, JSON.stringify(data));
            return;
          }
        }
      } catch (e) {}
    }
  }

  // =========================
  // 中间文字
  // =========================
  function refreshCenterText() {
    const elMain = document.getElementById("detailCartMainText");
    const elSub = document.getElementById("detailCartSubText");
    if (!currentProduct) return;

    const pid = getPid(currentProduct);
    const qtyInCart = getQtyInCartByPid(pid);

    if (elMain) {
      if (qtyInCart > 0) {
        elMain.textContent = `已加入 ${qtyInCart} 件商品`;
        if (elSub) elSub.textContent = "点击 + / − 可直接加减购（不打开购物车）";
      } else {
        elMain.textContent = `加入 ${currentQty} 件商品`;
        if (elSub) elSub.textContent = "点击 + / − 可直接加减购";
      }
    }
  }

  // =========================
  // 渲染主信息 + 图片
  // =========================
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
    else if (typeof p.originPrice === "number") currPrice = p.originPrice || 0;

    if (priceEl) priceEl.textContent = "$" + currPrice.toFixed(2);

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
      const set = Array.from(new Set(tags));
      set.forEach((t) => {
        const span = document.createElement("span");
        span.className = "detail-tag";
        span.textContent = t;
        tagsRow.appendChild(span);
      });
    }

    if (extraNoteEl) {
      if (p.tag === "爆品" || p.isSpecial || p.specialEnabled || (Array.isArray(p.labels) && p.labels.includes("特价"))) {
        extraNoteEl.textContent = "爆品日测试价：短期用来测试需求和体量，价格大概率会比附近超市便宜。";
      } else {
        extraNoteEl.textContent = "当前为日常价：大致参考周边超市正常标价，测试期不会乱涨价。";
      }
    }

    const url = getImageUrl(p);
    if (imgEl) {
      if (url) {
        imgEl.src = url;
        imgEl.style.display = "block";
        if (imgTextEl) imgTextEl.style.display = "none";
      } else {
        imgEl.style.display = "none";
        if (imgTextEl) {
          imgTextEl.style.display = "inline";
          imgTextEl.textContent = "暂无商品图片 · " + (p.name || "");
        }
      }
    }
  }

  // =========================
  // ✅ 绑定 +/-：直接加减购
  // =========================
  function bindQtyControls() {
    const minusBig = document.getElementById("btnQtyMinusBig");
    const plusBig = document.getElementById("btnQtyPlusBig");

    if (minusBig) {
      minusBig.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentProduct) return;
        decOne(currentProduct);
      });
    }

    if (plusBig) {
      plusBig.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentProduct) return;
        addOne(currentProduct);
      });
    }

    // 初次刷新
    refreshCenterText();
    renderDetailBadge(currentProduct ? getPid(currentProduct) : "");
    refreshTopCartBadge();
  }

  // =========================
  // ✅ 胶囊中间点击：按 currentQty 加购（你要的话保留）
  // =========================
  function bindAddToCartButton() {
    const bigBtn = document.getElementById("btnAddToCartDetail");
    if (!bigBtn) return;

    bigBtn.addEventListener("click", (e) => {
      // 点 +/- 已经处理过，不走这里
      if (e.target && e.target.closest && e.target.closest("#btnQtyMinusBig, #btnQtyPlusBig")) return;
      if (!currentProduct) return;

      // 中间点击：加 currentQty（默认 1）
      const pid = getPid(currentProduct);
      const productForCart = buildProductForCart(currentProduct);

      if (window.Cart && typeof window.Cart.addItem === "function") {
        window.Cart.addItem(productForCart, currentQty);
      } else if (typeof window.addToCart === "function") {
        for (let i = 0; i < currentQty; i += 1) window.addToCart(pid);
      } else {
        alert("购物车模块未加载");
        return;
      }

      currentQty = 1;
      renderDetailBadge(pid);
      refreshTopCartBadge();
      refreshCenterText();
    });
  }

  // =========================
  // 推荐区
  // =========================
  function createRecommendCard(p, isTop) {
    const card = document.createElement("div");
    card.className = "detail-recommend-card";
    const pid = getPid(p);
    const imgUrl = getImageUrl(p) || `https://picsum.photos/seed/${encodeURIComponent(pid || "fb")}/640/400`;

    const currPrice =
      typeof p.price === "number" ? p.price : typeof p.specialPrice === "number" ? p.specialPrice : Number(p.originPrice || 0) || 0;
    const origin = typeof p.originPrice === "number" ? p.originPrice : null;

    card.innerHTML = `
      <div class="detail-recommend-img-wrap">
        <img class="detail-recommend-img" src="${imgUrl}" alt="${p.name || ""}" />
        ${isTop ? '<div class="detail-recommend-top-badge">TOP1</div>' : ""}
      </div>
      <div class="detail-recommend-body">
        <div class="detail-recommend-name">${p.name || ""}</div>
        <div class="detail-recommend-desc">${p.desc || ""}</div>
        <div class="detail-recommend-price-row">
          <span class="detail-recommend-price">$${currPrice.toFixed(2)}</span>
          ${origin && origin > currPrice ? `<span class="detail-recommend-origin">$${origin.toFixed(2)}</span>` : ""}
        </div>
        <div class="detail-recommend-bottom-row">
          <button type="button" class="detail-recommend-fav-btn">☆ 收藏</button>
          <button type="button" class="detail-recommend-add-btn" data-rec-add-id="${pid}">加入购物车</button>
        </div>
      </div>
    `;

    card.querySelector(".detail-recommend-fav-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      alert("收藏功能后续接入，占位提示。");
    });

    card.querySelector("[data-rec-add-id]").addEventListener("click", (e) => {
      e.stopPropagation();
      addOne(p); // ✅ 推荐区加购 1
    });

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
      setTimeout(update, 250);
    };
    next.onclick = () => {
      viewport.scrollBy({ left: step, behavior: "smooth" });
      setTimeout(update, 250);
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

    if (currentProduct) {
      const cid = getPid(currentProduct);
      list = list.filter((p) => getPid(p) !== cid);
    }

    const recommend = list.slice(0, 8);
    track.innerHTML = "";
    recommend.forEach((p, idx) => track.appendChild(createRecommendCard(p, idx === 0)));
    bindRecommendArrows();
  }

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

    const list = Array.isArray(window.allProducts) ? window.allProducts : [];
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
    bindQtyControls();
    bindAddToCartButton();
    renderRecommendList();

    // 初次同步徽章
    renderDetailBadge(getPid(currentProduct));
    refreshTopCartBadge();
    refreshCenterText();

    // 购物车变化时同步（兜底）
    window.addEventListener("freshbuy:cartUpdated", () => {
      renderDetailBadge(getPid(currentProduct));
      refreshTopCartBadge();
      refreshCenterText();
    });
    window.addEventListener("storage", () => {
      renderDetailBadge(getPid(currentProduct));
      refreshTopCartBadge();
      refreshCenterText();
    });
  }

  window.addEventListener("DOMContentLoaded", initDetailPage);
})();
