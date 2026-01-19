// frontend/user/assets/js/category.js
console.log("category page script loaded (renderer-driven)");

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
let currentProductsRaw = [];      // 原始商品（不拆卡）
let currentProductsView = [];     // 拆卡后的视图（单卖/整箱两张）
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
// 子分类 pills（基于原始商品的 subCategory）
// ============================
function rebuildSubCategoryPills() {
  const wrap = document.getElementById("subCategoryPills");
  if (!wrap) return;

  const set = new Set();
  currentProductsRaw.forEach((p) => {
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
// 4) 加载当前分类商品（只拿数据，不自己拼卡）
// ============================
async function loadCategoryProducts() {
  if (!gridEl) return;
  gridEl.innerHTML = "";
  if (emptyTipEl) emptyTipEl.style.display = "none";

  // ✅ 必须有渲染器
  if (!window.FBCard) {
    console.error("❌ FBCard 不存在：请检查是否引入 product_card_renderer.js");
    if (emptyTipEl) {
      emptyTipEl.style.display = "block";
      emptyTipEl.textContent = "页面缺少商品卡渲染器（product_card_renderer.js）。";
    }
    return;
  }

  try {
    const { res, data } = await apiFetch(`/api/products-simple?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) throw new Error(data?.message || data?.msg || "加载失败");

    const list = window.FBCard.extractList(data);
    const cleaned = list.filter((p) => !p.isDeleted && p.deleted !== true && p.status !== "deleted");

    // ✅ 分类页：先按大类筛，再排除爆品（只保留普通商品）
    currentProductsRaw = cleaned.filter((p) => isProductInCategory(p, currentCatKey) && !isHotProduct(p));

    if (categoryStatEl) categoryStatEl.textContent = `共 ${currentProductsRaw.length} 个商品`;

    // ✅ 拆卡：单卖/整箱两张卡（跟首页一致）
    currentProductsView = window.FBCard.expand(currentProductsRaw);

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
// 5) 筛选 + 排序 + 搜索（最后交给 FBCard.renderGrid 输出卡片）
// ============================
function getNum(p, keys, def = 0) {
  for (const k of keys) {
    const v = p?.[k];
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n) && n !== 0) return n;
  }
  return def;
}

function getPriceForSort(p) {
  // ✅ 对拆卡视图：如果是整箱卡，优先用 variant price（__displayPrice）
  const vPrice = p?.__displayPrice;
  if (vPrice != null && Number.isFinite(Number(vPrice))) return Number(vPrice);
  return getNum(p, ["price", "flashPrice", "specialPrice", "originPrice"], 0);
}

function applyFilterAndRender() {
  if (!gridEl) return;
  if (!window.FBCard) return;

  let list = [...currentProductsView];

  // 搜索
  const kw =
    (searchInputEl && searchInputEl.value.trim()) ||
    (globalSearchInput && globalSearchInput.value.trim()) ||
    "";

  if (kw) {
    const lower = kw.toLowerCase();
    list = list.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(lower) ||
        (p.__displayName || "").toLowerCase().includes(lower) ||
        (p.desc || "").toLowerCase().includes(lower)
    );
  }

  // 子分类过滤（注意：拆卡后的 item 仍带原始 subCategory）
  if (currentFilter && currentFilter !== "all") {
    list = list.filter((p) => String(p.subCategory || "") === String(currentFilter));
  }

  // 排序
  const sortVal = sortSelectEl?.value || "default";
  if (sortVal === "priceAsc" || sortVal === "priceDesc") {
    list.sort((a, b) => {
      const pa = getPriceForSort(a);
      const pb = getPriceForSort(b);
      return sortVal === "priceAsc" ? pa - pb : pb - pa;
    });
  }

  // 渲染
  if (!list.length) {
    gridEl.innerHTML = "";
    if (emptyTipEl) {
      emptyTipEl.style.display = "block";
      emptyTipEl.textContent = "当前筛选条件下没有商品。";
    }
    return;
  }
  if (emptyTipEl) emptyTipEl.style.display = "none";

  // ✅ 关键：统一用公共渲染器输出卡片（HTML/overlay/动作区/跳转规则/徽章/库存上限）
  window.FBCard.renderGrid(gridEl, list, { badgeText: "" });
}

// ============================
// 6) 顶部登录 UI
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
// 8) DOMContentLoaded 初始化
// ============================
document.addEventListener("DOMContentLoaded", () => {
  // ✅ 统一商品卡：全局绑定（只做一次，会自动去重）
  if (window.FBCard && typeof window.FBCard.ensureGlobalBindings === "function") {
    window.FBCard.ensureGlobalBindings();
  }

  // ✅ 分类页也开启库存轮询（跟首页一样，库存变化会 clamp 数量 + 更新“已售罄/剩余”）
  if (window.FBCard && typeof window.FBCard.startStockPolling === "function") {
    window.FBCard.startStockPolling(); // 默认 15s，可传 ms
  }

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
});
