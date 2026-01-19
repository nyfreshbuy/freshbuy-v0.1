// assets/js/category.js
console.log("category page script loaded");

// =========================
// Auth (Mongo) helpers - same token key as index.js
// =========================
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

// =========================
// DOM refs
// =========================
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

// ============================
// 1) URL 解析当前大类
// ============================
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

// ============================
// 2) 判断商品属于哪个大类
// ============================
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

// ============================
// 2.5) 爆品判定（分类页排除爆品）
// ============================
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

// ============================
// ✅ 分类页：统一商品卡动作（与首页一致）
// ============================

// 读数量：优先 FreshCart.getQty，其次 Cart.getQty
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

// 设置数量：第一次用 addItem，已有用 setQty/changeQty
function setCartQty(pid, targetQty, normalizedItem) {
  const id = String(pid || "");
  const next = Math.max(0, Math.floor(Number(targetQty || 0)));
  if (!id) return false;

  const api = window.FreshCart || window.Cart;
  if (!api) return false;

  const cur = getCartQty(id);

  // 目标为 0：删/设0
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
      if (typeof api.remove === "function") {
        api.remove(id);
        return true;
      }
    } catch {}
    // 只有 changeQty 的兜底
    try {
      if (typeof api.changeQty === "function" && cur > 0) {
        api.changeQty(id, -cur);
        return true;
      }
    } catch {}
    return true;
  }

  // ✅ 当前不存在：必须 addItem（cart.js 的 setQty 不会创建新 item）
  if (cur <= 0) {
    if (typeof api.addItem === "function") {
      api.addItem(normalizedItem || { id }, next);
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

function renderCardAction(card) {
  if (!card) return;
  const pid = String(card.dataset.cartPid || "");
  if (!pid) return;

  const qty = getCartQty(pid);

  const addBtn = card.querySelector(".product-add-fixed[data-add-only]");
  const qtyRow = card.querySelector("[data-qty-row]");
  const qtyDisplay = card.querySelector("[data-qty-display]");

  if (addBtn) addBtn.style.display = qty <= 0 ? "" : "none";
  if (qtyRow) qtyRow.style.display = qty > 0 ? "flex" : "none";
  if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, qty || 1));
}

function renderAllCardsAction() {
  document.querySelectorAll(".product-card[data-cart-pid]").forEach(renderCardAction);
}

// ============================
// ✅ variants：从商品上挑 “single + box” 两个规格
// ============================
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
  const v =
    vars.find((x) => x.key === "single") ||
    vars.find((x) => x.unitCount === 1) ||
    { key: "single", label: "单个", unitCount: 1, price: null, enabled: true };
  return v;
}

function pickBoxVariant(p) {
  const vars = normalizeVariants(p);

  // 先找 unitCount > 1 的第一个（最常见就是整箱）
  let v = vars.find((x) => x.unitCount > 1 && x.key !== "single");

  // 兜底：key 里带 box/case 的
  if (!v) v = vars.find((x) => /box|case|carton|箱/i.test(x.key));

  // 仍然没有：返回 null（不硬造，避免错箱数）
  return v || null;
}

function variantLabel(v) {
  if (!v) return "";
  const base = v.label || (v.key === "single" ? "单个" : "整箱");
  const uc = Number(v.unitCount || 1);
  if (v.key !== "single" && uc > 1) return `${base}（${uc}个）`;
  return base;
}

