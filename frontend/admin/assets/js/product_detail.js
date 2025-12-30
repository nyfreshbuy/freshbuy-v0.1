// assets/js/product_detail.js
console.log("product_detail.js loaded");

// 封装：按 ID 从后端拉取商品
async function fetchProductById(id) {
  if (!id) return null;

  // 1) 优先尝试前台接口（如果你后端实现了）
  try {
    const res = await fetch("/api/frontend/products/" + encodeURIComponent(id));
    if (res.ok) {
      const data = await res.json();
      // 兼容多种返回格式
      if (data && data.success && data.product) return data.product;
      if (data && data.success && data.data) return data.data;
    }
  } catch (e) {
    console.warn("尝试 /api/frontend/products/:id 失败，尝试后台接口", e);
  }

  // 2) 退而求其次：用后台 admin 接口
  try {
    const res2 = await fetch("/api/admin/products/" + encodeURIComponent(id));
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2 && data2.success && data2.product) return data2.product;
      // 有的内存接口直接返回对象
      if (data2 && data2.name) return data2;
    }
  } catch (e2) {
    console.error("尝试 /api/admin/products/:id 也失败", e2);
  }

  return null;
}

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search || "");
  const productId = params.get("id");

  // DOM 引用
  const crumbProductName = document.getElementById("crumbProductName");
  const detailTitle = document.getElementById("detailTitle");
  const detailDesc = document.getElementById("detailDesc");
  const detailPrice = document.getElementById("detailPrice");
  const detailOrigin = document.getElementById("detailOrigin");
  const detailExtraNote = document.getElementById("detailExtraNote");
  const detailImageBox = document.querySelector(".detail-image-box");
  const detailImageText = document.getElementById("detailImageText");
  const detailTagRow = document.getElementById("detailTagRow");

  const btnQtyMinus = document.getElementById("btnQtyMinus");
  const btnQtyPlus = document.getElementById("btnQtyPlus");
  const detailQtyVal = document.getElementById("detailQtyVal");
  const btnAddToCartDetail = document.getElementById("btnAddToCartDetail");

  const recommendList = document.getElementById("recommendList");

  if (!productId) {
    if (detailTitle) detailTitle.textContent = "未找到商品";
    if (detailDesc)
      detailDesc.textContent = "链接缺少商品 ID 参数（?id=xxx），无法加载详情。";
    return;
  }

  // ===== 1) 从后端拉取商品 =====
  const product = await fetchProductById(productId);

  if (!product) {
    if (detailTitle) detailTitle.textContent = "未找到商品";
    if (detailDesc)
      detailDesc.textContent = "可能该商品已下架，或链接已失效。";
    if (crumbProductName) crumbProductName.textContent = "未找到商品";
    return;
  }

  console.log("详情页加载到商品：", product);

  // ===== 2) 渲染基础信息 =====
  const name = product.name || "商品";
  const desc = product.desc || product.subtitle || "";

  const priceNum = Number(
    product.price || product.specialPrice || product.flashPrice || 0
  );
  const originNum = Number(product.originPrice || product.price || 0);
  const finalPrice = priceNum || originNum || 0;
  const hasOrigin = originNum > 0 && originNum > finalPrice;

  const limitQty =
    product.limitQty ||
    product.limitPerUser ||
    product.maxQty ||
    product.purchaseLimit ||
    0;

  if (crumbProductName) crumbProductName.textContent = name;
  if (detailTitle) detailTitle.textContent = name;
  if (detailDesc) detailDesc.textContent = desc;

  if (detailPrice) detailPrice.textContent = `$${finalPrice.toFixed(2)}`;
  if (detailOrigin) {
    detailOrigin.textContent = hasOrigin ? `$${originNum.toFixed(2)}` : "";
  }

  if (detailExtraNote) {
    if (limitQty > 0) {
      detailExtraNote.textContent = `本商品限购 ${limitQty} 件，超出将无法加入购物车。`;
    } else if (product.isSpecial || product.isFridayDeal || product.specialEnabled) {
      detailExtraNote.textContent = "本商品属于爆品日 / 特价商品，库存有限，售完即止。";
    } else {
      detailExtraNote.textContent = "";
    }
  }

  // ===== 3) 渲染标签 =====
  if (detailTagRow) {
    detailTagRow.innerHTML = "";
    const tags = [];

    if (product.category) tags.push(product.category);
    if (product.subCategory) tags.push(product.subCategory);
    if (product.tag) tags.push(product.tag);
    if (product.isFamilyMustHave) tags.push("家庭必备");
    if (product.isBestSeller) tags.push("畅销");
    if (product.isNewArrival) tags.push("新品");
    if (product.isFlashDeal || product.isFridayDeal || product.specialEnabled)
      tags.push("爆品 / 特价");
    if (limitQty > 0) tags.push(`限购${limitQty}件`);

    tags.forEach((t) => {
      if (!t) return;
      const span = document.createElement("span");
      span.className = "detail-tag";
      span.textContent = t;
      detailTagRow.appendChild(span);
    });
  }

  // ===== 4) 渲染图片 =====
  if (detailImageBox) {
    const imageUrl =
      product.image && String(product.image).trim()
        ? product.image
        : `https://picsum.photos/seed/${product.id || product._id || name}/700/520`;

    detailImageBox.innerHTML = `
      <img src="${imageUrl}"
           alt="${name}"
           style="max-width:100%;max-height:380px;border-radius:14px;object-fit:cover;display:block;">
    `;
  } else if (detailImageText) {
    detailImageText.textContent = "暂无商品图片";
  }

  // ===== 5) 数量 + 加入购物车 =====
  let currentQty = 1;

  function refreshQty() {
    if (detailQtyVal) detailQtyVal.textContent = String(currentQty);
  }

  if (btnQtyMinus) {
    btnQtyMinus.addEventListener("click", () => {
      if (currentQty > 1) {
        currentQty -= 1;
        refreshQty();
      }
    });
  }

  if (btnQtyPlus) {
    btnQtyPlus.addEventListener("click", () => {
      if (limitQty > 0 && currentQty >= limitQty) {
        alert(`本商品限购 ${limitQty} 件`);
        return;
      }
      currentQty += 1;
      refreshQty();
    });
  }

  refreshQty();

  if (btnAddToCartDetail && window.FreshCart) {
    btnAddToCartDetail.addEventListener("click", () => {
      const toAdd = currentQty > 0 ? currentQty : 1;

      for (let i = 0; i < toAdd; i++) {
        window.FreshCart.addToCartWithLimit({
          id: product.id || product._id || name,
          name,
          priceNum: finalPrice,
          limitQty,
        });
      }

      const toast = document.getElementById("addToCartToast");
      if (toast) {
        toast.textContent = "已加入购物车";
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 1500);
      }
    });
  }

  // ===== 6) 推荐区（这里用简单占位，后面可以接接口） =====
  if (recommendList) {
    recommendList.innerHTML =
      '<div class="detail-empty">推荐商品功能后续从营销中心接入，这里暂时留空。</div>';
  }
});
