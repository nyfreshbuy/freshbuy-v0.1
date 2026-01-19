// frontend/user/assets/js/index.js
// =======================================================
// 在鲜购拼好货 - 用户首页 JS（适配你现在这版 index.html 布局）
// 1) 顶部分类
// 2) 配送模式 + 倒计时 + 好友拼单弹窗
// 3) 首页商品：5 大区块 + 全部商品
// 4) 登录 / 注册弹窗 + 头像（✅ 已接 MongoDB 真接口）
// 5) 购物车 UI（如果有 window.FreshCart 就用，没有也不报错）
// 6) ZIP -> DB zones resolve + 自动选区域团 + ETA + 通知 cart.js
// ✅ 7) 登录用户 ZIP：从 /api/addresses/my.defaultAddress 读取并锁定（真正来源）
// ✅ 8) 左右 ZIP 输入框：登录锁定 + 退出/未登录解锁（✅ 仅锁 ZIP，不影响其它按钮）
// ✅ 9) 修复：点击 次日配送/好友拼单 时，右侧信息不再被 ZIP 匹配强制改回“区域团”
// ✅ 10) 修复：右侧只渲染到 #deliveryInfoBody，不覆盖右侧 ZIP box
// ✅ 11) 区域团：按 zone.name 区分“白石镇/大学点 vs 新鲜草原”的配送时间文案 + 真实截单倒计时
// ✅ 12) 商品图片右下角数量徽章：插入 DOM + 加购后立刻显示 + 同步 cart 更新（强兜底）
// ✅ 13) 库存规则（前台体验 + 强兜底）：
//     - 单个：max=stock
//     - 整箱：max=floor(stock/unitCount)
//     - 徽章 = min(购物车数量, 卡片可买上限)
// ✅ 14) 自动刷新库存：轮询 /api/products-simple → 更新卡片状态/按钮/文案/徽章
// ✅ 15) 整箱显示「仅剩 X 箱」
// ✅ 16) 去掉数量输入框：只保留 +/-（防止用户乱输）
// =======================================================

console.log("✅ index.js UPDATED AT:", new Date().toISOString());
console.log("Freshbuy index main script loaded (db-zones version)");

// =========================
// 0) 顶部分类条
// =========================
const categoryBar = document.getElementById("categoryBar");

const fallbackCategories = [
  { key: "home", name: "首页" },
  { key: "fresh", name: "生鲜果蔬" },
  { key: "meat", name: "肉禽海鲜" },
  { key: "snacks", name: "零食饮品" },
  { key: "staples", name: "粮油主食" },
  { key: "seasoning", name: "调味酱料" },
  { key: "frozen", name: "冷冻食品" },
  { key: "household", name: "日用清洁" },
];

async function loadCategories() {
  renderCategoryPills(fallbackCategories);
}

const SECTION_LIMITS = {
  desktop: {
    default: 8, // 电脑端所有区块默认 8
  },
  mobile: {
    Hot: 6, // 新客体验专区
    DailySpecial: 8, // 家庭必备
    New: 6, // 新品上市
    Best: 8, // 产销商品
    Normal: 4, // 全部商品
    default: 6,
  },
};

function money(n) {
  const v = Number(n || 0);
  return v % 1 === 0 ? String(v.toFixed(0)) : String(v.toFixed(2));
}

function getSpecialText(p) {
  if (!p || !p.specialEnabled) return "";
  const qty = Math.max(1, Math.floor(Number(p.specialQty || 1)));
  const total = p.specialTotalPrice == null ? null : Number(p.specialTotalPrice);
  if (qty > 1 && Number.isFinite(total) && total > 0) {
    return `${qty} for $${money(total)}`;
  }
  const sp = p.specialPrice == null ? null : Number(p.specialPrice);
  if (Number.isFinite(sp) && sp > 0) return `特价 $${money(sp)}`;
  return "";
}

function buildVariantPriceLines(p) {
  const vs = Array.isArray(p?.variants) ? p.variants.filter((v) => v && v.enabled !== false) : [];
  if (!vs.length) return "";
  const boxes = vs
    .filter((v) => Number(v.unitCount || 1) > 1)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  if (!boxes.length) return "";
  const lines = boxes.map((v) => {
    const boxPrice =
      v.price != null && Number(v.price) > 0
        ? Number(v.price)
        : Number(p.price || p.originPrice || 0) * Number(v.unitCount || 1);
    const label = v.label || `整箱(${Number(v.unitCount || 1)}个)`;
    return `<div class="variant-line">📦 ${label}：$${money(boxPrice)}</div>`;
  });
  return `<div class="variant-box">${lines.join("")}</div>`;
}

function isMobileView() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function getLimit(sectionKey) {
  if (!isMobileView()) return SECTION_LIMITS.desktop.default;
  return SECTION_LIMITS.mobile[sectionKey] ?? SECTION_LIMITS.mobile.default;
}

function renderCategoryPills(list) {
  if (!categoryBar) return;
  categoryBar.innerHTML = "";

  list.forEach((cat, idx) => {
    const link = document.createElement("a");
    link.className = "cat-pill" + (idx === 0 ? " active" : "");
    link.dataset.category = cat.key;
    link.textContent = cat.name;

    if (cat.key === "home" || cat.name === "首页") {
      link.href = "index.html";
    } else {
      const displayName = cat.name || cat.key;
      link.href =
        "category.html?cat=" +
        encodeURIComponent(cat.key) +
        "&name=" +
        encodeURIComponent(displayName);
    }

    categoryBar.appendChild(link);
  });
}

// 顶部“查看全部” & 左侧快捷入口滚动
function scrollToSection(selectorOrId) {
  const sel = selectorOrId.startsWith("#") || selectorOrId.startsWith(".") ? selectorOrId : "#" + selectorOrId;
  const el = document.querySelector(sel);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const offset = window.scrollY + rect.top - 80;
  window.scrollTo({ top: offset, behavior: "smooth" });
}

// 左侧快捷入口
document.querySelectorAll(".side-rail-item[data-scroll]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.scroll;
    if (!target) return;
    scrollToSection(target);
  });
});

// =========================
// 1) 配送模式 + 倒计时 + 好友拼单弹窗
// =========================

// ✅ 右侧只渲染到 deliveryInfoBody，保留 ZIP box
const deliveryHint = document.getElementById("deliveryHint");
const deliveryInfo = document.getElementById("deliveryInfo");
const deliveryInfoBody = document.getElementById("deliveryInfoBody");

// ✅ 用户是否“手动选择过配送模式”
const MODE_USER_SELECTED_KEY = "freshbuy_user_selected_mode";

// ✅ 区域团时间文案：按 zone.name 区分
const ZONE_SCHEDULE = {
  "白石镇/大学点地区": {
    eta: "本周六 18:00 - 22:00",
    cutoff: { weekday: 5, hour: 23, minute: 59, second: 59 },
    cutoffText: "周五 23:59:59",
  },
  "新鲜草原地区": {
    eta: "本周五 18:00 - 22:00",
    cutoff: { weekday: 4, hour: 23, minute: 59, second: 59 },
    cutoffText: "周四 23:59:59",
  },
};

function getZoneSchedule(zoneName) {
  const key = String(zoneName || "").trim();
  return (
    ZONE_SCHEDULE[key] || {
      eta: "本周五 18:00 - 22:00",
      cutoff: { weekday: 5, hour: 23, minute: 59, second: 59 },
      cutoffText: "配送前一天 23:59:59 前",
    }
  );
}

const deliveryStats = {
  "area-group": {
    areaName: "区域团",
    joinedOrders: 36,
    needOrders: 50,
  },
  "friend-group": {
    joinedUsers: 3,
    avgFee: 1.99,
    minAmount: 29,
  },
  "next-day": {
    cutOff: "每天 23:59:59 截单",
    delivery: "次日 18:00 - 22:00 送达",
  },
};

let groupEndTime = null;
let countdownTimer = null;
let friendEndTime = null;
let friendCountdownTimer = null;

// ✅ 区域团：真实截单倒计时（按 zone 的 cutoff 计算）
function getNextCutoffDate(cutoff) {
  const now = new Date();
  const target = new Date(now);

  const nowWeekday = now.getDay();
  const targetWeekday = Number(cutoff?.weekday ?? 5);

  let addDays = (targetWeekday - nowWeekday + 7) % 7;
  target.setDate(now.getDate() + addDays);

  target.setHours(cutoff?.hour ?? 23, cutoff?.minute ?? 59, cutoff?.second ?? 59, 0);

  if (addDays === 0 && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 7);
  }

  return target;
}

function startAreaGroupCountdownTo(endDate) {
  if (countdownTimer) clearInterval(countdownTimer);
  groupEndTime = endDate instanceof Date ? endDate : null;
  countdownTimer = setInterval(updateAreaCountdown, 1000);
  updateAreaCountdown();
}

function updateAreaCountdown() {
  const el = document.getElementById("areaCountdown");
  if (!el || !groupEndTime) {
    if (el) el.textContent = "--:--:--";
    return;
  }

  const now = new Date();
  let diff = Math.max(0, groupEndTime - now);

  const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
  diff %= 3600000;
  const m = String(Math.floor(diff / 60000)).padStart(2, "0");
  diff %= 60000;
  const s = String(Math.floor(diff / 1000)).padStart(2, "0");

  el.textContent = `${h}:${m}:${s}`;

  if (groupEndTime <= now && countdownTimer) {
    clearInterval(countdownTimer);
  }
}

// 好友拼单倒计时到今晚 24:00
function startFriendCountdownToMidnight() {
  if (friendCountdownTimer) clearInterval(friendCountdownTimer);
  const now = new Date();
  friendEndTime = new Date(now);
  friendEndTime.setHours(24, 0, 0, 0);
  friendCountdownTimer = setInterval(updateFriendCountdown, 1000);
  updateFriendCountdown();
}

function updateFriendCountdown() {
  if (!friendEndTime) return;
  const now = new Date();
  let diff = Math.max(0, friendEndTime - now);
  const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
  diff %= 3600000;
  const m = String(Math.floor(diff / 60000)).padStart(2, "0");
  diff %= 60000;
  const s = String(Math.floor(diff / 1000)).padStart(2, "0");
  const text = `${h}:${m}:${s}`;
  const el1 = document.getElementById("friendCountdown");
  const el2 = document.getElementById("friendModalCountdown");
  if (el1) el1.textContent = text;
  if (el2) el2.textContent = text;
  if (friendEndTime - now <= 0 && friendCountdownTimer) clearInterval(friendCountdownTimer);
}

// ✅ 统一：只写 #deliveryInfoBody，不覆盖右侧 ZIP box
function renderDeliveryInfo(mode) {
  if (!deliveryHint || !deliveryInfoBody) return;

  const z = getSavedZoneBrief();
  const zoneName = z?.name || deliveryStats["area-group"].areaName || "区域团";
  const schedule = getZoneSchedule(zoneName);

  if (mode === "area-group") {
    const st = deliveryStats["area-group"];
    const remain = Math.max(0, st.needOrders - st.joinedOrders);

    deliveryHint.textContent = `当前：区域团拼单配送 · ${zoneName} · 凑够成团免费配送`;
    deliveryInfoBody.innerHTML = `
      <div class="delivery-info-title">区域团拼单配送 · ${zoneName}</div>
      <ul class="delivery-info-list">
        <li>已拼：<span class="delivery-highlight">${st.joinedOrders} 单</span></li>
        <li>还差：<span class="delivery-highlight">${remain} 单</span> 即可成团（成团后 <strong>免费配送</strong>）</li>
        <li>预计送达时间：<span class="delivery-highlight">${schedule.eta}</span></li>
        <li>截单：<span class="delivery-highlight">${schedule.cutoffText}</span></li>
        <li>距离本团截单：<span class="delivery-countdown" id="areaCountdown">--:--:--</span></li>
      </ul>
    `;

    const cutoffDate = getNextCutoffDate(schedule.cutoff);
    startAreaGroupCountdownTo(cutoffDate);
    return;
  }

  if (mode === "next-day") {
    const st = deliveryStats["next-day"];
    deliveryHint.textContent = `当前：次日配送 · 适合少量临时补货`;
    deliveryInfoBody.innerHTML = `
      <div class="delivery-info-title">次日配送</div>
      <ul class="delivery-info-list">
        <li>截单：<span class="delivery-highlight">${st.cutOff}</span></li>
        <li>预计送达：<span class="delivery-highlight">${st.delivery}</span></li>
        <li style="color:#6b7280;">提示：下单仍以你的收货地址为准</li>
      </ul>
    `;
    return;
  }

  if (mode === "friend-group") {
    const st = deliveryStats["friend-group"];
    deliveryHint.textContent = `当前：好友拼单配送 · 拼单平摊运费`;
    deliveryInfoBody.innerHTML = `
      <div class="delivery-info-title">好友拼单配送</div>
      <ul class="delivery-info-list">
        <li>当前拼单人数：<span class="delivery-highlight">${st.joinedUsers}</span> 人</li>
        <li>预计人均运费：<span class="delivery-highlight">$${Number(st.avgFee || 0).toFixed(2)}</span></li>
        <li>建议起送金额：<span class="delivery-highlight">$${Number(st.minAmount || 0).toFixed(2)}</span></li>
        <li>有效期倒计时：<span class="delivery-countdown" id="friendCountdown">--:--:--</span></li>
      </ul>
    `;
    startFriendCountdownToMidnight();
    return;
  }

  deliveryHint.textContent = `当前：区域团拼单配送 · ${zoneName}`;
  deliveryInfoBody.innerHTML = `
    <div class="delivery-info-title">配送信息</div>
    <div style="color:#6b7280;">请选择配送方式</div>
  `;
}

