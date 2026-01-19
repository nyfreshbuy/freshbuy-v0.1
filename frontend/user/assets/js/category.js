// frontend/user/assets/js/category.js
console.log("category.js loaded (HOME-CARD-STYLE + variants single/box)");

/* =========================
   Auth (Mongo) helpers - same token key as index.js
   ========================= */
const AUTH_TOKEN_KEY = "freshbuy_token";
const AUTH_PHONE_KEY = "freshbuy_login_phone";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}
function setToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
function setSavedPhone(phone) {
  if (phone) localStorage.setItem(AUTH_PHONE_KEY, phone);
}
function getSavedPhone() {
  return localStorage.getItem(AUTH_PHONE_KEY) || "";
}
function clearSavedPhone() {
  localStorage.removeItem(AUTH_PHONE_KEY);
}

// 统一 fetch：自动带 token，401 自动清 token
async function apiFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  headers["Content-Type"] = headers["Content-Type"] || "application/json";

  const tk = getToken();
  if (tk) headers.Authorization = "Bearer " + tk;

  const res = await fetch(url, { ...options, headers });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401) clearToken();
  return { res, data };
}

async function apiLogin(phone, password) {
  const { res, data } = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok || !data?.success) throw new Error(data?.msg || "登录失败");
  setToken(data.token);

  const me = await apiMe();
  if (!me) throw new Error("登录态验证失败（/me 未通过）");
  return me;
}

async function apiRegister(name, phone, password) {
  const { res, data } = await apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, phone, password }),
  });
  if (!res.ok || !data?.success) throw new Error(data?.msg || "注册失败");
  return data.user || null;
}

async function apiMe() {
  const tk = getToken();
  if (!tk) return null;

  const { res, data } = await apiFetch("/api/auth/me", { method: "GET" });
  if (!res.ok || !data?.success) return null;

  return data.user || data.data?.user || null;
}

/* =========================
   DOM refs
   ========================= */
const gridEl = document.getElementById("productGrid");
const emptyTipEl = document.getElementById("emptyTip");
const categoryTitleEl = document.getElementById("categoryTitle");
const categorySubtitleEl = document.getElementById("categorySubtitle");
const categoryStatEl = document.getElementById("categoryStat");

const sortSelectEl = document.getElementById("sortSelect");
const searchInputEl = document.getElementById("searchInput");
const globalSearchInput = document.getElementById("globalSearchInput");

let currentCatKey = "fresh";
let currentProducts = [];
let currentFilter = "all";

/* ============================
   1) URL 解析当前大类
   ============================ */
(function initCategoryFromURL() {
  const params = new URLSearchParams(window.location.search || "");
  const cat = params.get("cat") || "fresh";
  const name = params.get("name") || "生鲜果蔬";

  currentCatKey = cat;
  if (categoryTitleEl) categoryTitleEl.textContent = name;

  if (categorySubtitleEl) {
    let sub = "";
    switch (cat) {
      case "fresh":
        sub = "当天采购 / 次日到家，更新鲜的蔬菜水果。";
        break;
      case "meat":
        sub = "放心肉类与海鲜，适合日常炒菜与火锅。";
        break;
      case "snacks":
        sub = "零食饮料下午茶，一站买齐。";
        break;
      case "staples":
        sub = "大米、面粉、食用油等家庭常备主食。";
        break;
      case "seasoning":
        sub = "厨房调味酱料、火锅底料、香料。";
        break;
      case "frozen":
        sub = "冷冻水饺、丸子、冰淇淋等方便速食。";
        break;
      case "household":
        sub = "纸巾、洗衣液、清洁用品等日用百货。";
        break;
      default:
        sub = "精选好物，方便你一站式购买。";
    }
    categorySubtitleEl.textContent = sub;
  }
})();

/* ============================
   2) 判断商品属于哪个大类
   ============================ */
