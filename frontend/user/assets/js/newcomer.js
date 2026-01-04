console.log("newcomer page loaded");

async function loadNewcomerProducts() {
  try {
    const res = await fetch("/api/products-simple", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    const list = Array.isArray(data)
      ? data
      : data.items || data.products || [];

    const grid = document.getElementById("newcomerGrid");
    if (!grid) return;

    grid.innerHTML = "";

    // ✅ 新客逻辑：爆品 / 新客价 / isHot
    const newcomerList = list.filter((p) =>
      p.isHot ||
      p.isHotDeal ||
      p.isSpecial ||
      (p.tag || "").includes("爆品") ||
      (p.tag || "").includes("新客")
    );

    if (!newcomerList.length) {
      grid.innerHTML =
        '<div style="color:#6b7280;font-size:14px;">暂无新客商品</div>';
      return;
    }

    newcomerList.forEach((p) => {
      grid.appendChild(createProductCard(p, "新客价"));
    });
  } catch (err) {
    console.error("加载新客商品失败", err);
  }
}

window.addEventListener("DOMContentLoaded", loadNewcomerProducts);