// 默认区域团拼单
renderDeliveryInfo("area-group");

// 点击切换配送模式（+ 好友拼单弹窗）
document.addEventListener("click", (e) => {
  const pill = e.target.closest(".delivery-pill");
  if (!pill) return;

  document.querySelectorAll(".delivery-pill").forEach((btn) => btn.classList.remove("active"));
  pill.classList.add("active");

  const mode = pill.dataset.mode;

  localStorage.setItem(MODE_USER_SELECTED_KEY, "1");
  renderDeliveryInfo(mode);

  try {
    function toCartModeKey(m) {
      if (m === "area-group") return "groupDay";
      if (m === "next-day") return "normal";
      if (m === "friend-group") return "friendGroup";
      return "groupDay";
    }
    const mapped = toCartModeKey(mode || "");
    localStorage.setItem("freshbuy_pref_mode", mapped);
    window.dispatchEvent(new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: mapped } }));
  } catch {}

  if (mode === "friend-group") openShareModal();
});

// 好友拼单分享弹窗
const shareBackdrop = document.getElementById("shareBackdrop");
const shareInput = document.getElementById("shareInput");
const shareCopyBtn = document.getElementById("shareCopyBtn");
const shareCloseBtn = document.getElementById("shareCloseBtn");

function openShareModal() {
  if (!shareBackdrop || !shareInput) return;
  const url = window.location.origin + "/user/index.html?mode=friend-group&ts=" + Date.now();
  shareInput.value = url;
  shareBackdrop.classList.add("active");
  startFriendCountdownToMidnight();
}

function closeShareModal() {
  if (!shareBackdrop) return;
  shareBackdrop.classList.remove("active");
}

if (shareBackdrop) {
  shareBackdrop.addEventListener("click", (e) => {
    if (e.target === shareBackdrop) closeShareModal();
  });
}
if (shareCloseBtn) shareCloseBtn.addEventListener("click", closeShareModal);

if (shareCopyBtn && shareInput) {
  shareCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareInput.value);
      shareCopyBtn.textContent = "已复制";
      setTimeout(() => (shareCopyBtn.textContent = "复制"), 1200);
    } catch {
      shareCopyBtn.textContent = "复制失败";
      setTimeout(() => (shareCopyBtn.textContent = "复制"), 1200);
    }
  });
}

// 如果通过好友拼单链接进入，自动切换模式
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search || "");
  if (params.get("mode") === "friend-group") {
    const btn = document.querySelector('.delivery-pill[data-mode="friend-group"]');
    if (btn) btn.click();
  }
});

// ✅ 最终兜底：强制恢复顶部商品分类
setTimeout(() => {
  try {
    renderCategoryPills(fallbackCategories);
    console.log("✅ 顶部分类已强制恢复");
  } catch (e) {
    console.warn("恢复顶部分类失败", e);
  }
}, 0);

// =========================
// 2) 商品卡片 + 首页商品（按你现在的 5 个区块）
// =========================

// ✅ variants 展开：同一商品 -> 多个“展示商品”（单个/整箱）
function expandProductsWithVariants(list) {
  const out = [];
  const arr = Array.isArray(list) ? list : [];

  for (const p of arr) {
    const productId = String(p?._id || p?.id || "").trim();
    const variants = Array.isArray(p?.variants) ? p.variants : [];

    if (!variants.length) {
      const vKey = "single";
      out.push({
        ...p,
        __productId: productId,
        __variantKey: vKey,
        __variantLabel: "单个",
        __unitCount: 1,
        __displayName: p?.name || "",
        __displayPrice: null,
        __cartKey: productId ? `${productId}::${vKey}` : String(p?.sku || p?.id || ""),
      });
      continue;
    }

    const enabledVars = variants.filter((v) => v && v.enabled !== false);
    if (!enabledVars.length) {
      const vKey = "single";
      out.push({
        ...p,
        __productId: productId,
        __variantKey: vKey,
        __variantLabel: "单个",
        __unitCount: 1,
        __displayName: p?.name || "",
        __displayPrice: null,
        __cartKey: productId ? `${productId}::${vKey}` : String(p?.sku || p?.id || ""),
      });
      continue;
    }

    for (const v of enabledVars) {
      const vKey = String(v.key || "single").trim() || "single";
      const unitCount = Math.max(1, Math.floor(Number(v.unitCount || 1)));

      const vLabel = String(v.label || "").trim() || (unitCount > 1 ? `整箱(${unitCount}个)` : "单个");

      const vPrice = v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null;

      out.push({
        ...p,
        __productId: productId,
        __variantKey: vKey,
        __variantLabel: vLabel,
        __unitCount: unitCount,
        __displayName: `${p?.name || ""} - ${vLabel}`,
        __displayPrice: vPrice,
        __cartKey: productId ? `${productId}::${vKey}` : String(p?.sku || p?.id || ""),
      });
    }
  }

  return out;
}

const cartConfig = {
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
};

// 小工具：后端勾选框可能是 true/"true"/1/"1"
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// 小工具：在各种字段里找关键字（支持 tags/labels/type/category/tag）
function hasKeyword(p, keyword) {
  if (!p) return false;
  const kw = String(keyword).toLowerCase();
  const norm = (v) => (v ? String(v).toLowerCase() : "");

  const fields = [p.tag, p.type, p.category, p.subCategory, p.mainCategory, p.subcategory, p.section];
  if (fields.some((f) => norm(f).includes(kw))) return true;

  if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(kw))) return true;
  if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw))) return true;

  return false;
}

// 是否爆品
function isHotProduct(p) {
  return (
    isTrueFlag(p.isHot) ||
    isTrueFlag(p.isHotDeal) ||
    isTrueFlag(p.hotDeal) ||
    hasKeyword(p, "爆品") ||
    hasKeyword(p, "爆品日") ||
    hasKeyword(p, "hot")
  );
}

function isSpecialDeal(p) {
  if (isTrueFlag(p.isSpecial) || isTrueFlag(p.isDailySpecial) || isTrueFlag(p.onSale) || isTrueFlag(p.isSale))
    return true;

  const basePrice = Number(p.price ?? p.regularPrice ?? p.originPrice ?? 0);
  const salePrice = Number(p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0);

  if (basePrice > 0 && salePrice > 0 && salePrice < basePrice) return true;

  const origin = Number(p.originPrice ?? p.originalPrice ?? 0);
  const price = Number(p.price ?? 0);
  if (origin > 0 && price > 0 && origin > price) return true;

  const discount = Number(p.discount ?? p.discountPercent ?? 0);
  if (discount > 0) return true;

  return false;
}

function isFamilyProduct(p) {
  return isSpecialDeal(p);
}

function isBestSellerProduct(p) {
  return (
    isTrueFlag(p.isBest) ||
    isTrueFlag(p.isBestSeller) ||
    hasKeyword(p, "畅销") ||
    hasKeyword(p, "热销") ||
    hasKeyword(p, "top")
  );
}

function isNewProduct(p) {
  const flag =
    isTrueFlag(p.isNew) || isTrueFlag(p.isNewArrival) || hasKeyword(p, "新品") || hasKeyword(p, "新上架");

  if (!flag) return false;

  const dateStr = p.newUntil || p.newExpireAt || p.newExpiresAt;
  if (!dateStr) return true;

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now();
}

// ================================
// ✅✅✅ 商品图片右下角数量徽章工具函数（强兜底）
// 徽章 = min(购物车数量, 卡片可买上限card.__maxQty)
// ================================
function setProductBadge(pid, cartQty) {
  const els = document.querySelectorAll(`.product-qty-badge[data-pid="${pid}"]`);
  if (!els || !els.length) return;

  const raw = Math.max(0, Math.floor(Number(cartQty || 0) || 0));

  els.forEach((el) => {
    const card = el.closest(".product-card");
    const cap0 = Number(card?.__maxQty);
    const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : Infinity;

    const showQty = Math.min(raw, cap);

    if (showQty > 0) {
      el.textContent = showQty >= 99 ? "99+" : String(showQty);
      el.style.display = "flex";
    } else {
      el.textContent = "";
      el.style.display = "none";
    }
  });
}

// ✅ 更强：从 FreshCart / Cart / localStorage 自动找“像购物车”的数据
function getCartSnapshot() {
  try {
    const fc = window.FreshCart;
    if (fc) {
      if (typeof fc.getCart === "function") return fc.getCart();
      if (typeof fc.getState === "function") return fc.getState();
      if (typeof fc.getItems === "function") return { items: fc.getItems() };
      if (Array.isArray(fc.items)) return { items: fc.items };
      if (fc.cart) return fc.cart;
      if (fc.state) return fc.state;
    }
  } catch {}

  try {
    const c = window.Cart;
    if (c) {
      if (typeof c.getCart === "function") return c.getCart();
      if (typeof c.getState === "function") return c.getState();
      if (typeof c.getItems === "function") return { items: c.getItems() };
      if (Array.isArray(c.items)) return { items: c.items };
      if (c.cart) return c.cart;
      if (c.state) return c.state;
    }
  } catch {}

  try {
    const candidates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.toLowerCase().includes("cart")) candidates.push(k);
    }

    candidates.sort((a, b) => {
      const A = a.toLowerCase();
      const B = b.toLowerCase();
      const score = (s) => (s.includes("freshbuy") ? 10 : 0) + (s.includes("fb") ? 3 : 0) + (s.includes("cart") ? 1 : 0);
      return score(B) - score(A);
    });

    for (const k of candidates) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const t = raw.trim();
      if (!t.startsWith("{") && !t.startsWith("[")) continue;

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (parsed) return parsed;
    }
  } catch {}

  return null;
}

// ✅ 把各种“购物车结构”统一成 { [pid/cartKey]: qty }
function normalizeCartToQtyMap(cart) {
  const map = {};
  if (!cart) return map;

  function findItems(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    if (Array.isArray(obj)) {
      if (obj.length && typeof obj[0] === "object") return obj;
      return null;
    }
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.cart?.items)) return obj.cart.items;
    if (Array.isArray(obj.state?.items)) return obj.state.items;
    if (Array.isArray(obj.state?.cart?.items)) return obj.state.cart.items;
    if (Array.isArray(obj.data?.items)) return obj.data.items;
    if (Array.isArray(obj.payload?.items)) return obj.payload.items;

    for (const key of Object.keys(obj)) {
      const got = findItems(obj[key], depth + 1);
      if (got) return got;
    }
    return null;
  }

  const items = findItems(cart);

  if (Array.isArray(items)) {
    items.forEach((it) => {
      const id = String(
        it.id ||
          it.pid ||
          it.productId ||
          it.product_id ||
          it.sku ||
          it._id ||
          it.product?._id ||
          it.product?.id ||
          it.product?.sku ||
          ""
      ).trim();

      const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.num ?? it.amount ?? it.n ?? it.q ?? 0);

      if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
    });
    return map;
  }

  if (typeof cart === "object") {
    for (const k of Object.keys(cart)) {
      const v = cart[k];
      if (!k) continue;

      const lk = String(k).toLowerCase();
      if (lk === "total" || lk === "meta" || lk === "items" || lk === "cart" || lk === "state" || lk === "data") continue;

      const id = String(k).trim();
      const qty = Number(v?.qty ?? v?.quantity ?? v?.count ?? v ?? 0);
      if (id && Number.isFinite(qty)) map[id] = (map[id] || 0) + qty;
    }
  }

  return map;
}

function trySyncBadgesFromCart() {
  const cart = getCartSnapshot();
  const qtyMap = normalizeCartToQtyMap(cart);

  document.querySelectorAll(".product-qty-badge[data-pid]").forEach((el) => {
    const pid = el.getAttribute("data-pid");
    setProductBadge(pid, qtyMap[pid] || 0);
  });
}

