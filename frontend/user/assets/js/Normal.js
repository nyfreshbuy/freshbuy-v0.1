console.log("Normal page loaded");

// =========================
// 顶部分类（本页筛选）
// =========================
const categoryBarNormal = document.getElementById("categoryBarNormal");

// 你截图里的这些分类（key 用来匹配商品字段）
const NORMAL_CATEGORIES = [
  { key: "all", name: "全部" },
  { key: "fresh", name: "生鲜果蔬", keywords: ["生鲜", "果蔬", "蔬菜", "水果", "fresh", "produce"] },
  { key: "meat", name: "肉禽海鲜", keywords: ["肉", "禽", "海鲜", "牛", "猪", "鸡", "鱼", "meat", "seafood"] },
  { key: "snacks", name: "零食饮品", keywords: ["零食", "饮品", "饮料", "奶", "水", "snack", "drink", "beverage"] },
  { key: "staples", name: "粮油主食", keywords: ["粮油", "主食", "米", "面", "粉", "油", "staple", "rice", "noodle"] },
  { key: "seasoning", name: "调味酱料", keywords: ["调味", "酱", "料", "盐", "醋", "酱油", "seasoning", "sauce"] },
  { key: "frozen", name: "冷冻食品", keywords: ["冷冻", "冻", "frozen"] },
  { key: "household", name: "日用清洁", keywords: ["日用", "清洁", "纸", "洗衣", "洗洁精", "household", "clean"] },
];

function renderCategoryPills() {
  if (!categoryBarNormal) return;

  categoryBarNormal.innerHTML = "";

  NORMAL_CATEGORIES.forEach((cat, idx) => {
    const a = document.createElement("a");
    a.href = "javascript:void(0)";
    a.className = "cat-pill" + (idx === 0 ? " active" : "");
    a.dataset.catKey = cat.key;
    a.textContent = cat.name;

    a.addEventListener("click", () => {
      document.querySelectorAll("#categoryBarNormal .cat-pill").forEach((x) => x.classList.remove("active"));
      a.classList.add("active");

      // 切分类时：清空搜索框（更直觉）
      const input = document.getElementById("normalSearchInput");
      if (input) input.value = "";

      applyFilters({ categoryKey: cat.key, keyword: "" });
    });

    categoryBarNormal.appendChild(a);
  });
}

// =========================
// 工具：兼容后端各种字段
// =========================
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function hasKeyword(p, keyword) {
  if (!p) return false;
  const kw = String(keyword).toLowerCase();
  const norm = (v) => (v ? String(v).toLowerCase() : "");

  const fields = [
    p.tag,
    p.type,
    p.category,
    p.subCategory,
    p.mainCategory,
    p.subcategory,
    p.section,
  ];
  if (fields.some((f) => norm(f).includes(kw))) return true;

  if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
  if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;

  return false;
}

// ✅ 爆品判断（跟首页一致）
function isHotProduct(p) {
  return (
    isTrueFlag(p.isHot) ||
    isTrueFlag(p.isHotDeal) ||
    isTrueFlag(p.hotDeal) ||
    isTrueFlag(p.isSpecial) ||
    hasKeyword(p, "爆品") ||
    hasKeyword(p, "爆品日") ||
    hasKeyword(p, "hot")
  );
}

// ✅ 判断商品属于哪个分类（尽量兼容你后端字段写法）
function matchCategory(p, cat) {
  if (!p || !cat) return false;
  if (cat.key === "all") return true;

  // 1) 先用商品自带字段（最靠谱）
  const fields = [
    p.category,
    p.mainCategory,
    p.subCategory,
    p.subcategory,
    p.section,
    p.type,
    p.tag,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 2) 再补：tags/labels
  const arr1 = Array.isArray(p.tags) ? p.tags.join(" ").toLowerCase() : "";
  const arr2 = Array.isArray(p.labels) ? p.labels.join(" ").toLowerCase() : "";

  const hay = (fields + " " + arr1 + " " + arr2).toLowerCase();

  // 3) 用关键词匹配
  const kws = Array.isArray(cat.keywords) ? cat.keywords : [];
  return kws.some((k) => hay.includes(String(k).toLowerCase()));
}