// ============================
// 3) 商品卡片（单个/整箱 两张卡）
// - 只有图片/名字可进详情（data-go-detail）
// - 底部合体：qty=0 显示加入购物车；qty>0 显示黑框 +/-
// - overlay + 也统一
// ============================
function createProductCard(p, variant) {
  const article = document.createElement("article");
  article.className = "product-card";

  const productId = String(p._id || p.id || "").trim();
  if (!productId) return article;

  const vKey = String(variant?.key || "single").trim() || "single";
  const pid = `${productId}::${vKey}`;
  article.dataset.cartPid = pid;

  // 价格：单卖用商品主价；整箱优先用 variant.price
  const basePrice = Number(p.price || p.flashPrice || p.specialPrice || p.originPrice || 0) || 0;
  const vPrice = variant?.price != null && Number.isFinite(Number(variant.price)) ? Number(variant.price) : null;
  const finalPrice = vPrice != null && vPrice > 0 ? vPrice : basePrice;

  const originNum = Number(p.originPrice || 0) || 0;
  const hasOrigin = originNum > 0 && originNum > finalPrice;

  const imageUrl =
    p.image && String(p.image).trim()
      ? p.image
      : `https://picsum.photos/seed/${productId}/500/400`;

  const badgeText =
    p.specialEnabled || p.isSpecial || (p.tag || "").includes("爆品") ? "特价" : "";

  // ✅ 给 cart.js 用：必须有 id + variantKey + variants
  const normalizedItem = {
    id: pid,
    productId,
    variantKey: vKey,
    variants: Array.isArray(p?.variants) ? p.variants : [],

    name: p.name || "商品",
    price: finalPrice,
    priceNum: finalPrice,
    tag: p.tag || "",
    type: p.type || "",
    taxable: !!p.taxable,
    isDeal: !!(p.isDeal || p.specialEnabled || p.isSpecial || (p.tag || "").includes("爆品")),
    specialEnabled: !!p.specialEnabled,
    specialQty: p.specialQty,
    specialTotalPrice: p.specialTotalPrice,

    imageUrl: p.image || p.imageUrl || p.img || "",
  };
  article.__normalizedItem = normalizedItem;

  const vText = variantLabel(variant);

  article.innerHTML = `
    <div class="product-image-wrap" data-go-detail>
      ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
      <img src="${imageUrl}" class="product-image" alt="${(p.name || "").replace(/"/g, "&quot;")}" />
      <button class="overlay-btn add" type="button" data-add-pid="${pid}">+</button>
    </div>

    <div class="product-name" data-go-detail>${p.name || ""}</div>

    <div class="product-desc">${p.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${Number(finalPrice || 0).toFixed(2)}</span>
      ${hasOrigin && vKey === "single" ? `<span class="product-origin">$${originNum.toFixed(2)}</span>` : ""}
      <span class="product-tagline">${vText || (p.tag || p.subCategory || "")}</span>
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

  // 初次渲染数量
  renderCardAction(article);

  return article;
}

// ============================
// 子分类 pills（保留你原逻辑）
// ============================
function rebuildSubCategoryPills() {
  const wrap = document.getElementById("subCategoryPills");
  if (!wrap) {
    console.warn("未找到 #subCategoryPills（请在 category.html 给子分类按钮容器加 id=subCategoryPills）");
    return;
  }

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

// ============================
// 4) 加载当前分类商品
// ============================
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

// ============================
// 5) 筛选 + 排序 + 搜索 + 渲染（单个/整箱两张卡）
// ============================
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
      (p) =>
        (p.name || "").toLowerCase().includes(lower) ||
        (p.desc || "").toLowerCase().includes(lower)
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

  // ✅ 每个商品：单个 +（如果有）整箱
  list.forEach((p) => {
    const singleV = pickSingleVariant(p);
    const boxV = pickBoxVariant(p);

    gridEl.appendChild(createProductCard(p, singleV));
    if (boxV) gridEl.appendChild(createProductCard(p, boxV));
  });

  // 渲染完立即对齐数量
  renderAllCardsAction();
}

// ============================
// 6) 顶部登录 UI（保留你原逻辑）
// ============================
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

// ============================
// 7) 登录弹窗（保持你原逻辑）
// ============================
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

// ============================
// ✅✅✅ 分类页：统一点击委托（加入购物车 + overlay + 黑框 +/-）
// 只让图片/名字跳详情：用 data-go-detail 控制
// ============================
document.addEventListener("click", (e) => {
  // 仅图片/名字可跳详情
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

  const addBtn = e.target.closest(".product-add-fixed[data-add-only]");
  const overlayAddBtn = e.target.closest(".overlay-btn.add[data-add-pid]");
  const minusBtn = e.target.closest("[data-qty-minus]");
  const plusBtn = e.target.closest("[data-qty-plus]");

  if (!addBtn && !overlayAddBtn && !minusBtn && !plusBtn) return;

  e.preventDefault();

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

  if (addBtn) {
    const ok = setCartQty(pid, 1, item);
    if (ok) renderCardAction(card);
    return;
  }

  if (overlayAddBtn || plusBtn) {
    const ok = setCartQty(pid, cur + 1, item);
    if (ok) renderCardAction(card);
    return;
  }

  if (minusBtn) {
    const ok = setCartQty(pid, Math.max(0, cur - 1), item);
    if (ok) renderCardAction(card);
    return;
  }
});

// 购物车变更后，刷新所有卡片底部显示
window.addEventListener("freshcart:updated", () => {
  renderAllCardsAction();
});

// ============================
// 8) DOMContentLoaded 初始化
// ============================
document.addEventListener("DOMContentLoaded", () => {
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
    console.warn("FreshCart.initCartUI 不存在，请确认已经引入 cart.js");
  }

  // 首次也刷新一次（防止初始 qty 不对）
  renderAllCardsAction();
});