// ✅ 轻量节流，避免频繁同步抖动
let __badgeSyncTimer = null;
function scheduleBadgeSync() {
  if (__badgeSyncTimer) return;
  __badgeSyncTimer = setTimeout(() => {
    __badgeSyncTimer = null;
    trySyncBadgesFromCart();
  }, 50);
}
// =====================================================
// ✅✅✅ 统一模块：购物车数量 set/get + 卡片显示切换（加入购物车 ↔ 黑框）
// =====================================================

// 1) 获取某个 pid 在购物车里的数量（pid 是你的 cartKey：productId::variantKey）
function getCartQty(pid) {
  const snap = getCartSnapshot();
  const map = normalizeCartToQtyMap(snap);
  return Math.max(0, Math.floor(Number(map[pid] || 0) || 0));
}

// 2) 把购物车里某个 pid 的数量设置为 targetQty
// normalizedItem：当需要 addItem 时用（你 createProductCard 里已经有 normalized）
function setCartQty(pid, targetQty, normalizedItem) {
  const next = Math.max(0, Math.floor(Number(targetQty || 0) || 0));

  const cartApi =
    (window.FreshCart && window.FreshCart) ||
    (window.Cart && window.Cart) ||
    null;

  if (!cartApi) {
    alert("购物车模块暂未启用（请确认 cart.js 已加载）");
    return;
  }

  // 优先走 setQty / updateQty 一类（最干净）
  try {
    if (typeof cartApi.setQty === "function") return cartApi.setQty(pid, next);
    if (typeof cartApi.updateQty === "function") return cartApi.updateQty(pid, next);
    if (typeof cartApi.changeQty === "function") return cartApi.changeQty(pid, next);
    if (typeof cartApi.setItemQty === "function") return cartApi.setItemQty(pid, next);
  } catch {}

  // 兜底：用 addItem/removeItem 做差量
  const cur = getCartQty(pid);
  const delta = next - cur;
  if (delta === 0) return;

  // 需要增加
  if (delta > 0) {
    if (typeof cartApi.addItem === "function") {
      cartApi.addItem(normalizedItem || { id: pid }, delta);
      return;
    }
  }

  // 需要减少到 0：优先 removeItem/remove
  if (next === 0) {
    if (typeof cartApi.removeItem === "function") return cartApi.removeItem(pid);
    if (typeof cartApi.remove === "function") return cartApi.remove(pid);
  }

  // 再兜底：逐个减少
  const steps = Math.abs(delta);
  for (let i = 0; i < steps; i++) {
    if (typeof cartApi.decreaseItem === "function") cartApi.decreaseItem(pid, 1);
    else if (typeof cartApi.removeOne === "function") cartApi.removeOne(pid);
  }
}

// 3) 根据购物车数量切换某张卡的显示（qty=0 显示加入购物车；qty>=1 显示黑框）
function renderCardAction(card) {
  if (!card) return;
  const pid = String(card.dataset.cartPid || "").trim();
  if (!pid) return;

  const qty = getCartQty(pid);

  const qtyRow = card.querySelector("[data-qty-row]");
  const addBtn = card.querySelector(".product-add-fixed[data-add-only]");
  const qtyDisplay = card.querySelector("[data-qty-display]");

  // 库存上限（你已有 __maxQty）
  const cap0 = Number(card.__maxQty);
  const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : 0;

  // 显示逻辑
  if (addBtn) addBtn.style.display = qty <= 0 ? "" : "none";
  if (qtyRow) qtyRow.style.display = qty > 0 ? "flex" : "none";

  // 黑框数字：显示购物车数量（最少显示 1）
  if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, qty));

  // +/- 禁用
  const minus = card.querySelector("[data-qty-minus]");
  const plus = card.querySelector("[data-qty-plus]");
  if (minus) minus.disabled = qty <= 0 || cap <= 0;
  if (plus) plus.disabled = cap <= 0 || qty >= cap;
}

// 4) 批量刷新所有卡片（购物车变化/多标签页变化/初始化时调用）
function renderAllCardsAction() {
  document.querySelectorAll(".product-card[data-cart-pid]").forEach((card) => {
    renderCardAction(card);
  });
}
/* ====== 下一段从 createProductCard() 开始 ====== */
function createProductCard(p, extraBadgeText) {
  const article = document.createElement("article");
  article.className = "product-card";

  // ✅ 展示层：同一个商品拆成单个/整箱两张卡
  const productId = String(p.__productId || p._id || p.id || "").trim();
  const variantKey = String(p.__variantKey || "single").trim() || "single";

  // ✅ 让后续“自动刷新库存/限制加购/徽章兜底”能定位到这张卡
  article.dataset.productId = productId;
  article.dataset.variantKey = variantKey;

  // ✅ unitCount：来自 expandProductsWithVariants（整箱>1；单个=1）
  const unitCount = Math.max(1, Math.floor(Number(p.__unitCount || 1) || 1));
  article.dataset.unitCount = String(unitCount);

  // ✅ cartKey：购物车里区分“单个/整箱”
  const cartKey = String(
    p.__cartKey || (productId ? `${productId}::${variantKey}` : p.sku || p.id || "")
  ).trim();

  // ✅ badge / 加购按钮都用 cartKey（这样单个和整箱数量不会混在一起）
  const pid = cartKey;
  article.dataset.cartPid = pid; // ✅ 统一模块用它定位购物车数量
  // ✅ 展示名 & 展示价格（variant.price 优先）
  const displayName = String(p.__displayName || p.name || "").trim();
  const displayPriceOverride =
    p.__displayPrice != null && Number.isFinite(Number(p.__displayPrice))
      ? Number(p.__displayPrice)
      : null;

  // ✅✅✅ 新价格逻辑：支持 specialEnabled + specialQty + specialTotalPrice
  const originUnit =
    Number(p.originPrice ?? p.originalPrice ?? p.regularPrice ?? p.price ?? 0) || 0;

  // 整箱卡如果有 override 价格，就用 override 当“单次购买价”
  const basePrice = displayPriceOverride != null ? displayPriceOverride : originUnit;

  const specialEnabled = !!p.specialEnabled;
  const specialQty = Math.max(1, Math.floor(Number(p.specialQty || 1) || 1));
  const specialTotal =
    p.specialTotalPrice != null && p.specialTotalPrice !== ""
      ? Number(p.specialTotalPrice)
      : p.specialPrice != null && p.specialPrice !== ""
      ? Number(p.specialPrice)
      : 0;

  const isSingleVariant = String(variantKey || "single") === "single";

  let priceMainText = `$${Number(basePrice || 0).toFixed(2)}`;
  let priceSubText = "";

  if (isSingleVariant && specialEnabled && specialQty > 1 && specialTotal > 0) {
    priceMainText = `${specialQty} for $${specialTotal.toFixed(2)}`;
    if (originUnit > 0) priceSubText = `单个原价 $${originUnit.toFixed(2)}`;
  } else if (
    isSingleVariant &&
    specialEnabled &&
    specialQty === 1 &&
    specialTotal > 0 &&
    originUnit > specialTotal
  ) {
    priceMainText = `$${specialTotal.toFixed(2)}`;
    priceSubText = `原价 $${originUnit.toFixed(2)}`;
  } else {
    if (!isSingleVariant && originUnit > 0) priceSubText = `单个原价 $${originUnit.toFixed(2)}`;
  }

  const badgeText = extraBadgeText || ((p.tag || "").includes("爆品") ? "爆品" : "");

  const imageUrl =
    p.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(pid || displayName || "fb")}/500/400`;

  const tagline = (p.tag || p.category || "").slice(0, 18);
  const limitQty = p.limitQty || p.limitPerUser || p.maxQty || p.purchaseLimit || 0;

  // ==========================================================
  // ✅✅✅ 唯一库存计算（全文件唯一口径）
  // stockUnits 单位=单个
  // 单个：maxQty=stockUnits
  // 整箱：maxQty=floor(stockUnits/unitCount)
  // ==========================================================
  const stockUnits = Math.max(0, Math.floor(Number(p.stock ?? p.inventory ?? 0) || 0));
  let maxQty = variantKey === "single" ? stockUnits : Math.floor(stockUnits / unitCount);

  // 叠加“每人限购”（如果有）
  if (Number(limitQty) > 0) {
    const lim = Math.max(0, Math.floor(Number(limitQty)));
    maxQty = Math.max(0, Math.min(maxQty, lim));
  }

  // ✅ 挂到 card 上（徽章兜底 & 自动刷新使用）
  article.__stockUnits = stockUnits;
  article.__maxQty = maxQty;

  // ✅ 纯显示：整箱显示“仅剩 X 箱”
  const maxText =
    unitCount > 1 ? `仅剩 ${Math.max(0, maxQty)} 箱` : `仅剩 ${Math.max(0, maxQty)}`;

  // ✅ clamp：把用户选择数量限制在 [1, maxQty]
  function clampQty(q) {
    let n = Math.floor(Number(q || 1));
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (maxQty <= 0) return 0;
    if (n > maxQty) n = maxQty;
    return n;
  }

  // ✅ 当前选择数量（没有输入框，内部变量）
  let selectedQty = 1;

  article.innerHTML = `
  <div class="product-image-wrap" data-go-detail>
    ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
    <img src="${imageUrl}" class="product-image" alt="${displayName}" />

    <div class="product-qty-badge" data-pid="${pid}"></div>

    <div class="product-overlay">
      <div class="overlay-btn-row">
        <button type="button" class="overlay-btn fav">⭐ 收藏</button>
        <button type="button" class="overlay-btn add" data-add-pid="${pid}" ${maxQty <= 0 ? "disabled" : ""}>
          ${maxQty <= 0 ? "已售罄" : `加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}`}
        </button>
      </div>
    </div>
  </div>

  <div class="product-name" data-go-detail>${displayName}</div>
  <div class="product-desc">${p.desc || ""}</div>

  <div class="product-price-row" style="display:flex;flex-direction:column;gap:2px;">
    <span class="product-price" style="font-size:18px;font-weight:900;line-height:1.1;">
      ${priceMainText}
    </span>
    ${
      priceSubText
        ? `<span class="product-origin" style="font-size:12px;opacity:.75;">${priceSubText}</span>`
        : ""
    }
  </div>

  <div class="product-tagline">${tagline}</div>

    <!-- ✅✅✅ 合并：同一位置切换显示（qty=0 显示加入购物车；qty>=1 显示黑框） -->
  <div class="product-action" data-action-pid="${pid}" style="margin-top:10px;">

    <!-- 黑框数量条（默认先隐藏，JS 会根据购物车数量决定显示谁） -->
    <div class="qty-row" data-qty-row style="display:none;align-items:center;gap:8px;">
      <button type="button" class="qty-btn" data-qty-minus style="width:34px;height:34px;border-radius:10px;">-</button>

      <div
        data-qty-display
        style="
          width:64px;
          height:34px;
          border-radius:10px;
          display:flex;
          align-items:center;
          justify-content:center;
          border:2px solid #111;
          font-weight:800;
          background:#fff;
        "
      >1</div>

      <button type="button" class="qty-btn" data-qty-plus style="width:34px;height:34px;border-radius:10px;">+</button>

      <span data-qty-hint style="font-size:12px;opacity:.7;margin-left:auto;">
        ${maxQty <= 0 ? "已售罄" : maxText}
      </span>
    </div>

    <!-- 加入购物车按钮（qty=0 显示） -->
    <button
      type="button"
      class="product-add-fixed"
      data-add-pid="${pid}"
      data-add-only
      style="width:100%;"
      ${maxQty <= 0 ? "disabled" : ""}>
      ${maxQty <= 0 ? "已售罄" : "加入购物车"}
    </button>
  </div>