function isProductInCategory(p, catKey) {
  const cat = (p.category || "").toString();
  const sub = (p.subCategory || "").toString();
  const tag = (p.tag || "").toString();
  const text = cat + "|" + sub + "|" + tag;

  switch (catKey) {
    case "fresh":
      return /生鲜|果|蔬|菜|青菜|蔬菜|水果/.test(text);
    case "meat":
      return /肉|牛|羊|猪|鸡|鸭|鹅|鱼|虾|蟹|海鲜/.test(text);
    case "snacks":
      return /零食|饮料|饮品|饼干|薯片|糖|巧克力|坚果|茶|咖啡/.test(text);
    case "staples":
      return /米|面|粮油|大米|面粉|挂面|面条|食用油|主食/.test(text);
    case "seasoning":
      return /调味|酱|酱油|醋|料酒|火锅底料|汤料|香料/.test(text);
    case "frozen":
      return /冷冻|冻品|水饺|饺子|速冻|冰淇淋|雪糕/.test(text);
    case "household":
      return /纸|纸巾|卷纸|洗衣|洗洁精|清洁|垃圾袋|日用|洗护/.test(text);
    default:
      return true;
  }
}

/* ============================
   2.5) 爆品判定（分类页排除爆品）
   ============================ */
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function hasKeywordSimple(p, keyword) {
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
function isHotProduct(p) {
  return (
    isTrueFlag(p?.isHot) ||
    isTrueFlag(p?.isHotDeal) ||
    isTrueFlag(p?.hotDeal) ||
    hasKeywordSimple(p, "爆品") ||
    hasKeywordSimple(p, "爆品日") ||
    hasKeywordSimple(p, "hot")
  );
}

/* ============================
   ✅ 首页同款卡片：variants（单卖/整箱）
   ============================ */
function normalizeVariants(p) {
  const arr = Array.isArray(p?.variants) ? p.variants : [];
  return arr
    .map((x) => ({
      key: String(x?.key || "").trim(),
      label: String(x?.label || "").trim(),
      unitCount: Number(x?.unitCount || 1) || 1,
      price: x?.price == null ? null : Number(x.price),
      enabled: x?.enabled !== false,
    }))
    .filter((v) => v.key && v.enabled !== false);
}
function pickSingleVariant(p) {
  const vars = normalizeVariants(p);
  return (
    vars.find((x) => x.key === "single") ||
    vars.find((x) => x.unitCount === 1) || {
      key: "single",
      label: "单个",
      unitCount: 1,
      price: null,
      enabled: true,
    }
  );
}
function pickBoxVariant(p) {
  const vars = normalizeVariants(p);
  // 只在后台确实配置了整箱才显示，避免箱数乱
  return vars.find((x) => x.unitCount > 1 && x.key !== "single") || null;
}
function variantLabel(v) {
  if (!v) return "";
  const base = v.label || (v.key === "single" ? "单个" : "整箱");
  const uc = Number(v.unitCount || 1);
  if (v.key !== "single" && uc > 1) return `${base}（${uc}个）`;
  return base;
}

/* ============================
   ✅ 购物车统一接口（读 qty / 改 qty）
   ============================ */
function getCartApi() {
  const fc = window.FreshCart;
  if (fc && (typeof fc.addItem === "function" || typeof fc.addToCartWithLimit === "function")) return fc;
  const c = window.Cart;
  if (c && typeof c.addItem === "function") return c;
  return null;
}
function getCartQty(pid) {
  const id = String(pid || "");
  if (!id) return 0;
  try {
    if (window.FreshCart && typeof window.FreshCart.getQty === "function") {
      return Number(window.FreshCart.getQty(id) || 0) || 0;
    }
  } catch {}
  try {
    if (window.Cart && typeof window.Cart.getQty === "function") {
      return Number(window.Cart.getQty(id) || 0) || 0;
    }
  } catch {}
  return 0;
}
function setCartQty(pid, targetQty, normalizedItem) {
  const id = String(pid || "");
  const next = Math.max(0, Math.floor(Number(targetQty || 0)));
  if (!id) return false;

  const api = getCartApi();
  if (!api) return false;

  const cur = getCartQty(id);

  // next = 0：删/设0
  if (next === 0) {
    try {
      if (typeof api.setQty === "function") {
        api.setQty(id, 0);
        return true;
      }
    } catch {}
    try {
      if (typeof api.removeItem === "function") {
        api.removeItem(id);
        return true;
      }
    } catch {}
    try {
      if (typeof api.changeQty === "function" && cur > 0) {
        api.changeQty(id, -cur);
        return true;
      }
    } catch {}
    return true;
  }

  // ✅ 不存在：必须 addItem（cart.js 的 setQty 不会凭空造 item）
  if (cur <= 0) {
    if (typeof api.addItem === "function") {
      api.addItem(normalizedItem || { id }, next);
      return true;
    }
    if (typeof api.addToCartWithLimit === "function") {
      api.addToCartWithLimit(normalizedItem || { id });
      return true;
    }
    return false;
  }

  // 已存在：优先 setQty，不行再 changeQty
  try {
    if (typeof api.setQty === "function") {
      api.setQty(id, next);
      return true;
    }
  } catch {}
  try {
    if (typeof api.changeQty === "function") {
      api.changeQty(id, next - cur);
      return true;
    }
  } catch {}
  return false;
}

/* ============================
   ✅ 首页同款“底部合体动作”渲染
   ============================ */
function renderCardAction(card) {
  if (!card) return;
  const pid = String(card.dataset.cartPid || "");
  if (!pid) return;

  const qty = getCartQty(pid);

  const addBtn = card.querySelector(".product-add-fixed[data-add-only]");
  const qtyRow = card.querySelector("[data-qty-row]");
  const qtyDisplay = card.querySelector("[data-qty-display]");
  const badge = card.querySelector(".product-qty-badge");

  if (addBtn) addBtn.style.display = qty <= 0 ? "" : "none";
  if (qtyRow) qtyRow.style.display = qty > 0 ? "flex" : "none";
  if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, qty || 1));

  // ✅ 右下角绿色数量徽章（跟首页一致）
  if (badge) {
    if (qty > 0) {
      badge.textContent = String(qty);
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }
}
function renderAllCardsAction() {
  document.querySelectorAll(".product-card[data-cart-pid]").forEach(renderCardAction);
}