// =========================
// 兜底卡片（如果没引入 createProductCard 也不白屏）
// =========================
function fallbackCard(p, badgeText = "") {
  const el = document.createElement("article");
  el.className = "product-card";

  const pid = String(p._id || p.id || p.sku || "").trim();
  const priceNum = Number(p.price ?? p.flashPrice ?? p.specialPrice ?? 0);
  const originNum = Number(p.originPrice ?? p.price ?? 0);
  const finalPrice = priceNum || originNum || 0;

  const imageUrl =
    p.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(pid || p.name || "fb")}/500/400`;

  el.innerHTML = `
    <div class="product-image-wrap">
      ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
      <img src="${imageUrl}" class="product-image" alt="${p.name || ""}" />
    </div>
    <div class="product-name">${p.name || ""}</div>
    <div class="product-desc">${p.desc || ""}</div>
    <div class="product-price-row">
      <span class="product-price">$${finalPrice.toFixed(2)}</span>
    </div>
    <div class="product-tagline">${(p.tag || p.category || "").slice(0, 18)}</div>
  `;

  el.addEventListener("click", () => {
    if (!pid) return;
    window.location.href = "product_detail.html?id=" + encodeURIComponent(pid);
  });

  return el;
}

// =========================
// 加载 + 渲染 + 筛选（分类 + 搜索）
// =========================
let ALL = [];       // 原始
let NORMAL = [];    // 非爆品
let CURRENT_CAT = "all";

function getActiveCategory() {
  return NORMAL_CATEGORIES.find((c) => c.key === CURRENT_CAT) || NORMAL_CATEGORIES[0];
}

function renderList(list) {
  const grid = document.getElementById("normalGrid");
  if (!grid) return;

  const makeCard =
    typeof window.createProductCard === "function"
      ? (p) => window.createProductCard(p, "")
      : (p) => fallbackCard(p, "");

  grid.innerHTML = "";

  if (!list.length) {
    const catName = getActiveCategory()?.name || "该分类";
    grid.innerHTML = `<div style="padding:12px;color:#6b7280;font-size:14px;">${catName} 暂无商品</div>`;
    return;
  }

  list.forEach((p) => grid.appendChild(makeCard(p)));
}

function applyFilters({ categoryKey, keyword }) {
  CURRENT_CAT = categoryKey || CURRENT_CAT;

  const cat = getActiveCategory();
  const kw = String(keyword || "").trim().toLowerCase();

  // 先按分类筛
  let list = NORMAL.filter((p) => matchCategory(p, cat));

  // 再按搜索筛
  if (kw) {
    const hit = (p) => {
      const fields = [
        p?.name,
        p?.desc,
        p?.tag,
        p?.type,
        p?.category,
        p?.subCategory,
        p?.mainCategory,
        p?.subcategory,
        p?.section,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const arr1 = Array.isArray(p?.tags) ? p.tags.join(" ").toLowerCase() : "";
      const arr2 = Array.isArray(p?.labels) ? p.labels.join(" ").toLowerCase() : "";

      return (fields + " " + arr1 + " " + arr2).includes(kw);
    };

    list = list.filter(hit);
  }

  renderList(list);
}

async function loadNormalProducts() {
  const grid = document.getElementById("normalGrid");
  if (!grid) {
    console.warn("❌ 未找到 #normalGrid，请检查 Normal.html 的容器 id");
    return;
  }

  grid.innerHTML = "";

  try {
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
    NORMAL = list.filter((p) => !isHotProduct(p)); // ✅ 排除爆品

    applyFilters({ categoryKey: "all", keyword: "" });
  } catch (err) {
    console.error("加载全部商品失败：", err);
    grid.innerHTML =
      '<div style="padding:12px;color:#b00020;font-size:14px;">加载失败，请稍后重试</div>';
  }
}

// =========================
// 搜索绑定（只搜当前分类内）
// =========================
function bindSearch() {
  const input = document.getElementById("normalSearchInput");
  if (!input) return;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilters({ categoryKey: CURRENT_CAT, keyword: input.value });
    }
  });

  input.addEventListener("input", () => {
    if (!input.value.trim()) {
      applyFilters({ categoryKey: CURRENT_CAT, keyword: "" });
    }
  });
}

// =========================
// init
// =========================
window.addEventListener("DOMContentLoaded", () => {
  renderCategoryPills();
  bindSearch();
  loadNormalProducts();
});