`;
  // ✅ 只允许：图片区域 + 商品名 跳转详情
  function goDetail(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!productId) return;
    const url =
      "product_detail.html?id=" +
      encodeURIComponent(productId) +
      "&variant=" +
      encodeURIComponent(variantKey);
    window.location.href = url;
  }

  article.querySelectorAll("[data-go-detail]").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", goDetail);
  });
  // ✅ 数量控件绑定（无输入框）
  const qtyDisplay = article.querySelector("[data-qty-display]");
  const btnMinus = article.querySelector("[data-qty-minus]");
  const btnPlus = article.querySelector("[data-qty-plus]");
  const qtyHint = article.querySelector("[data-qty-hint]");
    // ============================
  // ✅ 合并显示逻辑：qty=0 显示“加入购物车”；qty>=1 显示黑框
  // 黑框数量 = 购物车数量（不是 selectedQty）
  // ============================
  const actionWrap = article.querySelector(".product-action[data-action-pid]");
  const qtyRow = article.querySelector("[data-qty-row]");
  const addOnlyBtn = article.querySelector(".product-add-fixed[data-add-only]");

  function getCartQtyForThisPid() {
    const snap = getCartSnapshot();
    const map = normalizeCartToQtyMap(snap);
    return Math.max(0, Math.floor(Number(map[pid] || 0) || 0));
  }

  function setCartQtyForThisPid(targetQty) {
    const cartApi =
      (window.FreshCart && window.FreshCart) ||
      (window.Cart && window.Cart) ||
      null;

    const next = Math.max(0, Math.floor(Number(targetQty || 0) || 0));

    if (!cartApi) return;

    // 常见能力：setQty / updateQty / changeQty / removeItem / addItem
    try {
      if (typeof cartApi.setQty === "function") return cartApi.setQty(pid, next);
      if (typeof cartApi.updateQty === "function") return cartApi.updateQty(pid, next);
      if (typeof cartApi.changeQty === "function") return cartApi.changeQty(pid, next);
      if (typeof cartApi.setItemQty === "function") return cartApi.setItemQty(pid, next);
    } catch {}

    // 兜底：只能用 addItem / removeItem 时
    const cur = getCartQtyForThisPid();
    const delta = next - cur;

    if (delta === 0) return;

    // 加
    if (delta > 0) {
      const normalized = {
        id: pid, // cartKey（productId::variantKey）
        productId: productId,
        variantKey: variantKey,
        name: displayName || "商品",
        price: (isSingleVariant && originUnit > 0) ? originUnit : basePrice,
        priceNum: (isSingleVariant && originUnit > 0) ? originUnit : basePrice,
        image: p.image || imageUrl,
        tag: p.tag || "",
        type: p.type || "",
        isSpecial: isHotProduct(p),
        isDeal: isHotProduct(p),
      };
      article.__normalizedItem = normalized; // ✅ 统一模块 setCartQty 的 addItem 兜底用
      if (typeof cartApi.addItem === "function") cartApi.addItem(normalized, delta);
      return;
    }

    // 减（优先 removeItem / removeOne / decrease）
    if (next === 0) {
      if (typeof cartApi.removeItem === "function") return cartApi.removeItem(pid);
      if (typeof cartApi.remove === "function") return cartApi.remove(pid);
    }

    // 如果没有明确减的方法，就尝试“逐个减”
    const steps = Math.abs(delta);
    for (let i = 0; i < steps; i++) {
      if (typeof cartApi.decreaseItem === "function") cartApi.decreaseItem(pid, 1);
      else if (typeof cartApi.removeOne === "function") cartApi.removeOne(pid);
      else if (typeof cartApi.addItem === "function") {
        // 有些实现允许 addItem 传负数（不保证）
        try { cartApi.addItem({ id: pid }, -1); } catch {}
      }
    }
  }

  function renderActionByCartQty() {
    const cartQty = getCartQtyForThisPid();

    // 库存上限
    const cap0 = Number(article.__maxQty);
    const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : 0;

    // clamp cartQty 到库存上限（只影响显示与按钮可用性）
    const showQty = cap > 0 ? Math.min(cartQty, cap) : cartQty;

    // qty=0：显示加入购物车；qty>=1：显示黑框
    if (addOnlyBtn) addOnlyBtn.style.display = cartQty <= 0 ? "" : "none";
    if (qtyRow) qtyRow.style.display = cartQty > 0 ? "flex" : "none";

    if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, showQty || 1));

    // +/- 状态
    if (btnMinus) btnMinus.disabled = cartQty <= 0 || cap <= 0;
    if (btnPlus) btnPlus.disabled = cap <= 0 || cartQty >= cap;

    // hint
    const newMaxText = unitCount > 1 ? `仅剩 ${Math.max(0, cap)} 箱` : `仅剩 ${Math.max(0, cap)}`;
    if (qtyHint) qtyHint.textContent = cap <= 0 ? "已售罄" : newMaxText;
  }
  function syncQtyUI() {
    selectedQty = clampQty(selectedQty);

    if (qtyDisplay) qtyDisplay.textContent = String(selectedQty);

    if (btnMinus) btnMinus.disabled = selectedQty <= 1 || maxQty <= 0;
    if (btnPlus) btnPlus.disabled = maxQty <= 0 || selectedQty >= maxQty;

    const newMaxText =
      unitCount > 1 ? `仅剩 ${Math.max(0, maxQty)} 箱` : `仅剩 ${Math.max(0, maxQty)}`;
    if (qtyHint) qtyHint.textContent = maxQty <= 0 ? "已售罄" : newMaxText;

    // ✅ 同步按钮禁用状态（库存变化时也能更新）
    const overlayAdd = article.querySelector('.overlay-btn.add[data-add-pid]');
    const fixedAdd = article.querySelector('.product-add-fixed[data-add-pid]');
    if (overlayAdd) overlayAdd.disabled = maxQty <= 0;
    if (fixedAdd) fixedAdd.disabled = maxQty <= 0;
  }
  // 初始同步一次（处理 max=0 / clamp）
  syncQtyUI();

  function doAdd(ev) {
    ev.stopPropagation();

    const cartApi =
      (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
      (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
      null;

    if (!cartApi) {
      alert("购物车模块暂未启用（请确认 cart.js 已加载）");
      return;
    }

    // ✅ 无输入框：直接用 selectedQty
    const wantQty = 1; // ✅ 点击“加入购物车”只加 1
    if (wantQty <= 0) {
      alert("该商品已售罄");
      return;
    }

    // ✅ 加购单价：默认 basePrice；单个规格优先用单个原价（你的旧逻辑保持）
    let cartUnitPrice = basePrice;
    if (isSingleVariant && originUnit > 0) cartUnitPrice = originUnit;

    const normalized = {
      id: pid, // cartKey（productId::variantKey）
      productId: productId,
      variantKey: variantKey,
      name: displayName || "商品",
      price: cartUnitPrice,
      priceNum: cartUnitPrice,
      image: p.image || imageUrl,
      tag: p.tag || "",
      type: p.type || "",
      isSpecial: isHotProduct(p),
      isDeal: isHotProduct(p),
    };

    cartApi.addItem(normalized, wantQty);

    // ✅✅✅ 加购后立刻显示徽章：但永不超过 card.__maxQty（强兜底）
    try {
      const badge = article.querySelector(`.product-qty-badge[data-pid="${pid}"]`);
      const cur = Number((badge?.textContent || "").replace("+", "")) || 0;
      const cap0 = Number(article.__maxQty);
      const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : 999999;
      const next = Math.min(cur + wantQty, cap);
      if (badge) {
        badge.textContent = next >= 99 ? "99+" : String(next);
        badge.style.display = next > 0 ? "flex" : "none";
      }
    } catch {}

    // ✅ 通知全站：购物车已更新（delta=wantQty）
    try {
      window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: wantQty } }));
    } catch {}

    setTimeout(() => {
      try {
        scheduleBadgeSync();
      } catch {}
    }, 150);
     renderActionByCartQty();
  }

  const favBtn = article.querySelector(".overlay-btn.fav");
  if (favBtn) {
    favBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      alert("收藏功能后续接入，这里先做占位提示。");
    });
  }

  // ✅ 提供一个公开的“库存刷新入口”，给 refreshStockAndCards 调用
  // 这样库存变化时：maxQty、提示文案、按钮、+/- 都能立刻更新
  article.__refreshStockUI = function refreshStockUI(newStockUnits) {
    const su = Math.max(0, Math.floor(Number(newStockUnits || 0) || 0));
    article.__stockUnits = su;

    // ✅ 重新计算 maxQty（仍然是唯一口径）
    let newMax = variantKey === "single" ? su : Math.floor(su / unitCount);
    if (Number(limitQty) > 0) {
      const lim = Math.max(0, Math.floor(Number(limitQty)));
      newMax = Math.max(0, Math.min(newMax, lim));
    }

    maxQty = newMax;
    article.__maxQty = newMax;

    // 选中数量可能超了，要 clamp
    selectedQty = clampQty(selectedQty);
    syncQtyUI();

    // 强制同步徽章（兜底：如果购物车里原数量>新库存，会被 setProductBadge 压回去）
    try {
      scheduleBadgeSync();
    } catch {}
  };
  // 初次渲染：根据购物车数量决定显示“加入购物车”还是“黑框”
  renderActionByCartQty();

  // 购物车更新/多标签页变化：刷新该卡片显示
  window.addEventListener("freshbuy:cartUpdated", renderActionByCartQty);
  window.addEventListener("storage", (e) => {
    if (e?.key && String(e.key).toLowerCase().includes("cart")) renderActionByCartQty();
  });
  // ✅ 阻止点击“底部操作区”时跳转到详情页
  const actionArea = article.querySelector(".product-action");
  if (actionArea) {
    actionArea.addEventListener("click", (e) => {
      e.stopPropagation(); // ⭐ 关键：阻止冒泡到 article
    });
  }
  return article;
}

/* ====== 下一段从：库存刷新 refreshStockAndCards + loadHomeProductsFromSimple 开始 ====== */
// IP 建议 ZIP（不强制）—— ✅ 如果 ZIP 已被“默认地址锁定”，则不要再用 IP 覆盖
async function tryPrefillZipFromIP() {
  const confirmed = localStorage.getItem("freshbuy_zone_ok") === "1";
  if (confirmed) return;

  const input = document.getElementById("zipInput");
  if (!input) return;

  if (input.dataset.lockedByDefaultAddress === "1") return;
  if ((input.value || "").trim()) return;

  try {
    const res = await fetch("/api/public/geo/ip-zip", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (data?.success && data.zip) {
      input.value = data.zip;
      const tip = document.getElementById("zipResult");
      if (tip) tip.textContent = `建议 ZIP：${data.zip}（请点“查看配送”确认）`;
    }
  } catch {}
}

document.addEventListener("DOMContentLoaded", () => {
  tryPrefillZipFromIP();
});

// =========================
// 首页加载商品（/api/products-simple）
// =========================
async function loadHomeProductsFromSimple() {
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

    console.log("首页从 /api/products-simple 拿到商品：", list);
    console.log("DEBUG first item fields:", list?.[0]);

    if (!list.length) {
      ["productGridHot", "productGridDaily", "productGridNew", "productGridBest", "productGridNormal"].forEach((id) => {
        const grid = document.getElementById(id);
        if (grid) grid.innerHTML = '<div style="padding:12px;font-size:13px;color:#6b7280;">暂时没有商品</div>';
      });
      return;
    }

    // ✅ 保存原始产品（不展开）
    window.allProductsRaw = list;

    // ✅ 用展开后的列表用于渲染（会出现单个/整箱两张卡）
    const viewList = expandProductsWithVariants(list);
    window.allProducts = viewList;

    // ✅ 后面所有筛选都用 viewList
    const hotList = viewList.filter((p) => isHotProduct(p));
    const nonHotList = viewList.filter((p) => !isHotProduct(p));

    let familyList = nonHotList.filter((p) => isFamilyProduct(p));
    let newList = nonHotList.filter((p) => isNewProduct(p));
    if (newList.length > 30) newList = newList.slice(0, 30);

    let bestList = nonHotList.filter((p) => isBestSellerProduct(p));
    if (bestList.length > 30) bestList = bestList.slice(0, 30);

    const allList = nonHotList;

    // ✅ 家庭必备：严格筛选，不要用 allList 兜底，否则会塞正常价商品
    if (!familyList.length) familyList = [];
    if (!newList.length) newList = allList.slice(0, 12);
    if (!bestList.length) bestList = allList.slice(0, 12);

    function renderIntoGrid(gridId, items, typeLabel) {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      grid.innerHTML = "";

      if (!items.length) {
        grid.innerHTML = '<div style="padding:12px;font-size:13px;color:#6b7280;">暂时没有商品</div>';
        return;
      }

      items.forEach((p, idx) => {
        let badgeText = "";
        if (typeLabel === "hot") badgeText = isHotProduct(p) ? "爆品日" : "爆品";
        else if (typeLabel === "family") badgeText = "家庭必备";
        else if (typeLabel === "best") badgeText = idx < 3 ? "TOP" + (idx + 1) : "畅销";
        else if (typeLabel === "new") badgeText = "NEW";
        grid.appendChild(createProductCard(p, badgeText));
      });
    }

    // ✅ 每个区块显示数量（电脑 8；手机按你配置）
    const hotLimit = getLimit("Hot");
    const dailyLimit = getLimit("DailySpecial");
    const newLimit = getLimit("New");
    const bestLimit = getLimit("Best");
    const allLimit = getLimit("Normal");

    const hotShow = hotList.slice(0, hotLimit);
    const familyShow = familyList.slice(0, dailyLimit);
    const newShow = newList.slice(0, newLimit);
    const bestShow = bestList.slice(0, bestLimit);
    const allShow = allList.slice(0, allLimit);

    renderIntoGrid("productGridHot", hotShow, "hot");
    renderIntoGrid("productGridDaily", familyShow, "family");
    renderIntoGrid("productGridNew", newShow, "new");
    renderIntoGrid("productGridBest", bestShow, "best");
    renderIntoGrid("productGridNormal", allShow, "all");

    // ✅✅✅ 商品渲染完后同步一次徽章（如果购物车里已有数量）
    try {
      setTimeout(() => scheduleBadgeSync(), 0);
      setTimeout(() => renderAllCardsAction(), 0);
    } catch {}
  } catch (err) {
    console.error("首页加载 /api/products-simple 失败：", err);
  }
}

// =====================================================
// ✅ 自动刷新库存：每隔一段时间拉 /api/products-simple
// 只更新：每张商品卡的 stock/maxQty + UI（仅剩X箱/禁用/+-）+ 徽章兜底
// =====================================================
const STOCK_REFRESH_MS = 15000; // 15秒，你可改 10s/20s

async function refreshStockAndCards() {
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

    if (!list.length) return;

    // productId -> 最新库存（单位=单个）
    const stockMap = {};
    list.forEach((p) => {
      const id = String(p?._id || p?.id || "").trim();
      if (!id) return;
      stockMap[id] = Math.max(0, Math.floor(Number(p.stock ?? p.inventory ?? 0) || 0));
    });

    // 遍历页面已有卡片，更新库存并触发卡片 UI 重算
    document.querySelectorAll(".product-card[data-product-id]").forEach((card) => {
      const pid = String(card.dataset.productId || "").trim();
      if (!pid) return;

      const stockUnits = stockMap[pid];
      if (!Number.isFinite(stockUnits)) return;

      // ✅ 调用 createProductCard 里挂的刷新函数（包含 maxQty 重新计算、仅剩X箱、按钮/+-禁用）
      if (typeof card.__refreshStockUI === "function") {
        card.__refreshStockUI(stockUnits);
      } else {
        // 极端兜底：至少写回 __stockUnits/__maxQty（不建议走到这里）
        const vKey = String(card.dataset.variantKey || "single").trim() || "single";
        const unitCount = Math.max(1, Math.floor(Number(card.dataset.unitCount || 1) || 1));
        const maxQty = vKey === "single" ? stockUnits : Math.floor(stockUnits / unitCount);
        card.__stockUnits = stockUnits;
        card.__maxQty = maxQty;
      }
    });

    // ✅ 强制同步徽章（兜底：徽章= min(购物车数量, card.__maxQty)）
    try {
      scheduleBadgeSync();
    } catch {}
  } catch (e) {
    console.warn("refreshStockAndCards failed:", e);
  }
}

// 页面加载后开启轮询
window.addEventListener("DOMContentLoaded", () => {
  setInterval(refreshStockAndCards, STOCK_REFRESH_MS);
});

/* ====== 下一段从：登录/注册/鉴权（AUTH_TOKEN_KEYS...）开始 ====== */
// =========================
// 3) 登录 / 注册弹窗 + 顶部头像（✅ Mongo 真实接口版）
// =========================

// ✅ 统一 token 读取/写入（兼容 auth_client.js 的 "token" + 你这份 index.js 的 "freshbuy_token"）
const AUTH_TOKEN_KEYS = ["token", "freshbuy_token", "jwt", "auth_token", "access_token"];

function getToken() {
  for (const k of AUTH_TOKEN_KEYS) {
    const v = localStorage.getItem(k);
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function setToken(token) {
  const t = String(token || "").trim();
  if (!t) return;
  // ✅ 统一写到 "token"（让 auth_client.js 和全站一致）
  localStorage.setItem("token", t);
  // ✅ 顺便把旧 key 也同步（避免历史代码只读 freshbuy_token）
  localStorage.setItem("freshbuy_token", t);
}

function clearToken() {
  // ✅ 退出时必须把所有 token key 都清掉
  for (const k of AUTH_TOKEN_KEYS) localStorage.removeItem(k);

  // ✅ 同时清理你项目里会导致“游客也显示登录信息”的缓存
  localStorage.removeItem("freshbuy_is_logged_in");
  localStorage.removeItem("freshbuy_login_phone");
  localStorage.removeItem("freshbuy_login_nickname");
  localStorage.removeItem("freshbuy_default_address");
  localStorage.removeItem("freshbuy_wallet_balance");
}

async function apiFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;

  const res = await fetch(url, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  // 401 或后端明确提示未登录 → 清 token
  if (res.status === 401 || (data && data.success === false && (data.msg === "未登录" || data.message === "未登录"))) {
    clearToken();
  }

  return { res, data };
}

async function apiLogin(phone, password) {
  const { res, data } = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });

  const ok = data?.success === true || data?.ok === true || typeof data?.token === "string";
  if (!res.ok || !ok) throw new Error(data?.msg || data?.message || "登录失败");
  if (data?.token) setToken(data.token);

  return data.user || null;
}

// ✅ 发送短信验证码（Twilio Verify）
async function apiSendSmsCode(phone) {
  const { res, data } = await apiFetch("/api/sms/send-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!res.ok || !data?.success) throw new Error(data?.message || "发送验证码失败");
  return data;
}

// ✅ 注册：验证码校验 + 创建账号 + 返回 token（后端接口）
async function apiVerifyRegister({ phone, code, password, name }) {
  const { res, data } = await apiFetch("/api/auth/verify-register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code, password, name, autoLogin: true }),
  });

  const ok = data?.success === true && typeof data?.token === "string";
  if (!res.ok || !ok) throw new Error(data?.message || "注册失败");

  setToken(data.token);
  return data.user || null;
}

// 轻量 me（只有 id/role/phone）
async function apiMe() {
  const token = getToken();
  if (!token) return null;
  const { res, data } = await apiFetch("/api/auth/me");
  if (!res.ok || !data?.success) return null;
  return data.user || null;
}

// ✅✅✅ 正确来源：从 Address 集合拿默认地址（唯一正确来源）
async function apiGetDefaultAddress() {
  const token = getToken();
  if (!token) return null;

  try {
    const { res, data } = await apiFetch("/api/addresses/my", { cache: "no-store" });
    console.log("[apiGetDefaultAddress]", res.status, data);

    if (!res.ok || !data?.success) return null;
    return data.defaultAddress || null;
  } catch (e) {
    console.error("apiGetDefaultAddress error", e);
    return null;
  }
}

// =========================
// DOM refs（登录/注册弹窗）
// =========================
const authBackdrop = document.getElementById("authBackdrop");
const authCloseBtn = document.getElementById("authCloseBtn");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const authTitle = document.getElementById("authTitle");

const loginPanel = document.getElementById("loginPanel");
const registerPanel = document.getElementById("registerPanel");

// ✅ 新增：找回密码面板（你 index.html 里要有）
const forgotPanel = document.getElementById("forgotPanel");

const loginPhone = document.getElementById("loginPhone");
const loginPassword = document.getElementById("loginPassword");
const loginRemember = document.getElementById("loginRemember");

const regPhone = document.getElementById("regPhone");
const regPassword = document.getElementById("regPassword");
const regCode = document.getElementById("regCode");
const regSendCodeBtn = document.getElementById("regSendCodeBtn");

const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");

const userProfile = document.getElementById("userProfile");
const userNameLabel = document.getElementById("userNameLabel");
const userAvatar = document.getElementById("userAvatar");

function applyLoggedInUI(phone) {
  if (!phone) return;
  if (loginBtn) loginBtn.style.display = "none";
  if (registerBtn) registerBtn.style.display = "none";
  if (userProfile) userProfile.style.display = "flex";

  const tail = String(phone).slice(-4);
  if (userNameLabel) userNameLabel.textContent = tail ? "尾号 " + tail : "我的账户";
  if (userAvatar) userAvatar.textContent = "我";
}

function applyLoggedOutUI() {
  if (loginBtn) loginBtn.style.display = "";
  if (registerBtn) registerBtn.style.display = "";
  if (userProfile) userProfile.style.display = "none";
}

// ================================
// ✅ 强制退出：不管你之前用哪个 key，都能退出
// ================================
function hardLogout() {
  // 1) 清 token（两套系统都清）
  const tokenKeys = ["token", "freshbuy_token", "jwt", "auth_token", "access_token"];
  tokenKeys.forEach((k) => localStorage.removeItem(k));

  // 2) 清登录态/用户缓存
  const miscKeys = [
    "freshbuy_is_logged_in",
    "freshbuy_login_phone",
    "freshbuy_login_nickname",
    "freshbuy_default_address",
    "freshbuy_wallet_balance",
    "user",
    "freshbuy_user",
  ];
  miscKeys.forEach((k) => localStorage.removeItem(k));

  try {
    sessionStorage.clear();
  } catch {}

  // 3) 立刻切 UI
  applyLoggedOutUI();
  unlockZipInputForGuest();

  // 4) 提示 + 回首页（防止其它初始化又把 UI 改回去）
  alert("已退出登录");
  location.href = "/user/index.html";
}

// ✅ 事件委托：只要你点的元素里出现这些文字/属性，就当成退出
document.addEventListener("click", (e) => {
  const el = e.target.closest("button,a,div,span");
  if (!el) return;

  const text = (el.textContent || "").trim();
  const id = (el.id || "").toLowerCase();
  const cls = (el.className || "").toString().toLowerCase();

  const hit =
    text === "退出" ||
    text === "退出登录" ||
    text === "登出" ||
    id.includes("logout") ||
    id.includes("signout") ||
    cls.includes("logout") ||
    cls.includes("signout") ||
    el.getAttribute("data-action") === "logout";

  if (hit) {
    e.preventDefault();
    e.stopPropagation();
    hardLogout();
  }
});

async function initAuthUIFromStorage() {
  const me = await apiMe();
  if (me && me.phone) applyLoggedInUI(me.phone);
  else applyLoggedOutUI();
  return me || null;
}

/* ====== 下一段从：openAuthModal / switchAuthMode / 登录注册按钮绑定 / 忘记密码开始 ====== */
function openAuthModal(mode = "login") {
  if (!authBackdrop) return;
  authBackdrop.classList.add("active");
  document.body.classList.add("modal-open");
  switchAuthMode(mode);

  const savedPhone = localStorage.getItem("freshbuy_login_phone") || "";
  if (savedPhone && loginPhone && loginRemember) {
    loginPhone.value = savedPhone;
    loginRemember.checked = true;
  }
}

function closeAuthModal() {
  if (!authBackdrop) return;
  authBackdrop.classList.remove("active");
  document.body.classList.remove("modal-open");
}

function setAuthTitle(t) {
  if (authTitle) authTitle.textContent = t || "登录";
}

// ✅✅✅ 关键：支持 forgot 模式
function switchAuthMode(mode) {
  if (!tabLogin || !tabRegister || !loginPanel || !registerPanel || !authTitle) return;

  // 全部先隐藏
  loginPanel.style.display = "none";
  registerPanel.style.display = "none";
  if (forgotPanel) forgotPanel.style.display = "none";

  // tabs
  tabLogin.classList.remove("active");
  tabRegister.classList.remove("active");

  if (mode === "register") {
    tabRegister.classList.add("active");
    registerPanel.style.display = "";
    setAuthTitle("注册");
    return;
  }

  if (mode === "forgot") {
    setAuthTitle("找回密码");
    if (forgotPanel) forgotPanel.style.display = "";
    return;
  }

  // 默认 login
  tabLogin.classList.add("active");
  loginPanel.style.display = "";
  setAuthTitle("登录");
}

if (loginBtn) loginBtn.addEventListener("click", () => openAuthModal("login"));
if (registerBtn) registerBtn.addEventListener("click", () => openAuthModal("register"));
if (authCloseBtn) authCloseBtn.addEventListener("click", closeAuthModal);

if (authBackdrop) {
  authBackdrop.addEventListener("click", (e) => {
    if (e.target === authBackdrop) closeAuthModal();
  });
}
if (tabLogin) tabLogin.addEventListener("click", () => switchAuthMode("login"));
if (tabRegister) tabRegister.addEventListener("click", () => switchAuthMode("register"));

// ====== 注册发送验证码 ======
if (regSendCodeBtn) {
  regSendCodeBtn.addEventListener("click", async () => {
    const phone = (regPhone && regPhone.value.trim()) || "";
    if (!phone) return alert("请先输入手机号");

    try {
      await apiSendSmsCode(phone);
      alert("验证码已发送");
    } catch (e) {
      alert(e.message || "发送失败");
    }
  });
}

// ====== 登录提交 ======
if (loginSubmitBtn) {
  loginSubmitBtn.addEventListener("click", async () => {
    const phone = (loginPhone && loginPhone.value.trim()) || "";
    const pwd = (loginPassword && loginPassword.value) || "";
    if (!phone || !pwd) return alert("请填写手机号和密码");

    try {
      await apiLogin(phone, pwd);

      if (loginRemember && loginRemember.checked) {
        localStorage.setItem("freshbuy_login_phone", phone);
      } else {
        localStorage.removeItem("freshbuy_login_phone");
      }

      applyLoggedInUI(phone);
      await applyZipFromDefaultAddressIfLoggedIn();

      alert("登录成功");
      closeAuthModal();
    } catch (err) {
      alert(err.message || "登录失败");
    }
  });
}

function isStrongPassword(pwd) {
  // 至少8位，且必须包含字母+数字
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(pwd || ""));
}

// ====== 注册提交 ======
if (registerSubmitBtn) {
  registerSubmitBtn.addEventListener("click", async () => {
    const phone = (regPhone && regPhone.value.trim()) || "";
    const pwd = (regPassword && regPassword.value) || "";
    const code = (regCode && regCode.value.trim()) || "";

    if (!phone) return alert("请填写手机号");
    if (!code) return alert("请填写验证码");
    if (!pwd) return alert("请填写密码");
    if (!isStrongPassword(pwd)) return alert("密码至少8位，且必须包含字母和数字");

    const name = "用户" + String(phone).slice(-4);

    try {
      await apiVerifyRegister({ phone, code, password: pwd, name });

      localStorage.setItem("freshbuy_login_phone", phone);
      applyLoggedInUI(phone);

      await applyZipFromDefaultAddressIfLoggedIn();

      alert("注册成功，已自动登录");
      closeAuthModal();
    } catch (err) {
      alert(err.message || "注册失败");
    }
  });
}

// =========================
// ✅ 忘记密码：弹窗内切换面板（不跳新页）
// 依赖：已有 apiSendSmsCode() + 新接口 POST /api/auth/reset-password
// =========================
const forgotPwdLink = document.getElementById("forgotPwdLink");
const fpPhone = document.getElementById("fpPhone");
const fpCode = document.getElementById("fpCode");
const fpNewPwd = document.getElementById("fpNewPwd");
const fpNewPwd2 = document.getElementById("fpNewPwd2");
const fpSendCodeBtn = document.getElementById("fpSendCodeBtn");
const fpResetBtn = document.getElementById("fpResetBtn");
const fpMsg = document.getElementById("fpMsg");
const backToLoginBtn = document.getElementById("backToLoginBtn");

function setFpMsg(text, ok = false) {
  if (!fpMsg) return;
  fpMsg.textContent = text || "";
  fpMsg.style.color = ok ? "#16a34a" : "#ef4444";
}

function isValidPhoneLoose(phone) {
  const s = String(phone || "").trim();
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 8;
}
function isValidCodeLoose(code) {
  return /^\d{4,8}$/.test(String(code || "").trim());
}

let fpCooldownTimer = null;
let fpCooldownLeft = 0;

function startFpCooldown(sec = 60) {
  if (!fpSendCodeBtn) return;
  fpCooldownLeft = sec;
  fpSendCodeBtn.disabled = true;
  fpSendCodeBtn.textContent = `已发送(${fpCooldownLeft}s)`;

  if (fpCooldownTimer) clearInterval(fpCooldownTimer);
  fpCooldownTimer = setInterval(() => {
    fpCooldownLeft -= 1;
    if (fpCooldownLeft <= 0) {
      clearInterval(fpCooldownTimer);
      fpCooldownTimer = null;
      fpSendCodeBtn.disabled = false;
      fpSendCodeBtn.textContent = "发送验证码";
      return;
    }
    fpSendCodeBtn.textContent = `已发送(${fpCooldownLeft}s)`;
  }, 1000);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || data?.msg || `请求失败(${res.status})`);
  }
  return data;
}

// 1) 点击“忘记密码？” -> 切面板
if (forgotPwdLink) {
  forgotPwdLink.addEventListener("click", () => {
    setFpMsg("");
    // 默认带上登录框手机号（有的话）
    try {
      const p = (loginPhone && loginPhone.value.trim()) || "";
      if (fpPhone && p && !fpPhone.value.trim()) fpPhone.value = p;
    } catch {}
    switchAuthMode("forgot");
  });
}

// 2) 返回登录
if (backToLoginBtn) {
  backToLoginBtn.addEventListener("click", () => {
    setFpMsg("");
    switchAuthMode("login");
  });
}

// 3) 发送验证码（复用 /api/sms/send-code）
if (fpSendCodeBtn) {
  fpSendCodeBtn.addEventListener("click", async () => {
    const phone = (fpPhone?.value || "").trim();
    if (!isValidPhoneLoose(phone)) return setFpMsg("请输入正确手机号（建议带 +1）", false);

    setFpMsg("");
    fpSendCodeBtn.disabled = true;

    try {
      await apiSendSmsCode(phone);
      setFpMsg("✅ 验证码已发送，请查收短信", true);
      startFpCooldown(60);
    } catch (e) {
      fpSendCodeBtn.disabled = false;
      setFpMsg("发送失败：" + (e.message || ""), false);
    }
  });
}

// 4) 重置密码（调用后端 /api/auth/reset-password）
if (fpResetBtn) {
  fpResetBtn.addEventListener("click", async () => {
    const phone = (fpPhone?.value || "").trim();
    const code = (fpCode?.value || "").trim();
    const newPassword = (fpNewPwd?.value || "").trim();
    const newPassword2 = (fpNewPwd2?.value || "").trim();

    if (!isValidPhoneLoose(phone)) return setFpMsg("请输入正确手机号（建议带 +1）", false);
    if (!isValidCodeLoose(code)) return setFpMsg("请输入短信验证码（4-8 位数字）", false);
    if (!newPassword || newPassword.length < 6) return setFpMsg("新密码至少 6 位", false);
    if (newPassword !== newPassword2) return setFpMsg("两次输入的新密码不一致", false);

    setFpMsg("");
    fpResetBtn.disabled = true;
    fpResetBtn.textContent = "提交中...";

    try {
      await postJson("/api/auth/reset-password", { phone, code, newPassword });
      setFpMsg("✅ 密码已重置成功！请用新密码登录。", true);

      // 切回登录并自动填手机号
      setTimeout(() => {
        try {
          if (loginPhone) loginPhone.value = phone;
          if (loginPassword) loginPassword.value = "";
        } catch {}
        switchAuthMode("login");
      }, 600);
    } catch (e) {
      setFpMsg("重置失败：" + (e.message || ""), false);
    } finally {
      fpResetBtn.disabled = false;
      fpResetBtn.textContent = "验证并重置密码";
    }
  });
}

// 输入优化：验证码只保留数字
if (fpCode) {
  fpCode.addEventListener("input", () => {
    fpCode.value = String(fpCode.value || "").replace(/[^\d]/g, "").slice(0, 8);
  });
}

/* ====== 下一段从：ZIP 锁定/解锁（hardLockInput/lockZipInputToDefaultAddress/unlockZipInputForGuest/...）开始 ====== */
// ===============================
// ✅ ZIP 锁定/解锁（左右同步）仅锁 ZIP 输入框，不影响其它按钮
// ===============================
function hardLockInput(el, zip) {
  if (!el) return;
  el.value = String(zip || "");
  el.readOnly = true;
  el.disabled = true;
  el.setAttribute("readonly", "readonly");
  el.setAttribute("disabled", "disabled");
  el.style.pointerEvents = "none";
  el.style.caretColor = "transparent";
}

function lockZipInputToDefaultAddress(zip) {
  const z = String(zip || "").trim();

  const zipInput = document.getElementById("zipInput");
  const zipApplyBtn = document.getElementById("zipApplyBtn");

  if (zipInput) {
    zipInput.dataset.lockedByDefaultAddress = "1";
    zipInput.dataset.lockedZip = z;
    hardLockInput(zipInput, z);
    zipInput.title = "已登录：ZIP 来自默认地址（如需更改请到个人中心修改默认地址）";
  }

  if (zipApplyBtn) {
    zipApplyBtn.disabled = true;
    zipApplyBtn.textContent = "已锁定（默认地址）";
    zipApplyBtn.title = "登录用户 ZIP 自动来自默认地址，如需修改请去个人中心";
  }

  const zipStatus = document.getElementById("zipStatus");
  if (zipStatus && z) {
    zipStatus.className = "zip-status ok";
    zipStatus.textContent = `可配送 ZIP：${z}（默认地址）`;
  }

  const rightInput = document.getElementById("zipInputRight");
  const rightCheckBtn = document.getElementById("zipCheckBtn");
  const rightClearBtn = document.getElementById("zipClearBtn");
  const rightTip = document.getElementById("zipResult");

  if (rightInput) {
    rightInput.dataset.lockedByDefaultAddress = "1";
    rightInput.dataset.lockedZip = z;
    hardLockInput(rightInput, z);
    rightInput.title = "已使用默认地址 ZIP（如需更改请到个人中心修改默认地址）";
  }
  if (rightCheckBtn) rightCheckBtn.disabled = true;
  if (rightClearBtn) rightClearBtn.disabled = true;
  if (rightTip) {
    rightTip.textContent = `已自动使用默认地址 ZIP：${z}（如需更换请到：我的账户 → 地址管理）`;
  }
}

function unlockZipInputForGuest() {
  const zipInput = document.getElementById("zipInput");
  const zipApplyBtn = document.getElementById("zipApplyBtn");

  if (zipInput) {
    delete zipInput.dataset.lockedByDefaultAddress;
    delete zipInput.dataset.lockedZip;

    zipInput.readOnly = false;
    zipInput.disabled = false;
    zipInput.removeAttribute("readonly");
    zipInput.removeAttribute("disabled");
    zipInput.style.pointerEvents = "";
    zipInput.style.caretColor = "";
    zipInput.title = "";
  }

  if (zipApplyBtn) {
    zipApplyBtn.disabled = false;
    zipApplyBtn.textContent = "查看配送";
    zipApplyBtn.title = "";
  }

  const rightInput = document.getElementById("zipInputRight");
  const rightCheckBtn = document.getElementById("zipCheckBtn");
  const rightClearBtn = document.getElementById("zipClearBtn");
  const rightTip = document.getElementById("zipResult");

  if (rightInput) {
    delete rightInput.dataset.lockedByDefaultAddress;
    delete rightInput.dataset.lockedZip;

    rightInput.readOnly = false;
    rightInput.disabled = false;
    rightInput.removeAttribute("readonly");
    rightInput.removeAttribute("disabled");
    rightInput.style.pointerEvents = "";
    rightInput.style.caretColor = "";
    rightInput.title = "";
  }

  if (rightCheckBtn) rightCheckBtn.disabled = false;
  if (rightClearBtn) rightClearBtn.disabled = false;
  if (rightTip) rightTip.textContent = "";
}

async function applyZipFromDefaultAddressIfLoggedIn() {
  const zipInput = document.getElementById("zipInput");
  if (!zipInput) return;

  const token = getToken();
  if (!token) {
    unlockZipInputForGuest();
    return;
  }

  const defAddr = await apiGetDefaultAddress();
  const zip = String(defAddr?.zip || "").trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) {
    unlockZipInputForGuest();
    return;
  }

  lockZipInputToDefaultAddress(zip);
  await applyZip(zip, { silent: true, force: true });
}

// ===============================
// ZIP -> Zone.zipWhitelist (DB)
// ===============================
const FRESHBUY_ZIP_KEY = "freshbuy_zip";
const FRESHBUY_ZONE_KEY = "freshbuy_zone";

function $(id) {
  return document.getElementById(id);
}
function isValidZip(zip) {
  return /^\d{5}$/.test(String(zip || "").trim());
}
function getSavedZip() {
  return localStorage.getItem(FRESHBUY_ZIP_KEY) || "";
}
function saveZip(zip) {
  localStorage.setItem(FRESHBUY_ZIP_KEY, zip);
}
function saveZone(zoneObj) {
  localStorage.setItem(FRESHBUY_ZONE_KEY, JSON.stringify(zoneObj || {}));
}

function toUiModeKey(cartMode) {
  if (cartMode === "groupDay") return "area-group";
  if (cartMode === "normal") return "next-day";
  if (cartMode === "friendGroup") return "friend-group";
  return "area-group";
}

function getSavedZoneBrief() {
  try {
    return JSON.parse(localStorage.getItem("freshbuy_zone") || "{}");
  } catch {
    return {};
  }
}

// ✅ 不再覆盖 #deliveryInfo，而是渲染到 #deliveryInfoBody，并且不强制切模式
function applyZoneToUI(zip, payload) {
  const zipStatus = $("zipStatus");
  const deliveryHintEl = $("deliveryHint");
  const deliveryInfoBodyEl = $("deliveryInfoBody");

  if (!deliveryHintEl || !deliveryInfoBodyEl) return;

  const deliverable = payload?.deliverable === true;
  const zone = payload?.zone || null;
  const reason = payload?.reason || payload?.message || "该邮编暂不支持配送";

  if (zipStatus) {
    const locked = document.getElementById("zipInput")?.dataset?.lockedByDefaultAddress === "1";
    zipStatus.className = deliverable ? "zip-status ok" : "zip-status bad";
    zipStatus.textContent = zip
      ? deliverable
        ? `可配送 ZIP：${zip}${locked ? "（默认地址）" : ""}`
        : `暂不支持 ZIP：${zip}`
      : "请输入 ZIP 以判断是否可配送";
  }

  if (!deliverable || !zone) {
    deliveryHintEl.textContent = "当前：未开通配送";
    deliveryInfoBodyEl.innerHTML = `
      <div class="delivery-info-title">当前 ZIP 暂未开通配送</div>
      <ul class="delivery-info-list">
        <li>你输入的 ZIP：<span class="delivery-highlight">${zip || "--"}</span></li>
        <li style="color:#b00020;">${reason}</li>
        <li>如需查询你所在区域什么时候开通：<strong>加微信 nyfreshbuy</strong> 咨询</li>
      </ul>
    `;
    return;
  }

  const briefZone = { id: zone.id || zone._id || "", name: zone.name || "" };
  saveZone(briefZone);
  localStorage.setItem("freshbuy_zone_ok", "1");

  // ✅ 用户是否手动选过配送模式：选过就不强制切回区域团
  const userSelected = localStorage.getItem(MODE_USER_SELECTED_KEY) === "1";

  if (!userSelected) {
    try {
      localStorage.setItem("freshbuy_pref_mode", "groupDay");
      window.dispatchEvent(new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: "groupDay" } }));
    } catch {}

    const areaBtn = document.querySelector('.delivery-pill[data-mode="area-group"]');
    if (areaBtn) {
      document.querySelectorAll(".delivery-pill").forEach((b) => b.classList.remove("active"));
      areaBtn.classList.add("active");
    }
    renderDeliveryInfo("area-group");
  } else {
    const active = document.querySelector(".delivery-pill.active");
    const currentMode = active?.dataset?.mode || toUiModeKey(localStorage.getItem("freshbuy_pref_mode"));
    renderDeliveryInfo(currentMode || "area-group");
  }

  window.dispatchEvent(new CustomEvent("freshbuy:zoneChanged", { detail: { zip, zone: briefZone } }));
}

async function tryDetectZipFromIP() {
  try {
    const r = await fetch(`/api/public/geo/ip-zip?ts=${Date.now()}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    return j?.success ? j.zip || "" : "";
  } catch {
    return "";
  }
}