/* ============================
   ✅ 首页同款：图片字段统一 + 价格读取
   ============================ */
function getProductImageUrl(p, seed) {
  const raw =
    (p?.imageUrl && String(p.imageUrl).trim()) ||
    (p?.image && String(p.image).trim()) ||
    (p?.img && String(p.img).trim()) ||
    "";
  if (!raw) return `https://picsum.photos/seed/${encodeURIComponent(seed || "fb")}/500/400`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return location.origin + raw;
  if (raw.startsWith("uploads/")) return location.origin + "/" + raw;
  return raw;
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

/* ============================
   ✅ 首页同款商品卡：单卖 + 整箱两张卡
   - 只有图片/名字跳详情
   - 底部合体：加入购物车 <-> 黑框 +/-
   ============================ */
function buildNormalizedCartItem(p, productId, variant) {
  const vKey = String(variant?.key || "single").trim() || "single";
  const pid = `${productId}::${vKey}`;

  const basePrice = getPrice(p);
  const vPrice =
    variant?.price != null && Number.isFinite(Number(variant.price)) ? Number(variant.price) : null;
  const finalPrice = vPrice != null && vPrice > 0 ? vPrice : basePrice;

  const limitQty = Number(p?.limitQty || p?.limitPerUser || p?.maxQty || p?.purchaseLimit || 0) || 0;

  return {
    id: pid,
    productId,
    variantKey: vKey,
    variants: Array.isArray(p?.variants) ? p.variants : [],

    name: p?.name || "商品",
    price: Number(finalPrice || 0),
    priceNum: Number(finalPrice || 0),
    tag: p?.tag || "",
    type: p?.type || "",
    taxable: !!p?.taxable,

    // 兼容你 cart.js 的特价/爆品判断
    isSpecial: !!(p?.specialEnabled || p?.isSpecial || String(p?.tag || "").includes("爆品")),
    isDeal: !!(p?.isDeal || p?.specialEnabled || p?.isSpecial || String(p?.tag || "").includes("爆品")),

    specialEnabled: !!p?.specialEnabled,
    specialQty: p?.specialQty,
    specialTotalPrice: p?.specialTotalPrice,

    limitQty,
    imageUrl: p?.imageUrl || p?.image || p?.img || "",
  };
}

function createProductCardHomeStyle(p, variant) {
  const productId = String(p?._id || p?.id || "").trim();
  const article = document.createElement("article");
  article.className = "product-card";

  if (!productId) return article;

  const vKey = String(variant?.key || "single").trim() || "single";
  const pid = `${productId}::${vKey}`;
  article.dataset.cartPid = pid;

  const img = getProductImageUrl(p, productId);
  const basePrice = getPrice(p);
  const vPrice =
    variant?.price != null && Number.isFinite(Number(variant.price)) ? Number(variant.price) : null;
  const price = vPrice != null && vPrice > 0 ? vPrice : basePrice;

  const origin = getNum(p, ["originPrice"], 0);
  const hasOrigin = origin > 0 && origin > price;

  const badgeText =
    p?.specialEnabled || p?.isSpecial || String(p?.tag || "").includes("爆品") ? "特价" : "";

  const stock = Number(p?.stock ?? p?.qty ?? p?.inventory ?? 0);
  const stockText = Number.isFinite(stock) && stock > 0 ? `仅剩 ${stock}` : "";

  const vText = variantLabel(variant);
  const detailUrl = productId ? `product_detail.html?id=${encodeURIComponent(productId)}` : "#";

  const normalizedItem = buildNormalizedCartItem(p, productId, variant);
  article.__normalizedItem = normalizedItem;

  article.innerHTML = `
    <div class="product-image-wrap" data-go-detail>
      ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
      <img src="${img}" class="product-image" alt="${(p?.name || "").replace(/"/g, "&quot;")}" />
      <button class="overlay-btn add" type="button" data-add-pid="${pid}">+</button>
      <span class="product-qty-badge" style="display:none;"></span>
    </div>

    <div class="product-name" data-go-detail>${p?.name || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${Number(price || 0).toFixed(2)}</span>
      ${hasOrigin && vKey === "single" ? `<span class="product-origin">$${Number(origin).toFixed(2)}</span>` : ""}
    </div>

    <div class="product-meta-row">
      <span class="product-tagline">${p?.tag || p?.subCategory || ""}${vText ? ` · ${vText}` : ""}</span>
      <span class="product-stock">${stockText}</span>
    </div>

    <div class="product-action">
      <button class="product-add-fixed" type="button" data-add-only data-add-pid="${pid}">加入购物车</button>

      <div class="qty-row" data-qty-row style="display:none;">
        <button class="qty-btn" type="button" data-qty-minus data-qty-pid="${pid}">-</button>
        <span class="qty-num" data-qty-display>1</span>
        <button class="qty-btn" type="button" data-qty-plus data-qty-pid="${pid}">+</button>
      </div>
    </div>
  `;

  renderCardAction(article);
  return article;
}

function createCardsForProduct(p) {
  const singleV = pickSingleVariant(p);
  const boxV = pickBoxVariant(p);

  const cards = [];
  cards.push(createProductCardHomeStyle(p, singleV));
  if (boxV) cards.push(createProductCardHomeStyle(p, boxV));
  return cards;
}

/* ============================
   子分类 pills（保持你原逻辑）
   ============================ */
function rebuildSubCategoryPills() {
  const wrap = document.getElementById("subCategoryPills");
  if (!wrap) return;

  const set = new Set();
  currentProducts.forEach((p) => {
    const s = String(p.subCategory || "").trim();
    if (s) set.add(s);
  });
  const subs = Array.from(set);

  wrap.innerHTML = "";

  const makeBtn = (label, val, active) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (active ? " active" : "");
    btn.textContent = label;
    btn.dataset.filter = val;
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = val;
      applyFilterAndRender();
    });
    return btn;
  };

  wrap.appendChild(makeBtn("全部", "all", currentFilter === "all"));
  subs.forEach((s) => wrap.appendChild(makeBtn(s, s, currentFilter === s)));
}

