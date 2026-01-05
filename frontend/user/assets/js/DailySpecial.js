// frontend/user/assets/js/DailySpecial.js
// 家庭必备 = 所有特价商品（Special Deals）

console.log("✅ DailySpecial.js loaded (Family = Special)");

(() => {
  const GRID_ID = "dailyGrid";
  const API_CANDIDATES = [
    "/api/products-simple",     // 你首页正在用的
    "/api/products/public",
    "/api/products",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function isTrueFlag(v) {
    return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
  }

  // ✅ 特价判定（跟你 index.js 的价格逻辑一致）
  function isSpecialDeal(p) {
    // 1) 后台开关
    if (
      isTrueFlag(p.isSpecial) ||
      isTrueFlag(p.onSale) ||
      isTrueFlag(p.isSale) ||
      isTrueFlag(p.isDailySpecial)
    ) return true;

    // 2) sale/special/flash < basePrice
    const basePrice = toNum(p.price ?? p.regularPrice ?? p.originPrice ?? 0);
    const salePrice = toNum(p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0);
    if (basePrice > 0 && salePrice > 0 && salePrice < basePrice) return true;

    // 3) 划线价：originPrice > price
    const origin = toNum(p.originPrice ?? p.originalPrice ?? 0);
    const price = toNum(p.price ?? 0);
    if (origin > 0 && price > 0 && origin > price) return true;

    // 4) 折扣字段
    const discount = toNum(p.discount ?? p.discountPercent ?? 0);
    if (discount > 0) return true;

    return false;
  }
// ❌ 爆品判定（用于从家庭必备中排除）
function isHotProduct(p) {
  if (
    isTrueFlag(p.isHot) ||
    isTrueFlag(p.isHotDeal) ||
    isTrueFlag(p.hotDeal)
  ) return true;

  const kw = (v) => (v ? String(v).toLowerCase() : "");

  const fields = [
    p.tag,
    p.type,
    p.category,
    p.section,
  ];

  if (fields.some((f) => kw(f).includes("爆品") || kw(f).includes("hot")))
    return true;

  if (Array.isArray(p.tags) && p.tags.some((t) => kw(t).includes("爆品")))
    return true;

  return false;
}
  function getFinalPrice(p) {
    const basePrice = toNum(p.price ?? p.originPrice ?? p.regularPrice ?? 0);
    const salePrice = toNum(p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0);
    if (basePrice > 0 && salePrice > 0 && salePrice < basePrice) return salePrice;
    return basePrice || salePrice || 0;
  }

  function getOriginPrice(p) {
    const basePrice = toNum(p.price ?? p.regularPrice ?? 0);
    const salePrice = toNum(p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0);
    // 只有真实特价才显示划线原价
    if (basePrice > 0 && salePrice > 0 && salePrice < basePrice) return basePrice;
    return toNum(p.originPrice ?? 0);
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

  function createCard(p) {
    const pid = String(p._id || p.id || p.sku || "").trim();
    const name = String(p.name || p.title || "未命名商品");
    const img =
      String(p.image || p.img || p.cover || "").trim() ||
      `https://picsum.photos/seed/${encodeURIComponent(pid || name)}/600/450`;

    const finalPrice = getFinalPrice(p);
    const originPrice = getOriginPrice(p);
    const hasOrigin = originPrice > 0 && originPrice > finalPrice;

    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-image-wrap">
        <span class="special-badge">家庭必备</span>
        <img src="${img}" class="product-image" alt="${name}" loading="lazy" />
        <div class="product-overlay">
          <div class="overlay-btn-row">
            <button type="button" class="overlay-btn add" data-add-pid="${pid}">加入购物车</button>
          </div>
        </div>
      </div>

      <div class="product-name">${name}</div>
      <div class="product-desc">${String(p.desc || "")}</div>

      <div class="product-price-row">
        <span class="product-price">$${finalPrice.toFixed(2)}</span>
        ${hasOrigin ? `<span class="product-origin">$${originPrice.toFixed(2)}</span>` : ""}
      </div>
    `;

    card.addEventListener("click", () => {
      if (!pid) return;
      window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(pid);
    });

    // 加购（兼容你现有 cart.js）
    const addBtn = card.querySelector('.overlay-btn.add');
    if (addBtn) {
      addBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();

        const cartApi =
          (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
          (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
          null;

        if (!cartApi) return alert("购物车模块未启用（请确认 cart.js 已加载）");

        cartApi.addItem(
          {
            id: pid,
            name,
            price: finalPrice,
            image: img,
            tag: p.tag || "",
          },
          1
        );

        const toast = document.getElementById("addCartToast");
        if (toast) {
          toast.classList.add("show");
          setTimeout(() => toast.classList.remove("show"), 900);
        }
      });
    }

    return card;
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
    if (!grid) {
      console.warn("❌ 找不到容器 #dailyGrid");
      return;
    }

    try {
      const all = await fetchProducts();
     const specialList = all.filter(
  (p) => isSpecialDeal(p) && !isHotProduct(p)
);
      console.log("🧮 total:", all.length, "special=>family:", specialList.length);

      grid.innerHTML = "";
      if (!specialList.length) {
        renderEmpty("已获取商品，但没有任何商品满足“特价”判定（请确认后台 salePrice/flashPrice/isSpecial 等字段）。");
        return;
      }

      specialList.forEach((p) => grid.appendChild(createCard(p)));
    } catch (e) {
      console.error("❌ DailySpecial load failed:", e);
      renderEmpty("加载失败：无法获取商品列表（请检查 API 是否正常返回）。");
    }
  }

  window.addEventListener("DOMContentLoaded", main);
})();
