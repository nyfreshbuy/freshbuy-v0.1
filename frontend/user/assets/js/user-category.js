// user-category.js
// 分类页：根据 URL 上的 ?category=xxx 从 /api/products 拉取商品并渲染

// 读取 URL 里的 category 参数
function getCategoryFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("category") || "";
}

// 渲染商品卡片
function renderProducts(list) {
  const grid = document.getElementById("categoryGrid");
  const emptyHint = document.getElementById("categoryEmptyHint");

  if (!grid) return;

  grid.innerHTML = "";

  if (!list.length) {
    emptyHint.style.display = "block";
    return;
  } else {
    emptyHint.style.display = "none";
  }

  list.forEach((p) => {
    const card = document.createElement("div");
    card.className = "product-card";

    const price = Number(p.specialEnabled && p.specialPrice ? p.specialPrice : p.originPrice || 0);
    const originPrice = Number(p.originPrice || 0);

    let badgeHtml = "";
    if (p.isFlashDeal) {
      badgeHtml = `<div class="product-badge badge-flash">爆品日</div>`;
    } else if (p.type === "new") {
      badgeHtml = `<div class="product-badge badge-new">新品</div>`;
    } else if (p.type === "best") {
      badgeHtml = `<div class="product-badge badge-best">TOP</div>`;
    }

    card.innerHTML = `
      <div class="product-image-wrap">
        <img
          src="${p.image || "https://picsum.photos/seed/" + (p.id || Math.random()) + "/400/300"}"
          alt="${p.name || ""}"
          class="product-image"
        />
        ${badgeHtml}
      </div>
      <div class="product-info">
        <div class="product-title-row">
          <div class="product-title">${p.name || "未命名商品"}</div>
        </div>
        <div class="product-subtitle">
          ${p.desc || p.tag || ""}
        </div>
        <div class="product-price-row">
          <div class="product-price-main">
            ￥${price.toFixed(2)}
            ${
              p.specialEnabled && p.specialPrice && originPrice > price
                ? `<span class="product-price-origin">￥${originPrice.toFixed(
                    2
                  )}</span>`
                : ""
            }
          </div>
          <button class="btn-mini add-to-cart-btn" data-id="${p.id}">
            加入购物车
          </button>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

// 拉取当前分类的商品
async function loadCategoryProducts(category, keyword = "", sort = "default") {
  const titleEl = document.getElementById("categoryTitle");
  const subEl = document.getElementById("categorySubtitle");

  if (titleEl) titleEl.textContent = category || "全部商品";
  if (subEl) subEl.textContent = "正在加载商品…";

  try {
    const params = new URLSearchParams();
    if (category) params.append("category", category);
    if (keyword) params.append("keyword", keyword);

    const res = await fetch("/api/products?" + params.toString());
    const data = await res.json();

    if (!data.success) {
      if (subEl) subEl.textContent = "加载失败：" + (data.message || "未知错误");
      console.error("加载分类商品失败:", data);
      return;
    }

    let list = data.list || data.products || [];

    // 排序
    if (sort === "priceAsc") {
      list = list.slice().sort((a, b) => {
        const pa = Number(a.specialEnabled && a.specialPrice ? a.specialPrice : a.originPrice || 0);
        const pb = Number(b.specialEnabled && b.specialPrice ? b.specialPrice : b.originPrice || 0);
        return pa - pb;
      });
    } else if (sort === "priceDesc") {
      list = list.slice().sort((a, b) => {
        const pa = Number(a.specialEnabled && a.specialPrice ? a.specialPrice : a.originPrice || 0);
        const pb = Number(b.specialEnabled && b.specialPrice ? b.specialPrice : b.originPrice || 0);
        return pb - pa;
      });
    }

    if (subEl) {
      subEl.textContent = `共 ${list.length} 个商品`;
    }

    renderProducts(list);
  } catch (err) {
    console.error("请求 /api/products 出错:", err);
    if (subEl) subEl.textContent = "请求失败，请稍后重试";
  }
}

// 初始化
window.addEventListener("DOMContentLoaded", () => {
  const category = getCategoryFromUrl();

  // 首次加载
  loadCategoryProducts(category);

  // 搜索框：在当前分类内搜索
  const searchInput = document.getElementById("categorySearchInput");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        loadCategoryProducts(category, searchInput.value.trim());
      }
    });
  }

  // 排序按钮
  document.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sort = btn.getAttribute("data-sort") || "default";
      document
        .querySelectorAll(".filter-pill")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadCategoryProducts(category, searchInput ? searchInput.value.trim() : "", sort);
    });
  });
});