async function resolveZoneByZipFromDB(zip) {
  const z = String(zip || "").trim();
  if (!/^\d{5}$/.test(z))
    return { ok: false, deliverable: false, zip: z, reason: "invalid zip" };

  try {
    const r = await fetch(`/api/public/zones/by-zip?zip=${encodeURIComponent(z)}&ts=${Date.now()}`, {
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    console.log("[by-zip resp]", j);

    const supported = j?.supported === true || j?.deliverable === true;

    if (supported && j?.zone) {
      return { ok: true, deliverable: true, zip: z, zone: j.zone };
    }
    return {
      ok: Boolean(j?.ok || j?.success),
      deliverable: false,
      zip: z,
      reason: j?.reason || j?.message || "该邮编暂不支持配送",
    };
  } catch (e) {
    console.error("resolveZoneByZipFromDB error:", e);
    return { ok: false, deliverable: false, zip: z, reason: "server error" };
  }
}

function getEffectiveZip(requestedZip) {
  const zipInput = $("zipInput");
  if (zipInput && zipInput.dataset.lockedByDefaultAddress === "1") {
    return String(zipInput.value || "").trim();
  }
  return String(requestedZip || zipInput?.value || "").trim();
}

async function applyZip(zip, { silent = false, force = false } = {}) {
  const zipInput = $("zipInput");
  const z = force ? String(zip || "").trim() : getEffectiveZip(zip);

  if (!isValidZip(z)) {
    if (!silent) alert("请输入 5 位 ZIP（例如：11365）");
    const payload = { ok: true, deliverable: false, zip: z, reason: "请输入 5 位 ZIP" };
    applyZoneToUI(z, payload);
    return;
  }

  const payload = await resolveZoneByZipFromDB(z);

  saveZip(z);
  if (zipInput) zipInput.value = z;

  if (payload?.deliverable === true && payload?.zone) {
    const zone = payload.zone;
    saveZone({ id: zone.id || zone._id || "", name: zone.name || "" });
    localStorage.setItem("freshbuy_zone_ok", "1");
  } else {
    localStorage.setItem("freshbuy_zone_ok", "0");
    saveZone({});
  }

  applyZoneToUI(z, payload);
}

async function initZipAutoZone() {
  const zipInput = $("zipInput");
  const zipApplyBtn = $("zipApplyBtn");

  const isLocked = zipInput?.dataset?.lockedByDefaultAddress === "1";

  if (isLocked) {
    const lockedZip = String(zipInput?.value || "").trim();
    if (isValidZip(lockedZip)) {
      await applyZip(lockedZip, { silent: true, force: true });
    } else {
      applyZoneToUI("", { ok: true, deliverable: false, zip: "", reason: "默认地址 ZIP 无效" });
    }
    return;
  }

  const saved = getSavedZip();
  if (saved && isValidZip(saved)) {
    await applyZip(saved, { silent: true });
  } else {
    const ipZip = await tryDetectZipFromIP();
    if (ipZip && isValidZip(ipZip)) {
      if (zipInput) zipInput.value = ipZip;
      await applyZip(ipZip, { silent: true });
    } else {
      applyZoneToUI("", { ok: true, deliverable: false, zip: "", reason: "" });
    }
  }

  const locked = zipInput?.dataset?.lockedByDefaultAddress === "1";
  if (locked) {
    hardLockInput(zipInput, zipInput?.dataset?.lockedZip || zipInput?.value || "");
    if (zipApplyBtn) zipApplyBtn.disabled = true;
    return;
  }

  if (zipApplyBtn) {
    zipApplyBtn.addEventListener("click", () => applyZip(zipInput?.value || ""));
  }

  if (zipInput) {
    zipInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyZip(zipInput.value);
    });
    zipInput.addEventListener("input", () => {
      zipInput.value = zipInput.value.replace(/[^\d]/g, "").slice(0, 5);
    });
  }
}

