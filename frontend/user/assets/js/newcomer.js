console.log("newcomer.js loaded");

const CATS = [
  { key: "all", name: "全部" },
  { key: "fresh", name: "生鲜果蔬" },
  { key: "meat", name: "肉禽海鲜" },
  { key: "snacks", name: "零食饮品" },
  { key: "staples", name: "粮油主食" },
  { key: "seasoning", name: "调味酱料" },
  { key: "frozen", name: "冷冻食品" },
  { key: "household", name: "日用清洁" },
];

let ALL = [];
let activeCat = "all";
let activeSort = "sales_desc";

function norm(s){ return String(s||"").toLowerCase(); }
function isTrue(v){ return v===true || v==="true" || v===1 || v==="1"; }

function isNewcomer(p){
  const tag = String(p.tag || "");
  return (
    isTrue(p.isHot) ||
    isTrue(p.isHotDeal) ||
    isTrue(p.isSpecial) ||
    tag.includes("爆品") ||
    tag.includes("新客")
  );
}

function matchCat(p, catKey){
  if (catKey === "all") return true;

  const fields = [
    p.category, p.subCategory, p.mainCategory, p.subcategory,
    p.type, p.section, p.tag
  ].map(norm).join(" ");

  // ✅ 你后台分类如果是中文，就直接用中文判断
  const map = {
    fresh: ["生鲜", "果蔬", "蔬菜", "水果", "fresh", "produce"],
    meat: ["肉", "禽", "海鲜", "meat", "seafood"],
    snacks: ["零食", "饮品", "snack", "drink", "beverage"],
    staples: ["粮油", "主食", "米", "面", "staple", "rice", "noodle"],
    seasoning: ["调味", "酱料", "seasoning", "sauce"],
    frozen: ["冷冻", "frozen"],
    household: ["日用", "清洁", "household", "clean"],
  };

  return (map[catKey] || []).some(k => fields.includes(norm(k)));
}

function getPrice(p){
  const priceNum = Number(p.price ?? p.flashPrice ?? p.specialPrice ?? 0);
  const originNum = Number(p.originPrice ?? p.price ?? 0);
  return priceNum || originNum || 0;
}

// ✅ 可能你的数据里没有销量字段，我做了兼容：saleCount/sold/销量/sales
function getSales(p){
  return Number(p.saleCount ?? p.sold ?? p.sales ?? p销量 ?? 0) || 0;
}

function toast(msg){
  const el = document.getElementById("addCartToast");
  if (!el) return;
  el.textContent = msg || "已加入购物车";
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 900);
}

function createCard(p){
  const pid = String(p._id || p.id || p.sku || "").trim();
  const price = getPrice(p);
  const img =
    (p.image && String(p.image).trim()) ?
    String(p.image).trim() :
    `https://picsum.photos/seed/${encodeURIComponent(pid || p.name || "fb")}/500/400`;

  const article = document.createElement("article");
  article.className = "product-card";

  article.innerHTML = `
    <div class="product-image-wrap">
      <span class="special-badge">新客价</span>
      <img src="${img}" class="product-image" alt="${p.name || ""}" />
    </div>

    <div class="product-name">${p.name || ""}</div>
    <div class="product-desc">${p.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${Number(price).toFixed(2)}</span>
    </div>

    <button type="button" class="product-add-fixed">加入购物车</button>
  `;

  // ✅ 点击卡片去详情（如果你有详情页）
  article.addEventListener("click", () => {
    if (!pid) return;
    location.href = "/user/product_detail.html?id=" + encodeURIComponent(pid);
  });

  // ✅ 加入购物车：必须 stopPropagation，不然会被上面的跳转吃掉
  const btn = article.querySelector(".product-add-fixed");
  if (btn) {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();

      const cartApi =
        (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
        (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
        null;

      if (!cartApi) {
        alert("购物车模块未初始化（请确认 cart.js 已加载且 window.FreshCart 存在）");
        return;
      }

      cartApi.addItem({
        id: pid,
        name: p.name || "商品",
        price: price,
        priceNum: price,
        image: img,
        tag: p.tag || "",
        type: p.type || "",
        isSpecial: true,
        isDeal: true,
      }, 1);

      toast("已加入购物车");
      // ✅ 同步徽标（如果 cart.js 没自动更新的话）
      try {
        if (typeof window.FreshCart.updateBadge === "function") window.FreshCart.updateBadge();
      } catch {}
    });
  }

  return article;
}

function renderFilters(){
  const bar = document.getElementById("filterBar");
  if (!bar) return;

  bar.innerHTML = "";
  CATS.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-pill" + (c.key === activeCat ? " active" : "");
    btn.textContent = c.name;
    btn.addEventListener("click", () => {
      activeCat = c.key;
      renderFilters();
      renderList();
    });
    bar.appendChild(btn);
  });
}

function renderList(){
  const grid = document.getElementById("newcomerGrid");
  if (!grid) return;

  let list = ALL.filter(isNewcomer).filter(p => matchCat(p, activeCat));

  if (activeSort === "price_asc") list.sort((a,b)=> getPrice(a)-getPrice(b));
  if (activeSort === "price_desc") list.sort((a,b)=> getPrice(b)-getPrice(a));
  if (activeSort === "sales_desc") list.sort((a,b)=> getSales(b)-getSales(a));

  grid.innerHTML = "";

  if (!list.length) {
    grid.innerHTML = `<div style="padding:12px;color:#6b7280;">暂无符合条件的新客商品</div>`;
    return;
  }

  list.forEach(p => grid.appendChild(createCard(p)));
}

async function load(){
  try {
    const res = await fetch("/api/products-simple", { cache:"no-store" });
    const data = await res.json().catch(()=> ({}));
    ALL = Array.isArray(data) ? data : (data.items || data.products || data.list || []);
    console.log("newcomer products:", ALL.length);

    renderFilters();

    const sort = document.getElementById("sortSelect");
    if (sort) {
      sort.value = activeSort;
      sort.addEventListener("change", () => {
        activeSort = sort.value;
        renderList();
      });
    }

    renderList();

    // ✅ 购物车图标：如果你 cart.js 有 initCartUI，点图标能打开抽屉
    const cartIcon = document.getElementById("cartIcon");
    if (cartIcon && window.FreshCart && typeof window.FreshCart.openDrawer === "function") {
      cartIcon.addEventListener("click", () => window.FreshCart.openDrawer());
    }
  } catch (e) {
    console.error("load newcomer failed", e);
  }
}

window.addEventListener("DOMContentLoaded", load);
