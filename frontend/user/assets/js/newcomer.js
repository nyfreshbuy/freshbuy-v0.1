console.log("newcomer.js page loaded");
function showErr(msg){
  const grid = document.getElementById("productGridHot");
  if (grid) grid.innerHTML = `<div style="padding:12px;color:#b91c1c;font-size:13px;">${msg}</div>`;
}
function createProductCard(p, badgeText) {
  const article = document.createElement("article");
  article.className = "product-card";

  const pid = String(p._id || p.id || p.sku || "").trim();
  const priceNum = Number(p.price ?? p.flashPrice ?? p.specialPrice ?? 0);
  const originNum = Number(p.originPrice ?? p.price ?? 0);
  const finalPrice = priceNum || originNum || 0;
  const hasOrigin = originNum > 0 && originNum > finalPrice;

  const imageUrl =
    p.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(pid || p.name || "fb")}/500/400`;

  article.innerHTML = `
    <div class="product-image-wrap">
      ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
      <img src="${imageUrl}" class="product-image" alt="${p.name || ""}" />
    </div>

    <div class="product-name">${p.name || ""}</div>
    <div class="product-desc">${p.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${finalPrice.toFixed(2)}</span>
      ${hasOrigin ? `<span class="product-origin">$${originNum.toFixed(2)}</span>` : ""}
    </div>

    <button type="button" class="product-add-fixed">加入购物车</button>
  `;

  // 加入购物车
  article.querySelector(".product-add-fixed")?.addEventListener("click", (ev) => {
    ev.stopPropagation();

    const cartApi =
      (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
      (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
      null;

    if (!cartApi) return alert("购物车模块未就绪（确认 cart.js 是否加载成功）");

    cartApi.addItem(
      {
        id: pid,
        name: p.name || "商品",
        price: finalPrice,
        image: p.image || imageUrl,
        tag: p.tag || "",
        type: p.type || "",
        isSpecial: true,
        isDeal: true,
      },
      1
    );
  });

  // 点卡片进详情
  article.addEventListener("click", () => {
    if (!pid) return;
    window.location.href = "product_detail.html?id=" + encodeURIComponent(pid);
  });

  return article;
}

async function loadNewcomerProducts() {
  try {
    const res = await fetch("/api/products-simple", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    const list = Array.isArray(data) ? data : data.items || data.products || [];

    const grid = document.getElementById("productGridHot");
    if (!grid) return;

    grid.innerHTML = "";

    const newcomerList = list.filter((p) =>
      p.isHot ||
      p.isHotDeal ||
      p.isSpecial ||
      (p.tag || "").includes("爆品") ||
      (p.tag || "").includes("新客")
    );

    if (!newcomerList.length) {
      grid.innerHTML = '<div style="color:#6b7280;font-size:14px;">暂无新客商品</div>';
      return;
    }

    newcomerList.forEach((p) => {
      grid.appendChild(createProductCard(p, "新客价"));
    });
  } catch (err) {
    console.error("加载新客商品失败", err);
    showErr("加载失败：请检查 /api/products-simple 是否可访问，或 newcomer.js/CSS 是否 404");
  }
}

window.addEventListener("DOMContentLoaded", loadNewcomerProducts);