/* ====== 下一段从：页面最终初始化（DOMContentLoaded 主入口）开始 ====== */
// =========================
// 4) 页面完成后初始化（主入口）
// =========================
window.addEventListener("DOMContentLoaded", async () => {
  loadCategories();
  await loadHomeProductsFromSimple();
  bindGlobalSearch();
  await initAuthUIFromStorage();
  await applyZipFromDefaultAddressIfLoggedIn();

  // ✅ FIX：只用 window.FreshCart，避免 ReferenceError: FreshCart is not defined
  if (window.FreshCart && typeof window.FreshCart.initCartUI === "function") {
    window.FreshCart.initCartUI(cartConfig);
  }

  await initZipAutoZone();

  // ✅ 恢复用户选择的配送偏好
  const pref = localStorage.getItem("freshbuy_pref_mode");
  if (pref) {
    const uiMode = toUiModeKey(pref);
    const btn = document.querySelector(`.delivery-pill[data-mode="${uiMode}"]`);
    if (btn) btn.click();
  } else {
    renderDeliveryInfo("area-group");
  }
});

// =========================
// 🔍 搜索实现：过滤首页商品
// =========================
function doSearch(keyword) {
  const kw = String(keyword || "").trim().toLowerCase();

  const list = Array.isArray(window.allProducts) ? window.allProducts : [];
  if (!list.length) {
    console.warn("doSearch: allProducts 为空，先等商品加载完成");
    return;
  }

  const gridAll = document.getElementById("productGridNormal");
  if (!gridAll) return;

  if (!kw) {
    const nonHot = list.filter((p) => !isHotProduct(p));
    const limit = getLimit("Normal");
    const show = nonHot.slice(0, limit);

    gridAll.innerHTML = "";
    show.forEach((p) => gridAll.appendChild(createProductCard(p, "")));

    try {
      setTimeout(() => scheduleBadgeSync(), 0);
    } catch {}

    return;
  }

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

  const matched = list.filter(hit);

  gridAll.innerHTML = "";

  if (!matched.length) {
    gridAll.innerHTML = `<div style="padding:12px;font-size:13px;color:#6b7280;">没有找到「${keyword}」相关商品</div>`;
  } else {
    const limit = getLimit("Normal");
    matched.slice(0, limit).forEach((p) => gridAll.appendChild(createProductCard(p, "")));
  }

  try {
    setTimeout(() => scheduleBadgeSync(), 0);
  } catch {}

  try {
    const sec = document.getElementById("sectionAll") || document.getElementById("productGridNormal");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {}
}

// =========================
// 🔍 顶部搜索栏（globalSearchInput）
// =========================
function bindGlobalSearch() {
  const input = document.getElementById("globalSearchInput");
  if (!input) {
    console.warn("❌ 未找到 #globalSearchInput");
    return;
  }

  console.log("✅ 搜索栏已绑定");

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(input.value);
    }
  });

  input.addEventListener("input", () => {
    if (!input.value.trim()) {
      doSearch("");
    }
  });
}

