console.log("newcomer.js loaded");

const FILTERS = [
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
let newcomerAll = [];
let activeCat = "all";

function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function isNewcomer(p) {
  const tag = String(p?.tag || "");
  return (
    isTrueFlag(p?.isHot) ||
    isTrueFlag(p?.isHotDeal) ||
    isTrueFlag(p?.hotDeal) ||
    isTrueFlag(p?.isSpecial) ||
    tag.includes("爆品") ||
    tag.includes("新客") ||
    tag.toLowerCase().includes("hot")
  );
}

function matchCat(p, catKey) {
  if (catKey === "all") return true;

  const texts = [];
  ["category", "subCategory", "mainCategory", "subcategory", "type", "section", "tag", "name", "desc"].forEach(
    (k) => {
      if (p && p[k]) texts.push(String(p[k]));
    }
  );
  if (Array.isArray(p?.tags)) texts.push(p.tags.join(" "));
  if (Array.isArray(p?.labels)) texts.push(p.labels.join(" "));

  const hay = texts.join(" ").toLowerCase();

  const dict = {
    fresh: ["生鲜", "果蔬", "蔬菜", "水果", "fresh", "produce", "veg", "vegetable", "fruit"],
    meat: ["肉", "禽", "海鲜", "meat", "poultry", "seafood", "fish", "shrimp"],
    snacks: ["零食", "饮品", "snack", "snacks", "drink", "beverage", "soda", "tea", "coffee"],
    staples: ["粮油", "主食", "米", "面", "staple", "rice", "noodle", "oil", "flour"],
    seasoning: ["调味", "酱料", "seasoning", "sauce", "spice", "soy", "vinegar"],
    frozen: ["冷冻", "frozen", "ice"],
    household: ["日用", "清洁", "household", "clean", "cleaning", "tissue", "paper", "detergent"],
  };

  return (dict[catKey] || []).some((k) => hay.includes(String(k).toLowerCase()));
}

function getNum(p, keys, def = 0) {
  for (const k of keys) {
    const v = p?.[k];
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
  }
  return def;
}

function getPrice(p) {
  return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
}

function getSales(p) {
  return getNum(p, ["sales", "sold", "saleCount", "salesCount", "orderCount"], 0);
}

function sortList(list, sortKey) {
  const arr = [...list];
  if (sortKey === "price_asc") arr.sort((a, b) => getPrice(a) - getPrice(b));
  else if (sortKey === "price_desc") arr.sort((a, b) => getPrice(b) - getPrice(a));
  else arr.sort((a, b) => getSales(b) - getSales(a)); // 默认销量高→低
  return arr;
}

function showToast() {
  const el = document.getElementById("addCartToast");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 900);
}

function createCard(p) {
  const article = document.createElement("article");
  article.className = "product-card";

  const pid = String(p._id || p.id || p.sku || "").trim();
  const price = getPrice(p);
  const origin = getNum(p, ["originPrice"], 0);
  const hasOrigin = origin > 0 && origin > price;

  const img =
    p.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(pid || p.name || "fb")}/500/400`;

  const badge = "新客价";
  const limitQty = p.limitQty || p.limitPerUser || p.maxQty || p.purchaseLimit || 0;

  article.innerHTML = `
    <div class="product-image-wrap">
      <span class="special-badge">${badge}</span>
      <img src="${img}" class="product-image" alt="${p.name || ""}" />
    </div>

    <div class="product-name">${p.name || ""}</div>
    <div class="product-desc">${p.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${Number(price || 0).toFixed(2)}</span>
      ${hasOrigin ? `<span class="product-origin">$${Number(origin).toFixed(2)}</span>` : ""}
    </div>

    <button type="button" class="add-btn">
      <span class="add-btn__icon">🛒</span>
      <span class="add-btn__text">加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}</span>
    </button>
  `;

  // ✅ 加入购物车
  const btn = article.querySelector(".add-btn");
  if (btn) {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();

      const cartApi =
        (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
        (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
        null;

      if (!cartApi) {
        alert("购物车模块未就绪（请确认 cart.js 已加载且 window.FreshCart 存在）");
        return;
      }

      cartApi.addItem(
        {
          id: pid,
          name: p.name || "商品",
          price: Number(price || 0),
          priceNum: Number(price || 0),
          image: p.image || img,
          tag: p.tag || "",
          type: p.type || "",
          isSpecial: true,
          isDeal: true,
        },
        1
      );

      showToast();
    });
  }

  // ✅ 点卡片去详情（你如果没做详情页可以先注释掉）
  article.addEventListener("click", () => {
    if (!pid) return;
    window.location.href = "/user/product_detail.html?id=" + encodeURIComponent(pid);
  });

  return article;
}

function renderFilters() {
  const bar = document.getElementById("filterBar");
  if (!bar) {
    console.warn("❌ filterBar not found");
    return;
  }
  bar.innerHTML = "";

  FILTERS.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-pill" + (f.key === activeCat ? " active" : "");
    btn.textContent = f.name;
    btn.dataset.key = f.key;

    btn.addEventListener("click", () => {
      activeCat = f.key;
      bar.querySelectorAll(".filter-pill").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      renderList();
    });

    bar.appendChild(btn);
  });
}

function renderList() {
  const grid = document.getElementById("newcomerGrid");
  const sortSel = document.getElementById("sortSelect");
  if (!grid) return;

  const sortKey = sortSel ? sortSel.value : "sales_desc";

  let list = newcomerAll.filter((p) => matchCat(p, activeCat));
  list = sortList(list, sortKey);

  console.log("[filter]", activeCat, "matched:", list.length, "sort:", sortKey);

  grid.innerHTML = "";

  if (!list.length) {
    grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">该分类暂无新客商品</div>`;
    return;
  }

  list.forEach((p) => grid.appendChild(createCard(p)));

  try {
    grid.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {}
}

async function loadProducts() {
  const res = await fetch("/api/products-simple", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  const list = Array.isArray(data)
    ? data
    : Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.products)
    ? data.products
    : Array.isArray(data.list)
    ? data.list
    : [];

  ALL = list;
  newcomerAll = list.filter(isNewcomer);

  renderFilters();
  renderList();
}

function injectButtonStylesOnce() {
  if (document.getElementById("newcomerBtnStyle")) return;
  const style = document.createElement("style");
  style.id = "newcomerBtnStyle";
  style.textContent = `
    .add-btn{
      width:100%;
      margin-top:10px;
      padding:10px 12px;
      border:none;
      border-radius:14px;
      background: linear-gradient(135deg,#22c55e,#16a34a);
      color:#fff;
      font-weight:900;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      box-shadow: 0 10px 18px rgba(22,163,74,.18);
      transition: transform .08s ease, filter .12s ease;
    }
    .add-btn:active{ transform: scale(.98); }
    .add-btn:hover{ filter: brightness(.98); }
    .add-btn__icon{ font-size:14px; }
    .add-btn__text{ font-size:14px; letter-spacing:.02em; }
  `;
  document.head.appendChild(style);
}

window.addEventListener("DOMContentLoaded", () => {
  injectButtonStylesOnce();

  const sortSel = document.getElementById("sortSelect");
  if (sortSel) sortSel.addEventListener("change", renderList);

  loadProducts().catch((err) => {
    console.error("加载新客商品失败", err);
    const grid = document.getElementById("newcomerGrid");
    if (grid) grid.innerHTML = `<div style="padding:12px;font-size:13px;color:#b91c1c;">加载失败，请稍后重试</div>`;
  });
});
