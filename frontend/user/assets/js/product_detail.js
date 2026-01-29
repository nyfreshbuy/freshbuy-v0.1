// frontend/user/assets/js/product_detail.js
// ======================================================
// 商品详情页逻辑（依赖 /api/products-simple + assets/js/cart.js）
// ✅ 不改 cart.js：详情页自己做兼容桥接
// ✅ 大胶囊：中间=+1；+/- 直接加减购；不自动打开抽屉；徽章显示该商品数量
// ✅ 推荐区：加入购物车后，推荐卡按钮也显示数量徽章（同页同步）
// ✅ 修复：iOS 点击 -/+ 冒泡导致“越按越加”
// ✅ 修复：- 只减 1，不会清空、不暴涨
// ✅ 修复：右上角购物车打不开（自动兼容 toggleCartDrawer / Cart.toggleDrawer / Cart.openDrawer）
// ✅ 主图：支持 image/images/imageUrl/imgUrl，失败显示占位文字
// ======================================================

(function () {
  let currentProduct = null;

  // -------------------------
  // 工具：URL 参数
  // -------------------------
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

  // -------------------------
  // Cart 兼容层（不改 cart.js）
  // -------------------------
  function getCartMap() {
    // 兼容你旧结构：window.cart[pid] = { qty }
    if (window.cart && typeof window.cart === "object") return window.cart;

    // 再尝试常见 key（可选）
    try {
      const keys = ["freshbuy_cart", "freshbuyCart", "cart", "cart_items"];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") return obj;
      }
    } catch (e) {}

    return {};
  }

  function getQtyInCart(pid) {
    if (!pid) return 0;

    // 新 Cart 可能有 getQty
    if (window.Cart && typeof window.Cart.getQty === "function") {
      return toNum(window.Cart.getQty(pid));
    }

    // 旧 cart map
    const m = getCartMap();
    return toNum(m?.[pid]?.qty);
  }

  function buildProductForCart(p) {
    // 统一计算价格：优先特价，其次 price，再次 originPrice
    let finalPrice = 0;
    if (p && (p.specialEnabled || p.isSpecial) && typeof p.specialPrice === "number") {
      finalPrice = toNum(p.specialPrice);
    } else if (p && typeof p.price === "number") {
      finalPrice = toNum(p.price);
    } else if (p && typeof p.originPrice === "number") {
      finalPrice = toNum(p.originPrice);
    }

    const pid = getPid(p);

    return {
  // ✅ 关键：同时带 id + productId，保证后端一定能识别
  id: pid,
  productId: String(p?._id || p?.id || pid || ""),     // 给后端优先用
  legacyProductId: String(p?.id || ""),               // 兼容旧字段

  name: p?.name || "商品",

  price: finalPrice,
  priceNum: finalPrice,

  // ✅ 税 / 押金（没有就 0）
  taxable: !!p?.taxable,
  hasTax: !!p?.taxable,
  deposit: toNum(p?.deposit || 0),

  // ✅ 规格（你现在详情页默认 single）
  variantKey: "single",
  unitCount: 1,

  isDeal: !!(
    p?.isDeal ||
    p?.specialEnabled ||
    p?.isSpecial ||
    String(p?.tag || "").includes("爆品")
  ),
  tag: p?.tag || "",
  type: p?.type || "",
  isSpecial: !!p?.isSpecial,

  image: p?.image || "",
};
} 
  function notifyCartChanged(pid) {
    try {
      if (typeof window.updateCartUI === "function") window.updateCartUI();
      if (typeof window.recalcCartTotals === "function") window.recalcCartTotals();
      window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid } }));
    } catch (e) {}
  }

  // ✅ 加 1：优先新 Cart.addItem，否则走旧 window.addToCart / 最后改 window.cart
  function addOneToCart(p) {
    const pid = getPid(p);
    if (!pid) return;

    const productForCart = buildProductForCart(p);

    // 新 Cart
    if (window.Cart && typeof window.Cart.addItem === "function") {
      window.Cart.addItem(productForCart, 1);
      notifyCartChanged(pid);
      return;
    }

    // 老 addToCart（如果存在）
    if (typeof window.addToCart === "function") {
      window.addToCart(pid);
      notifyCartChanged(pid);
      return;
    }

    // 兜底：直接改 window.cart
    const m = getCartMap();
    const now = toNum(m?.[pid]?.qty);
    m[pid] = m[pid] || {};
    m[pid].qty = now + 1;
    m[pid].name = m[pid].name || productForCart.name;
    m[pid].price = toNum(m[pid].price || productForCart.priceNum || productForCart.price || 0);
    window.cart = m;

    notifyCartChanged(pid);
  }

  // ✅ 减 1：只用 setQty/updateQty 或直接改 window.cart（避免 removeItem 签名不一致导致暴涨）
  function removeOneFromCart(p) {
    const pid = getPid(p);
    if (!pid) return;

    const now = getQtyInCart(pid);
    const next = Math.max(0, now - 1);

    // 新 Cart：只用 setQty / updateQty
    if (window.Cart) {
      if (typeof window.Cart.setQty === "function") {
        window.Cart.setQty(pid, next);
        notifyCartChanged(pid);
        return;
      }
      if (typeof window.Cart.updateQty === "function") {
        window.Cart.updateQty(pid, next);
        notifyCartChanged(pid);
        return;
      }
    }

    // 老 removeOne / removeFromCart（如果存在且明确是减 1）
    // 注意：不调用 removeItem(pid,1) 之类，避免你现在那个反向问题
    if (typeof window.removeOneFromCart === "function") {
      // 避免和本函数同名递归：这里只在全局老方法存在时才用
      if (window.removeOneFromCart !== removeOneFromCart) {
        window.removeOneFromCart(pid);
        notifyCartChanged(pid);
        return;
      }
    }

    // 兜底：直接改 window.cart
    const m = getCartMap();
    if (next <= 0) {
      delete m[pid];
    } else {
      m[pid] = m[pid] || {};
      m[pid].qty = next;
    }
    window.cart = m;

    notifyCartChanged(pid);
  }

  // -------------------------
  // 购物车抽屉：详情页兜底桥接（不改 cart.js）
  // -------------------------
  function ensureCartDrawerBridge() {
    // 1) cart.js 已经提供 toggleCartDrawer 就不用动
    if (typeof window.toggleCartDrawer === "function") return;

    // 2) Cart API（如果存在）
    if (window.Cart && typeof window.Cart.toggleDrawer === "function") {
      window.toggleCartDrawer = function (open) {
        try {
          window.Cart.toggleDrawer(open);
        } catch (e) {}
      };
      return;
    }

    if (window.Cart && typeof window.Cart.openDrawer === "function") {
      window.toggleCartDrawer = function (open) {
        try {
          if (open === false) window.Cart.closeDrawer && window.Cart.closeDrawer();
          else window.Cart.openDrawer();
        } catch (e) {}
      };
      return;
    }

    // 3) 最后兜底：直接操作 DOM 显示/隐藏（只要你的 HTML 有 cartDrawer/cartBackdrop）
    window.toggleCartDrawer = function (open) {
      const drawer = document.getElementById("cartDrawer");
      const backdrop = document.getElementById("cartBackdrop");
      if (!drawer || !backdrop) return;

      const shouldOpen = typeof open === "boolean" ? open : !drawer.classList.contains("open");
      if (shouldOpen) {
        drawer.classList.add("open");
        backdrop.classList.add("open");
      } else {
        drawer.classList.remove("open");
        backdrop.classList.remove("open");
      }
    };
  }

  // -------------------------
  // 渲染顶部主信息 + 主图
  // -------------------------
  function pickImageUrl(p) {
    if (!p) return "";
    // 常见字段兜底
    if (typeof p.image === "string" && p.image.trim()) return p.image.trim();
    if (typeof p.imageUrl === "string" && p.imageUrl.trim()) return p.imageUrl.trim();
    if (typeof p.imgUrl === "string" && p.imgUrl.trim()) return p.imgUrl.trim();

    // images 数组兜底
    if (Array.isArray(p.images) && p.images.length) {
      const first = p.images[0];
      if (typeof first === "string" && first.trim()) return first.trim();
      if (first && typeof first.url === "string" && first.url.trim()) return first.url.trim();
    }

    return "";
  }

  function renderDetailMain(p) {
    const titleEl = document.getElementById("detailTitle");
    const descEl = document.getElementById("detailDesc");
    const priceEl = document.getElementById("detailPrice");
    const originEl = document.getElementById("detailOrigin");
    const tagsRow = document.getElementById("detailTagRow");
    const extraNoteEl = document.getElementById("detailExtraNote");
    const crumbEl = document.getElementById("crumbProductName");
    const imgTextEl = document.getElementById("detailImageText");
    const imgEl = document.getElementById("detailImage");

    if (crumbEl) crumbEl.textContent = p.name || "商品详情";
    if (titleEl) titleEl.textContent = p.name || "未命名商品";
    if (descEl) descEl.textContent = p.desc || "";

    let currPrice = 0;
    if (typeof p.price === "number") currPrice = p.price;
    else if (typeof p.specialPrice === "number") currPrice = p.specialPrice;
    else currPrice = toNum(p.originPrice || 0);

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

    // ✅ 主图显示
    const url = pickImageUrl(p);
    if (imgEl && url) {
      imgEl.src = url;
      imgEl.style.display = "block";
      if (imgTextEl) imgTextEl.style.display = "none";

      imgEl.onerror = () => {
        imgEl.style.display = "none";
        if (imgTextEl) {
          imgTextEl.style.display = "block";
          imgTextEl.textContent = "商品图加载失败 · " + (p.name || "");
        }
      };
    } else {
      if (imgEl) imgEl.style.display = "none";
      if (imgTextEl) {
        imgTextEl.style.display = "block";
        imgTextEl.textContent = "商品图占位 · " + (p.name || "");
      }
    }
  }

  // -------------------------
  // 大胶囊 UI：徽章 + 文案
  // -------------------------
  function refreshCapsuleUI() {
    const mainTextEl = document.getElementById("detailCartMainText");
    const subTextEl = document.getElementById("detailCartSubText");
    const badgeEl = document.getElementById("detailCartBadge");

    const pid = getPid(currentProduct);
    const qty = pid ? getQtyInCart(pid) : 0;

    if (badgeEl) {
      if (qty > 0) {
        badgeEl.textContent = String(qty);
        badgeEl.style.display = "inline-flex";
      } else {
        badgeEl.style.display = "none";
      }
    }

    if (mainTextEl) {
      if (qty > 0) mainTextEl.textContent = `已加入 ${qty} 件商品`;
      else mainTextEl.textContent = `加入 1 件商品`;
    }
    if (subTextEl) {
      if (qty > 0) subTextEl.textContent = "点击中间继续加购（不会自动打开购物车）";
      else subTextEl.textContent = "点击中间区域加入购物车";
    }
  }

  // -------------------------
  // 大胶囊交互：中间 +1，+/- 直接加减购
  // -------------------------
  function bindCapsuleControls() {
    const capsule = document.getElementById("btnAddToCartDetail");
    const minusBtn = document.getElementById("btnQtyMinusBig");
    const plusBtn = document.getElementById("btnQtyPlusBig");

    if (!capsule) return;

    // ✅ 中间点一下：+1（但点到 +/- 不算中间）
    capsule.addEventListener("click", (e) => {
      // 关键：用 closest，避免 iOS 点到文本节点导致识别失败 + 冒泡
      if (e.target && e.target.closest) {
        if (e.target.closest("#btnQtyMinusBig") || e.target.closest("#btnQtyPlusBig")) return;
      }
      if (!currentProduct) return;
      addOneToCart(currentProduct);
      refreshCapsuleUI();
      refreshRecommendBadges();
    });

    if (plusBtn) {
      plusBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentProduct) return;
        addOneToCart(currentProduct);
        refreshCapsuleUI();
        refreshRecommendBadges();
      });
    }

    if (minusBtn) {
      minusBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentProduct) return;
        removeOneFromCart(currentProduct);
        refreshCapsuleUI();
        refreshRecommendBadges();
      });
    }
  }

  // -------------------------
  // 收藏按钮（占位）
  // -------------------------
  function bindFavButton() {
    const favBtn = document.getElementById("btnDetailFav");
    if (!favBtn) return;
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      alert("收藏功能后续接入，这里先做占位提示。");
    });
  }

  // ======================================================
  // 推荐区：Weee 风格卡片 + 左右滑动 + 按钮徽章
  // ======================================================
  function createRecommendCard(p, isTop) {
    const card = document.createElement("div");
    card.className = "detail-recommend-card";

    const pid = getPid(p);
    const imgUrl =
      pickImageUrl(p) ||
      `https://picsum.photos/seed/${encodeURIComponent(pid || "fb")}/640/400`;

    const currPrice =
      typeof p.price === "number"
        ? p.price
        : typeof p.specialPrice === "number"
        ? p.specialPrice
        : toNum(p.originPrice || 0);

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
            <span class="rec-badge" data-rec-badge="${pid}" style="
              display:none;
              margin-left:8px;
              min-width:18px;
              height:18px;
              padding:0 6px;
              border-radius:999px;
              background:#ef4444;
              color:#fff;
              font-size:12px;
              font-weight:800;
              line-height:18px;
              vertical-align:middle;
            ">0</span>
          </button>
        </div>
      </div>
    `;

    // 收藏按钮（占位）
    const favBtn = card.querySelector(".detail-recommend-fav-btn");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      alert("收藏功能后续接入，这里先做占位提示。");
    });

    // 加入购物车
    const addBtn = card.querySelector("[data-rec-add-id]");
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addOneToCart(p);

      // 同页同步：当前详情胶囊 + 推荐徽章
      refreshCapsuleUI();
      refreshRecommendBadges();
    });

    // 整卡点击跳详情（按钮不跳）
    card.addEventListener("click", () => {
      if (!pid) return;
      window.location.href = "product_detail.html?id=" + encodeURIComponent(pid);
    });

    return card;
  }

  function refreshRecommendBadges() {
    const nodes = document.querySelectorAll("[data-rec-badge]");
    if (!nodes || !nodes.length) return;

    nodes.forEach((el) => {
      const pid = el.getAttribute("data-rec-badge") || "";
      const qty = getQtyInCart(pid);

      if (qty > 0) {
        el.textContent = String(qty);
        el.style.display = "inline-flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
      } else {
        el.style.display = "none";
      }
    });
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

    // 初次渲染后同步一次徽章
    refreshRecommendBadges();
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
      setTimeout(updateArrowDisabled, 280);
    };
    next.onclick = () => {
      viewport.scrollBy({ left: step, behavior: "smooth" });
      setTimeout(updateArrowDisabled, 280);
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

  // -------------------------
  // 顶部购物车 icon 修复：确保 onclick 能工作
  // -------------------------
  function bindCartIconFix() {
    const icon = document.getElementById("cartIcon");
    if (!icon) return;

    // 如果 HTML 写了 onclick，也再补一个 click 监听（避免某些页面脚本覆盖）
    icon.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        if (typeof window.toggleCartDrawer === "function") window.toggleCartDrawer();
      } catch (err) {}
    });
  }

  // -------------------------
  // 主初始化
  // -------------------------
  async function initDetailPage() {
    ensureCartDrawerBridge();
    bindCartIconFix();

    const idFromUrl = getQueryParam("id");
    await ensureProductsLoaded();

    let list = Array.isArray(window.allProducts) ? window.allProducts : [];

    // ✅ 没有 id 就直接提示
    if (!idFromUrl) {
      const titleEl = document.getElementById("detailTitle");
      if (titleEl) titleEl.textContent = "缺少商品ID（请从商品列表点击进入）";
      return;
    }

    let product = matchProductById(list, idFromUrl);

    // 如果没找到，再请求一次
    if (!product) {
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

    renderDetailMain(currentProduct);
    bindCapsuleControls();
    bindFavButton();
    renderRecommendList();

        // 初次同步胶囊徽章
    refreshCapsuleUI();

    // 监听全站购物车更新（如果 cart.js 有发事件）
    window.addEventListener("freshbuy:cartUpdated", () => {
      refreshCapsuleUI();
      refreshRecommendBadges();
    });
  } // ✅ initDetailPage end

  // ===============================
  // 详情页兜底：补 toggleCartDrawer
  // （不改 cart.js）
  // ===============================
  (function ensureToggleCartDrawer() {
    if (typeof window.toggleCartDrawer === "function") return;

    window.toggleCartDrawer = function (open) {
      const drawer = document.getElementById("cartDrawer");
      const backdrop = document.getElementById("cartBackdrop");
      if (!drawer || !backdrop) return;

      const isOpen = drawer.classList.contains("open");
      const shouldOpen = typeof open === "boolean" ? open : !isOpen;

      if (shouldOpen) {
        drawer.classList.add("open");
        backdrop.classList.add("open");
      } else {
        drawer.classList.remove("open");
        backdrop.classList.remove("open");
      }
    };

    console.log("✅ product_detail.js: toggleCartDrawer fallback mounted");
  })();

  window.addEventListener("DOMContentLoaded", () => {
    initDetailPage();
  });
})();