/* ====== 下一段从：密码眼睛切换 + 右上角用户中心点击 + 徽章同步（freshbuy:cartUpdated/storage）开始 ====== */
// ===== 密码显示/隐藏（登录 & 注册）=====
(function bindPasswordEyeToggle() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".auth-eye[data-eye-for]");
    if (!btn) return;

    const inputId = btn.getAttribute("data-eye-for");
    const input = document.getElementById(inputId);
    if (!input) return;

    const isPwd = input.getAttribute("type") === "password";
    input.setAttribute("type", isPwd ? "text" : "password");

    btn.classList.toggle("is-on", isPwd);
    btn.setAttribute("aria-label", isPwd ? "隐藏密码" : "显示密码");
    btn.textContent = isPwd ? "🙈" : "👁";
  });
})();

// ================================
// ✅ FIX: 登录后右上角“我/尾号xxxx”点击无反应
// ================================
(function bindUserTopRightClick() {
  function goUserCenter() {
    window.location.href = "/user/user_center.html";
  }

  // 事件委托：永远能点
  document.addEventListener("click", (e) => {
    const user = e.target.closest("#userProfile");
    if (user) {
      e.preventDefault();
      e.stopPropagation();
      goUserCenter();
      return;
    }
  });

  // 兜底：再绑一次
  document.addEventListener("DOMContentLoaded", () => {
    const up = document.getElementById("userProfile");
    if (up && !up.dataset.bound) {
      up.dataset.bound = "1";
      up.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goUserCenter();
      });
    }
  });
})();

// ================================
// ✅ 商品图片右下角数量徽章：同步购物车数量
// ================================

// ✅ 页面加载后同步一次
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => scheduleBadgeSync(), 0);
});

// ✅ cart.js 或 doAdd() 广播时同步
window.addEventListener("freshbuy:cartUpdated", () => {
  scheduleBadgeSync();
   renderAllCardsAction(); // ✅ 统一切换显示
});
// =====================================================
// ✅✅✅ 统一绑定：底部加入购物车 + 黑框 +/- （事件委托，只绑一次）
// =====================================================
document.addEventListener("click", (e) => {
  const addBtn = e.target.closest(".product-add-fixed[data-add-only]");
  const overlayAddBtn = e.target.closest(".overlay-btn.add[data-add-pid]"); // ✅ 新增：overlay 加购
  const minusBtn = e.target.closest("[data-qty-minus]");
  const plusBtn = e.target.closest("[data-qty-plus]");
  if (!addBtn && !minusBtn && !plusBtn) return;

  const card = e.target.closest(".product-card");
  if (!card) return;

  // 阻止点按钮触发“进入详情页”
  e.preventDefault();
  e.stopPropagation();

  const pid = String(card.dataset.cartPid || "").trim();
  if (!pid) return;

  // 从卡片上取 normalizedItem（我们在 createProductCard 里挂）
  const normalizedItem = card.__normalizedItem || { id: pid };

  const cap0 = Number(card.__maxQty);
  const cap = Number.isFinite(cap0) ? Math.max(0, Math.floor(cap0)) : 0;

  const cur = getCartQty(pid);

  // 点击“加入购物车” => qty 变成 1
  if (addBtn) {
    if (cap <= 0) return;
    setCartQty(pid, 1, normalizedItem);
    try { window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } })); } catch {}
    renderCardAction(card);
    scheduleBadgeSync();
    return;
  }
    // ✅ 点击图片 overlay 的“加入购物车” => 直接 +1
  if (overlayAddBtn) {
    if (cap <= 0) return;
    const next = Math.min(cap, cur + 1);
    setCartQty(pid, next, normalizedItem);

    try {
      window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } }));
    } catch {}

    renderCardAction(card);
    scheduleBadgeSync();
    return;
  }
  // 点击 -
  if (minusBtn) {
    const next = Math.max(0, cur - 1);
    setCartQty(pid, next, normalizedItem);
    try { window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: -1 } })); } catch {}
    renderCardAction(card);
    scheduleBadgeSync();
    return;
  }

  // 点击 +
  if (plusBtn) {
    if (cap <= 0) return;
    const next = Math.min(cap, cur + 1);
    setCartQty(pid, next, normalizedItem);
    try { window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } })); } catch {}
    renderCardAction(card);
    scheduleBadgeSync();
    return;
  }
});
// ✅ 多标签页同步
window.addEventListener("storage", (e) => {
  if (!e || !e.key) return;
  if (String(e.key).toLowerCase().includes("cart")) {
    scheduleBadgeSync();
  }
});

