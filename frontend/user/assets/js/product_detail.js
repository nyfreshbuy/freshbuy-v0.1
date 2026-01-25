// assets/js/product_detail.js
// ======================================================
// 商品详情页逻辑（依赖 /api/products-simple + assets/js/cart.js）
// ✅ 目标：点击大胶囊只加购，不打开右侧抽屉；胶囊徽章显示该商品在购物车中的数量
// ✅ 修复：详情页商品总是同一个（缺少/错误 id 时不再默认 list[0]）
// ✅ 修复：DB 商品 _id 兼容（推荐区跳转/加购/购物车数量都使用统一 pid）
// ======================================================

(function () {
  let currentProduct = null;
  let currentQty = 1;

  // -------- 工具：取 URL 参数 --------
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search || "");
    return params.get(name);
  }

  // ✅ 统一取商品ID（兼容 DB _id / 老 id / sku / name 兜底）
  function getPid(p) {
    return String(p?._id || p?.id || p?.sku || p?.name || "");
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // ======================================================
  // ✅ 读取“当前商品在购物车中的数量”（适配多种 cart.js 结构）
  // ======================================================
  function getQtyInCartByPid(pid) {
    const id = String(pid || "");
    if (!id) return 0;

    // A) 新版：window.Cart.getQty(cartKey) 或 getItemQty
    try {
      if (window.Cart && typeof window.Cart.getQty === "function") {
        const q = window.Cart.getQty(id);
        return toNum(q);
      }
      if (window.Cart && typeof window.Cart.getItemQty === "function") {
        const q = window.Cart.getItemQty(id);
        return toNum(q);
      }
    } catch (e) {}

    // B) 你原来写的旧结构：window.cart[pid] = { qty }
    try {
      if (window.cart && window.cart[id]) {
        return toNum(window.cart[id].qty);
      }
    } catch (e) {}

    // C) localStorage：尝试常见 key，结构可能是对象或数组
    const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const data = JSON.parse(raw);

        // 1) 对象：{ pid: {qty}, ... } 或 { pid: qty }
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const v = data[id];
          if (typeof v === "number") return toNum(v);
          if (v && typeof v === "object") {
            if (typeof v.qty === "number") return toNum(v.qty);
            if (typeof v.quantity === "number") return toNum(v.quantity);
            if (typeof v.count === "number") return toNum(v.count);
          }
        }

        // 2) 数组：[{id/pid/productId, qty/quantity, ...}, ...]
        if (Array.isArray(data)) {
          const found = data.find((it) => {
            const pid2 = String(it?.id || it?.pid || it?.productId || it?._id || "");
            return pid2 === id;
          });
          if (found) {
            return toNum(found.qty ?? found.quantity ?? found.count ?? 0);
          }
        }
      } catch (e) {}
    }

    return 0;
  }

  // ✅ 更新胶囊右上角徽章：显示“该商品在购物车中的数量”
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

  // -------- 渲染顶部主信息 --------
  function renderDetailMain(p) {
    const titleEl = document.getElementById("detailTitle");
    const descEl = document.getElementById("detailDesc");
    const priceEl = document.getElementById("detailPrice");
    const originEl = document.getElementById("detailOrigin");
    const tagsRow = document.getElementById("detailTagRow");
    const extraNoteEl = document.getElementById("detailExtraNote");
    const crumbEl = document.getElementById("crumbProductName");
    const imgTextEl = document.getElementById("detailImageText");

    if (crumbEl) crumbEl.textContent = p.name || "商品详情";
    if (titleEl) titleEl.textContent = p.name || "未命名商品";
    if (descEl) descEl.textContent = p.desc || "";

    // 当前销售价：优先用 price，其次 specialPrice，再次 originPrice
    let currPrice = 0;
    if (typeof p.price === "number") currPrice = p.price;
    else if (typeof p.specialPrice === "number") currPrice = p.specialPrice;
    else if (typeof p.originPrice === "number") currPrice = p.originPrice || 0;

    if (priceEl) priceEl.textContent = "$" + currPrice.toFixed(2);

    // 原价（有且大于现价才划线展示）
    if (originEl) {
      const origin = typeof p.originPrice === "number" ? p.originPrice : null;
      if (origin && origin > currPrice) originEl.textContent = "$" + origin.toFixed(2);
      else originEl.textContent = "";
    }

    // 标签行：tag + labels
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

    // 额外说明
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

    // 左边图片占位文字
    if (imgTextEl) {
      imgTextEl.textContent = "商品图占位 · " + (p.name || "");
    }
  }

  // -------- 更新数量 UI（大按钮 + 旧的数字显示） + ✅ 更新胶囊徽章 --------
  function refreshQtyUI() {
    // 旧版小数字（如果页面有）
    const smallValEl = document.getElementById("detailQtyVal");
    if (smallValEl) smallValEl.textContent = String(currentQty);

    const mainTextEl = document.getElementById("detailCartMainText");
    const subTextEl = document.getElementById("detailCartSubText");
    if (!mainTextEl) {
      // 即使没有主文字，也要更新徽章
      if (currentProduct) renderDetailBadge(getPid(currentProduct));
      return;
    }

    const pid = currentProduct ? getPid(currentProduct) : "";
    const qtyInCart = pid ? getQtyInCartByPid(pid) : 0;

    if (qtyInCart > 0) {
      mainTextEl.textContent = `已加入 ${qtyInCart} 件商品`;
      if (subTextEl) subTextEl.textContent = "可继续加购（不会自动打开购物车）";
    } else {
      mainTextEl.textContent = `加入 ${currentQty} 件商品`;
      if (subTextEl) subTextEl.textContent = "点击中间区域加入购物车";
    }

    // ✅ 同步胶囊徽章（显示该商品在购物车里的件数）
    if (pid) renderDetailBadge(pid);
  }

  // -------- 数量加减（支持大胶囊 + 旧按钮） --------
  function bindQtyControls() {
    const minusBig = document.getElementById("btnQtyMinusBig");
    const plusBig = document.getElementById("btnQtyPlusBig");
    const minusOld = document.getElementById("btnQtyMinus");
    const plusOld = document.getElementById("btnQtyPlus");

    function decQty(e) {
      if (e) e.stopPropagation();
      if (currentQty > 1) {
        currentQty -= 1;
        refreshQtyUI();
      }
    }

    function incQty(e) {
      if (e) e.stopPropagation();
      currentQty += 1;
      refreshQtyUI();
    }

    if (minusBig) minusBig.addEventListener("click", decQty);
    if (plusBig) plusBig.addEventListener("click", incQty);
    if (minusOld) minusOld.addEventListener("click", decQty);
    if (plusOld) plusOld.addEventListener("click", incQty);

    refreshQtyUI();
  }

  // -------- 加入购物车（点击整个大胶囊；旧按钮也支持） --------
  function bindAddToCartButton() {
    const bigBtn = document.getElementById("btnAddToCartDetail");
    const oldPrimaryBtn = document.getElementById("btnAddToCartPrimary"); // 旧按钮

    function doAdd() {
      if (!currentProduct) return;

      // 统一计算价格：优先特价，其次 price，再次 originPrice
      let finalPrice = 0;
      if (currentProduct.specialEnabled && typeof currentProduct.specialPrice === "number") {
        finalPrice = Number(currentProduct.specialPrice) || 0;
      } else if (typeof currentProduct.price === "number") {
        finalPrice = Number(currentProduct.price) || 0;
      } else if (typeof currentProduct.originPrice === "number") {
        finalPrice = Number(currentProduct.originPrice) || 0;
      }

      const pid = getPid(currentProduct);

      const productForCart = {
        id: pid,
        name: currentProduct.name || "商品",
        price: finalPrice,
        isDeal: !!(
          currentProduct.isDeal ||
          currentProduct.specialEnabled ||
          currentProduct.isSpecial ||
          (currentProduct.tag || "").includes("爆品")
        ),
        tag: currentProduct.tag || "",
        type: currentProduct.type || "",
        isSpecial: !!currentProduct.isSpecial,
        priceNum: finalPrice,
      };

      // ✅ 优先使用新 Cart
      if (window.Cart && typeof window.Cart.addItem === "function") {
        window.Cart.addItem(productForCart, currentQty);
        currentQty = 1;

        // ✅ 不打开抽屉：只更新文字 + 徽章
        refreshQtyUI();
        return;
      }

      // ✅ 兼容旧 addToCart：必须传 pid（兼容 _id）
      if (typeof window.addToCart === "function") {
        for (let i = 0; i < currentQty; i += 1) window.addToCart(pid);
        currentQty = 1;

        // ✅ 不打开抽屉：只更新文字 + 徽章
        refreshQtyUI();
        return;
      }

      alert("购物车模块未加载");
    }

    if (bigBtn) bigBtn.addEventListener("click", doAdd);
    if (oldPrimaryBtn) oldPrimaryBtn.addEventListener("click", doAdd);
  }

  // -------- 收藏按钮（占位） --------
  function bindFavButton() {
    const favBtn = document.getElementById("btnDetailFav");
    if (!favBtn) return;
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      alert("收藏功能后续接入，这个先做占位提示。");
    });
  }

  // ======================================================
  // 推荐区：Weee 风格卡片 + 左右滑动
  // ======================================================
  function createRecommendCard(p, isTop) {
    const card = document.createElement("div");
    card.className = "detail-recommend-card";

    const pid = getPid(p);

    const imgUrl =
      p.image && typeof p.image === "string"
        ? p.image
        : `https://picsum.photos/seed/${encodeURIComponent(pid || "fb")}/640/400`;

    const currPrice =
      typeof p.price === "number"
        ? p.price
        : typeof p.specialPrice === "number"
        ? p.specialPrice
        : Number(p.originPrice || 0) || 0;

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

    // 收藏按钮（占位）
    const favBtn = card.querySelector(".detail-recommend-fav-btn");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      alert("收藏功能后续接入，这个先做占位提示。");
    });

    // 加入购物车（推荐卡：加 1，不开抽屉）
    const addBtn = card.querySelector("[data-rec-add-id]");
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      let finalPrice = 0;
      if (p.specialEnabled && typeof p.specialPrice === "number") {
        finalPrice = Number(p.specialPrice) || 0;
      } else if (typeof p.price === "number") {
        finalPrice = Number(p.price) || 0;
      } else if (typeof p.originPrice === "number") {
        finalPrice = Number(p.originPrice) || 0;
      }

      const productForCart = {
        id: pid,
        name: p.name || "商品",
        price: finalPrice,
        priceNum: finalPrice,
        isDeal: !!(
          p.isDeal ||
          p.specialEnabled ||
          p.isSpecial ||
          (p.tag || "").includes("爆品")
        ),
        tag: p.tag || "",
        type: p.type || "",
        isSpecial: !!p.isSpecial,
      };

      if (window.Cart && typeof window.Cart.addItem === "function") {
        window.Cart.addItem(productForCart, 1);
        // ✅ 如果当前详情页商品就是这个 pid，也刷新徽章/文字
        if (currentProduct && getPid(currentProduct) === pid) refreshQtyUI();
        return;
      }

      if (typeof window.addToCart === "function") {
        window.addToCart(pid);
        if (currentProduct && getPid(currentProduct) === pid) refreshQtyUI();
        return;
      }

      alert("购物车模块未加载");
    });

    // 整卡点击跳详情
    card.addEventListener("click", () => {
      if (!pid) return;
      window.location.href = "product_detail.html?id=" + encodeURIComponent(pid);
    });

    return card;
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
  }

  function bindRecommendArrows() {
    const viewport = document.querySelector(".detail-recommend-viewport");
    const prev = document.getElementById("recPrev");
    const next = document.getElementById("recNext");

    if (!viewport || !prev || !next) return;

    const step = viewport.clientWidth * 0.8 || 300;

    const updateArrowDisabled = () => {
      const maxScroll = viewport.scrollWidth - viewport.clientWidth - 2;
      prev.disabled = viewport.scrollLeft <= 0;
      next.disabled = viewport.scrollLeft >= maxScroll;
    };

    prev.onclick = () => {
      viewport.scrollBy({ left: -step, behavior: "smooth" });
      setTimeout(updateArrowDisabled, 300);
    };
    next.onclick = () => {
      viewport.scrollBy({ left: step, behavior: "smooth" });
      setTimeout(updateArrowDisabled, 300);
    };

    updateArrowDisabled();
  }

  // ======================================================
  // 根据 id / _id / sku / name 匹配商品
  // ======================================================
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

  // -------- 确保 allProducts 已加载（优先 /api/products-simple） --------
  async function ensureProductsLoaded() {
    if (Array.isArray(window.allProducts) && window.allProducts.length) return;

    if (typeof window.loadProducts === "function") {
      try {
        await window.loadProducts();
        if (Array.isArray(window.allProducts) && window.allProducts.length) return;
      } catch (e) {
        console.warn("详情页：调用 loadProducts 失败：", e);
      }
    }

    try {
      const res = await fetch("/api/products-simple");
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
      if (list.length) window.allProducts = list;
    } catch (e) {
      console.warn("详情页：请求 /api/products-simple 失败", e);
    }
  }

  // -------- 主初始化 --------
  async function initDetailPage() {
    const idFromUrl = getQueryParam("id");

    await ensureProductsLoaded();

    let list = Array.isArray(window.allProducts) ? window.allProducts : [];

    // ✅ 没有 id 就直接提示（不再默认 list[0]）
    if (!idFromUrl) {
      const titleEl = document.getElementById("detailTitle");
      if (titleEl) titleEl.textContent = "缺少商品ID（请从商品列表点击进入）";
      return;
    }

    let product = matchProductById(list, idFromUrl);

    if (!product && idFromUrl) {
      try {
        const res = await fetch("/api/products-simple");
        const data = await res.json();
        const apiList = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
        if (apiList.length) {
          window.allProducts = apiList;
          list = apiList;
          product = matchProductById(apiList, idFromUrl);
        }
      } catch (e) {
        console.warn("详情页：再次请求 /api/products-simple 失败", e);
      }
    }

    if (!product) {
      const titleEl = document.getElementById("detailTitle");
      if (titleEl) titleEl.textContent = "未找到该商品（可能已下架）";
      return;
    }

    currentProduct = product;
    currentQty = 1;

    console.log("详情页当前商品数据 currentProduct =", currentProduct);

    renderDetailMain(currentProduct);
    bindQtyControls();
    bindAddToCartButton();
    bindFavButton();
    renderRecommendList();

    // ✅ 初次渲染徽章
    refreshQtyUI();

    // ✅ 监听购物车变化（多种事件名兜底）
    const pid = getPid(currentProduct);
    const rerender = () => renderDetailBadge(pid);

    window.addEventListener("freshbuy:cartUpdated", rerender);
    window.addEventListener("cart:updated", rerender);
    window.addEventListener("storage", (e) => {
      // 购物车常见存储 key 变化时也刷新
      if (!e || !e.key) return;
      if (["freshbuy_cart", "freshbuyCart", "cart", "cart_items"].includes(e.key)) rerender();
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    initDetailPage();
  });
})();