/* ============================
   4) 加载当前分类商品
   ============================ */
async function loadCategoryProducts() {
  if (!gridEl) return;
  gridEl.innerHTML = "";
  if (emptyTipEl) emptyTipEl.style.display = "none";

  try {
    const { res, data } = await apiFetch(`/api/products?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) throw new Error(data?.message || data?.msg || "加载失败");

    const list = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.products)
      ? data.products
      : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.list)
      ? data.list
      : [];

    const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

    // ✅ 分类页排除爆品
    currentProducts = cleaned.filter((p) => isProductInCategory(p, currentCatKey) && !isHotProduct(p));

    if (categoryStatEl) categoryStatEl.textContent = `共 ${currentProducts.length} 个商品`;

    currentFilter = "all";
    rebuildSubCategoryPills();
    applyFilterAndRender();
  } catch (err) {
    console.error("加载分类商品失败:", err);
    if (emptyTipEl) {
      emptyTipEl.style.display = "block";
      emptyTipEl.textContent = "加载商品失败（请检查商品接口是否为 DB 版）。";
    }
  }
}

/* ============================
   5) 筛选 + 排序 + 搜索
   ============================ */
function applyFilterAndRender() {
  if (!gridEl) return;

  let list = [...currentProducts];

  const kw =
    (searchInputEl && searchInputEl.value.trim()) ||
    (globalSearchInput && globalSearchInput.value.trim()) ||
    "";
  if (kw) {
    const lower = kw.toLowerCase();
    list = list.filter(
      (p) => (p.name || "").toLowerCase().includes(lower) || (p.desc || "").toLowerCase().includes(lower)
    );
  }

  if (currentFilter && currentFilter !== "all") {
    list = list.filter((p) => String(p.subCategory || "") === String(currentFilter));
  }

  const sortVal = sortSelectEl?.value || "default";
  if (sortVal === "priceAsc" || sortVal === "priceDesc") {
    list.sort((a, b) => {
      const pa = Number(a.price || a.specialPrice || a.originPrice || 0);
      const pb = Number(b.price || b.specialPrice || b.originPrice || 0);
      return sortVal === "priceAsc" ? pa - pb : pb - pa;
    });
  }

  gridEl.innerHTML = "";
  if (!list.length) {
    if (emptyTipEl) emptyTipEl.style.display = "block";
    return;
  }
  if (emptyTipEl) emptyTipEl.style.display = "none";

  list.forEach((p) => {
    const cards = createCardsForProduct(p);
    cards.forEach((c) => gridEl.appendChild(c));
  });

  renderAllCardsAction();
}

/* ============================
   6) 顶部登录 UI（保持你原逻辑）
   ============================ */
function applyLoggedInUI(phone) {
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const userProfile = document.getElementById("userProfile");
  const userNameLabel = document.getElementById("userNameLabel");
  const userAvatar = document.getElementById("userAvatar");

  if (!phone) return;

  if (loginBtn) loginBtn.style.display = "none";
  if (registerBtn) registerBtn.style.display = "none";
  if (userProfile) userProfile.style.display = "flex";

  const tail = String(phone).slice(-4);
  if (userNameLabel) userNameLabel.textContent = tail ? "尾号 " + tail : "我的账户";
  if (userAvatar) userAvatar.textContent = "我";
}
function applyLoggedOutUI() {
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const userProfile = document.getElementById("userProfile");
  if (loginBtn) loginBtn.style.display = "";
  if (registerBtn) registerBtn.style.display = "";
  if (userProfile) userProfile.style.display = "none";
}
async function initAuthUIFromStorage() {
  localStorage.removeItem("freshbuy_is_logged_in");

  const tk = getToken();
  if (!tk) {
    applyLoggedOutUI();
    return;
  }

  try {
    const me = await apiMe();
    const phone = me?.phone || getSavedPhone();
    if (phone) applyLoggedInUI(phone);
    else applyLoggedOutUI();
  } catch (e) {
    clearToken();
    applyLoggedOutUI();
  }
}

/* ============================
   7) 登录弹窗（保持你原逻辑）
   ============================ */
const authBackdrop = document.getElementById("authBackdrop");
const authCloseBtn = document.getElementById("authCloseBtn");
const loginBtnTop = document.getElementById("loginBtn");
const registerBtnTop = document.getElementById("registerBtn");

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const authTitle = document.getElementById("authTitle");

const loginPanel = document.getElementById("loginPanel");
const registerPanel = document.getElementById("registerPanel");

const loginPhone = document.getElementById("loginPhone");
const loginPassword = document.getElementById("loginPassword");
const loginRemember = document.getElementById("loginRemember");

const regName = document.getElementById("regName");
const regPhone = document.getElementById("regPhone");
const regPassword = document.getElementById("regPassword");

const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");

function openAuthModal(mode = "login") {
  if (!authBackdrop) {
    alert("当前页面未引入登录弹窗 HTML（authBackdrop）。请从首页复制弹窗结构到 category.html。");
    return;
  }
  authBackdrop.classList.add("active");
  switchAuthMode(mode);

  const savedPhone = getSavedPhone();
  if (savedPhone && loginPhone && loginRemember) {
    loginPhone.value = savedPhone;
    loginRemember.checked = true;
  }
}
function closeAuthModal() {
  if (!authBackdrop) return;
  authBackdrop.classList.remove("active");
}
function switchAuthMode(mode) {
  if (!tabLogin || !tabRegister || !loginPanel || !registerPanel || !authTitle) return;

  if (mode === "login") {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    loginPanel.style.display = "";
    registerPanel.style.display = "none";
    authTitle.textContent = "登录";
  } else {
    tabLogin.classList.remove("active");
    tabRegister.classList.add("active");
    loginPanel.style.display = "none";
    registerPanel.style.display = "";
    authTitle.textContent = "注册";
  }
}

if (loginBtnTop) loginBtnTop.addEventListener("click", () => openAuthModal("login"));
if (registerBtnTop) registerBtnTop.addEventListener("click", () => openAuthModal("register"));

if (authCloseBtn) authCloseBtn.addEventListener("click", closeAuthModal);
if (authBackdrop) {
  authBackdrop.addEventListener("click", (e) => {
    if (e.target === authBackdrop) closeAuthModal();
  });
}
if (tabLogin) tabLogin.addEventListener("click", () => switchAuthMode("login"));
if (tabRegister) tabRegister.addEventListener("click", () => switchAuthMode("register"));

if (loginSubmitBtn) {
  loginSubmitBtn.addEventListener("click", async () => {
    const phone = (loginPhone && loginPhone.value.trim()) || "";
    const pwd = (loginPassword && loginPassword.value) || "";
    if (!phone || !pwd) return alert("请填写手机号和密码");

    try {
      const me = await apiLogin(phone, pwd);

      if (loginRemember && loginRemember.checked) setSavedPhone(phone);
      else clearSavedPhone();

      applyLoggedInUI(me.phone || phone);

      alert("登录成功");
      closeAuthModal();
    } catch (e) {
      alert(e.message || "登录失败");
    }
  });
}

if (registerSubmitBtn) {
  registerSubmitBtn.addEventListener("click", async () => {
    const phone = (regPhone && regPhone.value.trim()) || "";
    const pwd = (regPassword && regPassword.value) || "";
    if (!phone || !pwd) return alert("请填写手机号和密码");

    const name = (regName && regName.value.trim()) || "用户" + String(phone).slice(-4);

    try {
      await apiRegister(name, phone, pwd);
      const me = await apiLogin(phone, pwd);

      setSavedPhone(phone);
      applyLoggedInUI(me.phone || phone);

      alert("注册成功，已自动登录");
      closeAuthModal();
    } catch (e) {
      alert(e.message || "注册失败");
    }
  });
}

/* ============================
   ✅ 统一点击委托（首页同款）
   - 只有图片/名字跳详情（data-go-detail）
   - 加入购物车 / overlay + / 黑框 +/- 都不会跳详情
   ============================ */
document.addEventListener("click", (e) => {
  // 1) 只让图片/名字跳详情
  const go = e.target.closest("[data-go-detail]");
  if (go) {
    const card = go.closest(".product-card");
    const pid = String(card?.dataset?.cartPid || "");
    if (!pid) return;

    const productId = String(pid).split("::")[0];
    if (!productId) return;

    window.location.href = `product_detail.html?id=${encodeURIComponent(productId)}`;
    return;
  }

  // 2) 购物车动作
  const addBtn = e.target.closest(".product-add-fixed[data-add-only]");
  const overlayAddBtn = e.target.closest(".overlay-btn.add[data-add-pid]");
  const minusBtn = e.target.closest("[data-qty-minus]");
  const plusBtn = e.target.closest("[data-qty-plus]");

  if (!addBtn && !overlayAddBtn && !minusBtn && !plusBtn) return;

  e.preventDefault();
  e.stopPropagation();

  const card = e.target.closest(".product-card");
  if (!card) return;

  const pid = String(
    (addBtn && addBtn.dataset.addPid) ||
      (overlayAddBtn && overlayAddBtn.dataset.addPid) ||
      (minusBtn && minusBtn.dataset.qtyPid) ||
      (plusBtn && plusBtn.dataset.qtyPid) ||
      card.dataset.cartPid ||
      ""
  );
  if (!pid) return;

  const item = card.__normalizedItem || { id: pid };
  const cur = getCartQty(pid);

  // 加入购物车 = 设为 1
  if (addBtn) {
    const ok = setCartQty(pid, 1, item);
    if (ok) renderCardAction(card);
    return;
  }

  // overlay + 或 plus
  if (overlayAddBtn || plusBtn) {
    const ok = setCartQty(pid, cur + 1, item);
    if (ok) renderCardAction(card);
    return;
  }

  // minus
  if (minusBtn) {
    const ok = setCartQty(pid, Math.max(0, cur - 1), item);
    if (ok) renderCardAction(card);
    return;
  }
});

// cart.js 更新后同步刷新
window.addEventListener("freshcart:updated", () => {
  renderAllCardsAction();
});

// 多标签页同步
window.addEventListener("storage", (e) => {
  if (!e) return;
  if (e.key === "fresh_cart_v1") renderAllCardsAction();
});

/* ============================
   ✅ 注入“首页图片样式”（确保 category 跟首页一致）
   ============================ */
function injectHomeCardStyleOnce() {
  if (document.getElementById("categoryHomeCardStyle")) return;
  const style = document.createElement("style");
  style.id = "categoryHomeCardStyle";
  style.textContent = `
    .product-card{
      background:#fff;
      border-radius:18px;
      box-shadow: 0 4px 12px rgba(15,23,42,.08);
      padding:12px;
      display:flex;
      flex-direction:column;
      gap:8px;
    }
    /* ✅ 首页同款：图片区域是“白底内嵌卡” + 居中 + cover 不变形 */
    .product-image-wrap{
      position:relative;
      background:#f8fafc;
      border-radius:16px;
      overflow:hidden;
      padding:10px;
      height:190px;            /* 关键：保证跟首页视觉一致 */
      display:flex;
      align-items:center;
      justify-content:center;
    }
    .product-image{
      width:100%;
      height:100%;
      object-fit:contain;       /* ✅ 你要的“首页样式”：瓶子不会被裁切/拉伸 */
      display:block;
    }
    .special-badge{
      position:absolute;
      left:10px;
      top:10px;
      background:#f97316;
      color:#fff;
      font-weight:900;
      font-size:12px;
      padding:6px 10px;
      border-radius:999px;
      z-index:2;
    }
    .overlay-btn.add{
      position:absolute;
      right:12px;
      bottom:12px;
      width:36px;
      height:36px;
      border:none;
      border-radius:12px;
      background: rgba(17,24,39,.88);
      color:#fff;
      font-weight:900;
      font-size:18px;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:2;
    }
    /* ✅ 绿色数量徽章（右侧） */
    .product-qty-badge{
      position:absolute;
      right:12px;
      top:12px;
      min-width:32px;
      height:32px;
      border-radius:999px;
      background:#22c55e;
      color:#fff;
      font-weight:900;
      display:none;
      align-items:center;
      justify-content:center;
      box-shadow: 0 10px 18px rgba(22,163,74,.22);
      z-index:2;
    }

    .product-name{
      font-weight:900;
      font-size:15px;
      line-height:1.25;
      color:#111827;
    }

    .product-price-row{
      display:flex;
      align-items:baseline;
      gap:8px;
    }
    .product-price{
      color:#16a34a;
      font-weight:900;
      font-size:20px;
    }
    .product-origin{
      color:#94a3b8;
      text-decoration:line-through;
      font-size:12px;
      font-weight:700;
    }

    .product-meta-row{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      color:#f97316;
      font-size:12px;
      font-weight:800;
    }
    .product-stock{
      color:#6b7280;
      font-weight:700;
    }

    /* ✅ 底部合体动作：加入购物车 / 黑框 stepper */
    .product-action{ margin-top:6px; }
    .product-add-fixed{
      width:100%;
      height:44px;
      border:none;
      border-radius:14px;
      background: linear-gradient(135deg,#22c55e,#16a34a);
      color:#fff;
      font-weight:900;
      cursor:pointer;
      box-shadow: 0 10px 18px rgba(22,163,74,.18);
    }
    .qty-row{
      width:100%;
      height:44px;
      padding:6px 10px;
      border-radius:14px;
      background:#111827;
      color:#fff;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
    }
    .qty-btn{
      width:44px;
      height:36px;
      border:none;
      border-radius:12px;
      background: rgba(255,255,255,.12);
      color:#fff;
      font-size:18px;
      font-weight:900;
      cursor:pointer;
    }
    .qty-num{
      min-width:28px;
      text-align:center;
      font-weight:900;
      border:2px solid #fff;
      border-radius:10px;
      padding:4px 10px;
    }
  `;
  document.head.appendChild(style);
}

/* ============================
   8) DOMContentLoaded 初始化
   ============================ */
document.addEventListener("DOMContentLoaded", () => {
  injectHomeCardStyleOnce();

  loadCategoryProducts();
  if (sortSelectEl) sortSelectEl.addEventListener("change", applyFilterAndRender);

  if (searchInputEl) {
    searchInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyFilterAndRender();
    });
  }
  if (globalSearchInput) {
    globalSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyFilterAndRender();
    });
  }

  const btnGoHome = document.getElementById("btnGoHome");
  if (btnGoHome) btnGoHome.addEventListener("click", () => (window.location.href = "/user/index.html"));

  const userProfile = document.getElementById("userProfile");
  if (userProfile) {
    userProfile.addEventListener("click", () => {
      window.location.href = "/user/user_center.html";
    });
  }

  initAuthUIFromStorage();

  // 购物车 UI（抽屉）
  if (window.FreshCart && window.FreshCart.initCartUI) {
    window.FreshCart.initCartUI({
      cartIconId: "cartIcon",
      cartBackdropId: "cartBackdrop",
      cartDrawerId: "cartDrawer",
      cartCloseBtnId: "cartCloseBtn",
      cartCountId: "cartCount",
      cartTotalItemsId: "cartTotalItems",
      cartEmptyTextId: "cartEmptyText",
      cartItemsListId: "cartItemsList",
      toastId: "addCartToast",
      goCartBtnId: "goCartBtn",
      cartPageUrl: "/user/cart.html",
    });
  } else {
    console.warn("FreshCart.initCartUI 不存在，请确认 category.html 已引入 cart.js");
  }

  // 首次也刷新一次
  renderAllCardsAction();
});