// ✅ iOS: focus input can cause horizontal scroll drift
window.addEventListener("focusin", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
    window.scrollTo(0, window.scrollY);
  }
});

/* ====== 下一段（第9段）将包含：你页面里“去掉输入框/只能点+/-”相关的最终收尾逻辑，以及库存刷新后的卡片UI同步函数（如果你放在文件末尾） ====== */
// =====================================================
// ✅✅✅ 第9段：去掉数量输入框（只允许 +/-）+ 库存刷新时同步卡片UI
// =====================================================

// ✅ 统一：计算某张卡片的 maxQty（单个=stock；整箱=floor(stock/unitCount)）
function calcMaxQtyForCard(card) {
  if (!card) return 0;
  const vKey = String(card.dataset.variantKey || "single").trim() || "single";
  const unitCount = Math.max(1, Math.floor(Number(card.dataset.unitCount || 1) || 1));
  const stockUnits = Math.max(0, Math.floor(Number(card.__stockUnits ?? card.dataset.stockUnits ?? 0) || 0));

  const maxQty = vKey === "single" ? stockUnits : Math.floor(stockUnits / unitCount);
  return Math.max(0, Math.floor(maxQty));
}

// ✅ 把输入框隐藏，换成一个“数字显示”（只读）
function ensureQtyDisplayOnly(card) {
  if (!card) return;

  const qtyInput = card.querySelector('[data-qty-input]');
  const already = card.querySelector('[data-qty-display]');

  // 如果已经有 display，就不重复做
  if (already) {
    // 仍然隐藏 input（以防旧DOM有）
    if (qtyInput) qtyInput.style.display = "none";
    return;
  }

  if (qtyInput) {
    // 1) 隐藏输入框（客户不能手输）
    qtyInput.style.display = "none";
    qtyInput.setAttribute("readonly", "readonly");
    qtyInput.setAttribute("disabled", "disabled");
    qtyInput.style.pointerEvents = "none";

    // 2) 插入一个 span 显示数字
    const span = document.createElement("span");
    span.setAttribute("data-qty-display", "1");
    span.style.width = "64px";
    span.style.height = "34px";
    span.style.display = "inline-flex";
    span.style.alignItems = "center";
    span.style.justifyContent = "center";
    span.style.borderRadius = "10px";
    span.style.textAlign = "center";
    span.style.userSelect = "none";
    span.style.fontWeight = "800";
    span.style.background = "#f3f4f6";

    // 默认同步一次
    span.textContent = String(Math.max(1, Math.floor(Number(qtyInput.value || 1) || 1)));

    // 插在 input 原位置
    qtyInput.insertAdjacentElement("afterend", span);
  } else {
    // 如果你未来把 input 完全从HTML删了，这里也兼容：
    // 没有 input 就找一个空位（qty-row里）
    const row = card.querySelector(".qty-row");
    if (!row) return;
    const span = document.createElement("span");
    span.setAttribute("data-qty-display", "1");
    span.style.width = "64px";
    span.style.height = "34px";
    span.style.display = "inline-flex";
    span.style.alignItems = "center";
    span.style.justifyContent = "center";
    span.style.borderRadius = "10px";
    span.style.textAlign = "center";
    span.style.userSelect = "none";
    span.style.fontWeight = "800";
    span.style.background = "#f3f4f6";
    span.textContent = "1";

    // 放到 minus 和 plus 之间
    const minus = row.querySelector("[data-qty-minus]");
    if (minus) minus.insertAdjacentElement("afterend", span);
    else row.insertAdjacentElement("afterbegin", span);
  }
}

// ✅ 获取“当前想加购数量”（从 display 或 input）
function getWantedQtyFromCard(card) {
  const disp = card.querySelector("[data-qty-display]");
  if (disp) return Math.max(1, Math.floor(Number(disp.textContent || 1) || 1));

  const input = card.querySelector("[data-qty-input]");
  if (input) return Math.max(1, Math.floor(Number(input.value || 1) || 1));

  return 1;
}

// ✅ 写回“当前想加购数量”
function setWantedQtyToCard(card, n) {
  const v = Math.max(0, Math.floor(Number(n || 0) || 0));

  const disp = card.querySelector("[data-qty-display]");
  if (disp) disp.textContent = String(v);

  const input = card.querySelector("[data-qty-input]");
  if (input) input.value = String(v);
}

// ✅ 同步某张卡片：maxQty、按钮禁用、提示文案（含“仅剩 1 箱”）
function syncOneCardStockUI(card) {
  if (!card) return;

  // 1) 确保输入框被隐藏，只显示数字
  ensureQtyDisplayOnly(card);

  // 2) 计算 maxQty（用最新 stock）
  const maxQty = calcMaxQtyForCard(card);
  card.__maxQty = maxQty;

  // 3) 当前想加购数量 clamp 到 [1, maxQty]
  let want = getWantedQtyFromCard(card);
  if (maxQty <= 0) want = 0;
  else if (want < 1) want = 1;
  else if (want > maxQty) want = maxQty;
  setWantedQtyToCard(card, want);

  // 4) 按钮禁用规则（+/-）
  const minus = card.querySelector("[data-qty-minus]");
  const plus = card.querySelector("[data-qty-plus]");
  if (minus) minus.disabled = maxQty <= 0 || want <= 1;
  if (plus) plus.disabled = maxQty <= 0 || want >= maxQty;

  // 5) 加购按钮禁用（overlay + 固定底部按钮）
  const adds = card.querySelectorAll('[data-add-pid]');
  adds.forEach((btn) => {
    if (!btn || btn.tagName !== "BUTTON") return;
    btn.disabled = maxQty <= 0;
    if (maxQty <= 0) btn.textContent = "已售罄";
  });

  // 6) 文案：单个“仅剩 X”；整箱“仅剩 1 箱/仅剩 X 箱”
  const hint = card.querySelector("[data-qty-hint]");
  if (hint) {
    const vKey = String(card.dataset.variantKey || "single").trim() || "single";
    if (maxQty <= 0) {
      hint.textContent = "已售罄";
    } else if (vKey !== "single") {
      hint.textContent = maxQty === 1 ? "仅剩 1 箱" : `仅剩 ${maxQty} 箱`;
    } else {
      hint.textContent = `仅剩 ${maxQty}`;
    }
  }
}

// ✅ 同步页面上所有卡片（库存变化/购物车变化都可以调用）
function syncAllCardsStockUI() {
  document.querySelectorAll(".product-card[data-product-id]").forEach((card) => {
    syncOneCardStockUI(card);
  });

  // ✅ 徽章兜底：再同步一次（保证 badge<=maxQty）
  try {
    scheduleBadgeSync();
  } catch {}
}

// ✅ 绑定 +/- 事件：只允许点击改变（不允许手输）
function bindQtyButtonsOnlyOnce() {
  document.querySelectorAll(".product-card[data-product-id]").forEach((card) => {
    if (card.dataset.qtyBound === "1") return;
    card.dataset.qtyBound = "1";

    const minus = card.querySelector("[data-qty-minus]");
    const plus = card.querySelector("[data-qty-plus]");

    if (minus) {
      minus.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const maxQty = calcMaxQtyForCard(card);
        let want = getWantedQtyFromCard(card);
        want = Math.max(1, want - 1);
        if (maxQty > 0) want = Math.min(want, maxQty);
        setWantedQtyToCard(card, want);
        syncOneCardStockUI(card);
      });
    }

    if (plus) {
      plus.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const maxQty = calcMaxQtyForCard(card);
        let want = getWantedQtyFromCard(card);
        want = want + 1;
        if (maxQty > 0) want = Math.min(want, maxQty);
        else want = 0;
        setWantedQtyToCard(card, want);
        syncOneCardStockUI(card);
      });
    }

    // ✅ 如果旧版还存在 input，这里阻止交互（防止手机弹数字键盘）
    const input = card.querySelector("[data-qty-input]");
    if (input) {
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("focus", (e) => {
        e.preventDefault();
        input.blur();
      });
      input.addEventListener("keydown", (e) => {
        e.preventDefault();
      });
    }
  });
}

// ✅ 页面初次渲染完、以及每次搜索/刷新库存后，都要重新绑定 & 同步
window.addEventListener("DOMContentLoaded", () => {
  // 初次：绑定+同步
  setTimeout(() => {
    bindQtyButtonsOnlyOnce();
    syncAllCardsStockUI();
  }, 0);
});

// ✅ 当你刷新库存（refreshStockAndCards）后，调用一次同步
// （你第6段里有 setInterval(refreshStockAndCards, ...)，这里监听一个事件更稳）
window.addEventListener("freshbuy:stockRefreshed", () => {
  bindQtyButtonsOnlyOnce();
  syncAllCardsStockUI();
});

// ✅ 当购物车更新（徽章变化）时，也顺便同步卡片状态（比如 maxQty 变更后 clamp）
window.addEventListener("freshbuy:cartUpdated", () => {
  syncAllCardsStockUI();
});

// ✅ ✅ ✅ 如果你不想改 refreshStockAndCards 的函数体：这里加一个“兜底定时同步”
//    （避免某些情况下卡片没更新到 maxQty）
setInterval(() => {
  try {
    bindQtyButtonsOnlyOnce();
    syncAllCardsStockUI();
  } catch {}
}, 6000);
// =====================================================
// ✅ 自动刷新库存：每隔一段时间拉 /api/products-simple
// 只更新：每张商品卡的 stock/maxQty + UI（仅剩/售罄/禁用）+ 徽章兜底
// =====================================================
async function refreshStockAndCards() {
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

    if (!list.length) return;

    // productId -> 最新库存（单位=单个）
    const stockMap = {};
    const variantsMap = {}; // productId -> variants（可选备用）
    list.forEach((p) => {
      const id = String(p?._id || p?.id || "").trim();
      if (!id) return;
      stockMap[id] = Math.max(0, Math.floor(Number(p.stock ?? p.inventory ?? 0) || 0));
      variantsMap[id] = Array.isArray(p?.variants) ? p.variants : [];
    });

    // 遍历页面已有卡片，更新 __stockUnits/__maxQty
    document.querySelectorAll(".product-card[data-product-id]").forEach((card) => {
      const pid = String(card.dataset.productId || "").trim();
      const vKey = String(card.dataset.variantKey || "single").trim() || "single";
      const unitCount = Math.max(1, Math.floor(Number(card.dataset.unitCount || 1) || 1));

      if (!pid) return;

      const stockUnits = Number(stockMap[pid]);
      if (!Number.isFinite(stockUnits)) return;

      // ✅ 单个/整箱 maxQty
      const maxQty = vKey === "single" ? stockUnits : Math.floor(stockUnits / unitCount);

      card.__stockUnits = stockUnits;
      card.__maxQty = Math.max(0, Math.floor(maxQty));

      // 也写到 dataset，给其它逻辑兜底使用（可选）
      card.dataset.stockUnits = String(stockUnits);
      card.dataset.maxQty = String(Math.max(0, Math.floor(maxQty)));
    });

    // ✅ 立刻派发：库存已刷新（让第9段马上同步卡片UI）
    try {
      window.dispatchEvent(new CustomEvent("freshbuy:stockRefreshed"));
    } catch {}

    // ✅ 徽章兜底同步（保证 badge <= maxQty）
    try {
      scheduleBadgeSync();
    } catch {}
  } catch (e) {
    console.warn("refreshStockAndCards failed:", e);
  }
}

// 页面加载后开启轮询
window.addEventListener("DOMContentLoaded", () => {
  setInterval(refreshStockAndCards, STOCK_REFRESH_MS);
});
