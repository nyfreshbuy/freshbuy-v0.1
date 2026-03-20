// frontend/user/assets/js/hot.js
console.log("🔥 hot.html script loaded");

async function loadHotDealsPage() {
  const grid = document.getElementById("productGridHot");
  const empty = document.getElementById("hotEmpty");
  if (!grid) return;

  // 等待 window.FB 就绪（因为 index.js 在 DOMContentLoaded 里会跑一堆东西）
  const FB = window.FB;
  if (!FB || typeof FB.createProductCard !== "function") {
    console.warn("window.FB not ready. check script order: cart.js -> index.js -> hot.js");
    grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">页面加载中…</div>`;
    return;
  }

  try {
    const res = await fetch("/api/products-simple", { cache: "no-store" });
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

    // 原始列表 -> 展开单个/整箱
    const viewList = FB.expandProductsWithVariants(list);

    // 只要爆品
    const hotList = viewList.filter((p) => FB.isHotProduct(p));

    // ✅ 可选：把“有特价的”排前面（更像爆品页）
    hotList.sort((a, b) => {
      const as = a.specialEnabled ? 1 : 0;
      const bs = b.specialEnabled ? 1 : 0;
      return bs - as;
    });

    grid.innerHTML = "";

    if (!hotList.length) {
      if (empty) empty.style.display = "block";
      return;
    }

    hotList.forEach((p, idx) => {
      // 徽章统一叫“限时爆品”
      const badge = "限时爆品";
      grid.appendChild(FB.createProductCard(p, badge));
    });

    // 同步徽章 + 加购按钮切换
    try { FB.scheduleBadgeSync(); } catch {}
    try { FB.renderAllCardsAction(); } catch {}
  } catch (e) {
    console.error("loadHotDealsPage failed:", e);
    grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">加载失败，请稍后刷新</div>`;
  }
}

window.addEventListener("DOMContentLoaded", loadHotDealsPage);