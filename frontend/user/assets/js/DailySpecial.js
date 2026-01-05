// frontend/user/DailySpecial.js
// 家庭必备 = 所有特价商品（方案C）
// 规则：只要商品满足“特价判定”，就进入家庭必备列表
// 特价判定：
// 1) isSpecial / onSale / isFlash 等为 true
// 2) specialPrice / flashPrice / salePrice > 0 且 < 原价
// 3) originPrice > price（有划线价差）
// 4) tag / badges 含 “特价/爆品/促销”

console.log("✅ DailySpecial.js loaded (Family = Special)");

(() => {
  const API_BASE = ""; // 同域
  const LIST_API_CANDIDATES = [
    "/api/products/public",
    "/api/products",
    "/api/public/products",
  ];

  // =========================
  // 工具
  // =========================
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

  function getOriginPrice(p) {
    // 你的项目里常见字段兜底
    return (
      toNum(p.originPrice) ||
      toNum(p.originalPrice) ||
      toNum(p.marketPrice) ||
      0
    );
  }

  function getFinalPrice(p) {
    // 特价优先，其次普通价
    const sp =
      toNum(p.specialPrice) ||
      toNum(p.flashPrice) ||
      toNum(p.salePrice) ||
      0;
    const price = toNum(p.price) || 0;

    // 如果 specialPrice 合理就用它
    if (sp > 0 && (price === 0 || sp <= price)) return sp;
    return price || sp || 0;
  }

  function hasTag(p, keyword) {
    const tag = String(p.tag || p.tags || "").toLowerCase();
    const badges = String(p.badges || p.badge || "").toLowerCase();
    return tag.includes(keyword) || badges.includes(keyword);
  }

  // ✅ 核心：特价判定（只要 true 就算家庭必备）
  function isSpecialProduct(p) {
    const finalPrice = getFinalPrice(p);
    const originPrice = getOriginPrice(p);

    // 1) 显式开关
    const flag =
      isTrueFlag(p.isSpecial) ||
      isTrueFlag(p.onSale) ||
      isTrueFlag(p.isFlash) ||
      isTrueFlag(p.isPromo) ||
      isTrueFlag(p.special) ||
      isTrueFlag(p.flash);

    if (flag) return true;

    // 2) 有 specialPrice/flashPrice 且更便宜
    const sp =
      toNum(p.specialPrice) ||
      toNum(p.flashPrice) ||
      toNum(p.salePrice) ||
      0;

    if (sp > 0) {
      // 有原价：sp < origin 即特价
      if (originPrice > 0 && sp < originPrice) return true;
      // 无原价：sp < price 也算特价
      const price = toNum(p.price) || 0;
      if (price > 0 && sp < price) return true;
    }

    // 3) 划线价差：origin > final
    if (originPrice > 0 && finalPrice > 0 && originPrice > finalPrice) {
      return true;
    }

    // 4) 文本标签
    if (hasTag(p, "特价") || hasTag(p, "爆品") || hasTag(p, "促销")) return true;

    return false;
  }

  function normalizeListPayload(payload) {
    // 适配不同接口结构
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.products)) return payload.products;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.list)) return payload.list;
    return [];
  }

  async function fetchProducts() {
    let lastErr = null;

    for (const url of LIST_API_CANDIDATES) {
      try {
        const res = await fetch(url + "?v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
        const json = await res.json();
        const list = normalizeListPayload(json);

        console.log("📦 Products fetched from:", url, "count:", list.length);
        if (list.length) return list;
      } catch (e) {
        lastErr = e;
        console.warn("⚠️ fetch failed:", e?.message || e);
      }
    }

    throw lastErr || new Error("No product API available");
  }

  // =========================
  // 渲染（按你项目常见 DOM 兜底）
  // =========================
  function renderEmpty(msg) {
    const wrap =
      $("dailyList") ||
      $("productList") ||
      document.querySelector(".product-grid") ||
      document.querySelector("#list") ||
      document.body;

    if (!wrap) return;

    wrap.innerHTML = `
      <div style="padding:16px;background:#fff;border-radius:12px;margin:12px;">
        <div style="font-weight:700;margin-bottom:6px;">没有可显示的家庭必备商品</div>
        <div style="color:#6b7280;font-size:13px;line-height:1.6;">${msg}</div>
      </div>
    `;
  }

  function productCard(p) {
    const pid = String(p._id || p.id || p.sku || p.productId || "").trim();
    const name = String(p.name || p.title || "未命名商品");
    const img =
      String(p.image || p.img || p.cover || "").trim() ||
      `https://picsum.photos/seed/${encodeURIComponent(pid || name)}/600/450`;

    const origin = getOriginPrice(p);
    const price = getFinalPrice(p);

    const showOrigin = origin > 0 && origin > price;

    return `
      <a class="product-card" href="/user/product_detail.html?id=${encodeURIComponent(
        pid
      )}">
        <div class="pc-img">
          <img src="${img}" alt="${name}" loading="lazy"/>
          <div class="pc-badge">家庭必备</div>
        </div>
        <div class="pc-body">
          <div class="pc-name">${name}</div>
          <div class="pc-price">
            <span class="pc-now">$${price.toFixed(2)}</span>
            ${
              showOrigin
                ? `<span class="pc-origin">$${origin.toFixed(2)}</span>`
                : ""
            }
          </div>
        </div>
      </a>
    `;
  }

  function injectBasicStylesIfMissing() {
    if (document.getElementById("dailySpecialInlineStyle")) return;
    const style = document.createElement("style");
    style.id = "dailySpecialInlineStyle";
    style.textContent = `
      .product-grid, #dailyList, #productList { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; padding:12px; }
      @media (min-width: 900px){ .product-grid, #dailyList, #productList { grid-template-columns:repeat(4,minmax(0,1fr)); } }
      .product-card{ background:#fff; border-radius:14px; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,.06); display:block; }
      .pc-img{ position:relative; aspect-ratio: 4/3; background:#f3f4f6; }
      .pc-img img{ width:100%; height:100%; object-fit:cover; display:block; }
      .pc-badge{ position:absolute; left:10px; top:10px; background:#f97316; color:#fff; font-size:12px; padding:6px 8px; border-radius:999px; }
      .pc-body{ padding:10px 10px 12px; }
      .pc-name{ font-size:14px; font-weight:600; line-height:1.2; height:2.4em; overflow:hidden; }
      .pc-price{ margin-top:8px; display:flex; gap:8px; align-items:baseline; }
      .pc-now{ font-size:16px; font-weight:800; }
      .pc-origin{ color:#9ca3af; font-size:12px; text-decoration:line-through; }
    `;
    document.head.appendChild(style);
  }

  function renderList(list) {
    injectBasicStylesIfMissing();

    const wrap =
      $("dailyList") ||
      $("productList") ||
      document.querySelector(".product-grid") ||
      document.querySelector("#list");

    if (!wrap) {
      console.warn("❌ 找不到商品容器（dailyList/productList/.product-grid/#list）");
      return;
    }

    wrap.innerHTML = list.map(productCard).join("");
  }

  // =========================
  // 主流程
  // =========================
  async function main() {
    try {
      const all = await fetchProducts();

      // ✅ 家庭必备 = 特价商品
      const daily = all.filter(isSpecialProduct);

      console.log("🧮 total:", all.length, "special=>daily:", daily.length);

      if (!daily.length) {
        renderEmpty(
          "已拿到商品数据，但没有任何商品被判定为特价。请检查：后台是否真的有 originPrice>price 或 specialPrice/flashPrice 或 isSpecial=true。"
        );
        return;
      }

      renderList(daily);
    } catch (err) {
      console.error("❌ DailySpecial load failed:", err);
      renderEmpty(
        "无法拉取商品数据（接口请求失败）。请打开 F12 Console 看看具体报错，常见原因：API 路径不对 / CORS / Render 后端没返回 products。"
      );
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
