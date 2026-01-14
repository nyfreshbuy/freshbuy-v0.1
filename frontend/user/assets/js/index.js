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
// ✅ 12) ✅ 商品图片右下角数量控件（盒马风格）：+- + 数字，qty=0 整组不显示
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
    default: 8,
  },
  mobile: {
    Hot: 6,
    DailySpecial: 8,
    New: 6,
    Best: 8,
    Normal: 4,
    default: 6,
  },
};

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

function scrollToSection(selectorOrId) {
  const sel =
    selectorOrId.startsWith("#") || selectorOrId.startsWith(".")
      ? selectorOrId
      : "#" + selectorOrId;
  const el = document.querySelector(sel);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const offset = window.scrollY + rect.top - 80;
  window.scrollTo({ top: offset, behavior: "smooth" });
}

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
const deliveryHint = document.getElementById("deliveryHint");
const deliveryInfo = document.getElementById("deliveryInfo");
const deliveryInfoBody = document.getElementById("deliveryInfoBody");

const MODE_USER_SELECTED_KEY = "freshbuy_user_selected_mode";

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

function getNextCutoffDate(cutoff) {
  const now = new Date();
  const target = new Date(now);

  const nowWeekday = now.getDay();
  const targetWeekday = Number(cutoff?.weekday ?? 5);

  let addDays = (targetWeekday - nowWeekday + 7) % 7;
  target.setDate(now.getDate() + addDays);

  target.setHours(
    cutoff?.hour ?? 23,
    cutoff?.minute ?? 59,
    cutoff?.second ?? 59,
    0
  );

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
  if (groupEndTime <= now && countdownTimer) clearInterval(countdownTimer);
}

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
  if (friendEndTime - now <= 0 && friendCountdownTimer)
    clearInterval(friendCountdownTimer);
}

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
        <li>预计人均运费：<span class="delivery-highlight">$${Number(
          st.avgFee || 0
        ).toFixed(2)}</span></li>
        <li>建议起送金额：<span class="delivery-highlight">$${Number(
          st.minAmount || 0
        ).toFixed(2)}</span></li>
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

renderDeliveryInfo("area-group");

document.addEventListener("click", (e) => {
  const pill = e.target.closest(".delivery-pill");
  if (!pill) return;

  document
    .querySelectorAll(".delivery-pill")
    .forEach((btn) => btn.classList.remove("active"));
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
    window.dispatchEvent(
      new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: mapped } })
    );
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
  const url =
    window.location.origin + "/user/index.html?mode=friend-group&ts=" + Date.now();
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

window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search || "");
  if (params.get("mode") === "friend-group") {
    const btn = document.querySelector('.delivery-pill[data-mode="friend-group"]');
    if (btn) btn.click();
  }
});

setTimeout(() => {
  try {
    renderCategoryPills(fallbackCategories);
    console.log("✅ 顶部分类已强制恢复");
  } catch (e) {
    console.warn("恢复顶部分类失败", e);
  }
}, 0);

// =========================
// 2) 商品卡片 + 首页商品
// =========================
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
  if (Array.isArray(p.labels) && p.labels.some((t) => norm(t).includes(kw)))
    return true;

  return false;
}

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
  if (
    isTrueFlag(p.isSpecial) ||
    isTrueFlag(p.isDailySpecial) ||
    isTrueFlag(p.onSale) ||
    isTrueFlag(p.isSale)
  )
    return true;

  const basePrice = Number(p.price ?? p.regularPrice ?? p.originPrice ?? 0);
  const salePrice = Number(
    p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0
  );

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
    isTrueFlag(p.isNew) ||
    isTrueFlag(p.isNewArrival) ||
    hasKeyword(p, "新品") ||
    hasKeyword(p, "新上架");

  if (!flag) return false;

  const dateStr = p.newUntil || p.newExpireAt || p.newExpiresAt;
  if (!dateStr) return true;

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now();
}

// ================================
// ✅ 盒马风格：右下角数量控件（qty=0 整组隐藏）
// ================================
function setProductBadge(pid, qty) {
  const wrapEls = document.querySelectorAll(`.product-qty-ctrl[data-pid="${pid}"]`);
  if (!wrapEls || !wrapEls.length) return;

  const n = Number(qty || 0);

  wrapEls.forEach((wrap) => {
    const numEl = wrap.querySelector(`.qty-num[data-qty-num="${pid}"]`);
    const minusBtn = wrap.querySelector(`.qty-btn.minus[data-qty-minus="${pid}"]`);

    if (n > 0) {
      if (numEl) numEl.textContent = n >= 99 ? "99+" : String(n);
      wrap.style.display = "inline-flex";
      if (minusBtn) minusBtn.disabled = false;
    } else {
      if (numEl) numEl.textContent = "0";
      wrap.style.display = "none";
    }
  });
}
function isMobileView2() {
  return window.matchMedia("(max-width: 768px)").matches;
}

/** 同步某个 pid 的所有数量控件（图片那份 + 按钮那份） */
function setProductQtyCtrl(pid, qty) {
  const wraps = document.querySelectorAll(`.product-qtyty-ctrl-fix, .product-qty-ctrl[data-pid="${pid}"]`);
  const n = Math.max(0, Number(qty || 0));

  wraps.forEach((wrap) => {
    const numEl = wrap.querySelector(`.qty-num[data-qty-num="${pid}"]`);
    if (numEl) numEl.textContent = n >= 99 ? "99+" : String(n);

    // ✅ 手机端：qty>0 就显示（覆盖在图片上那份）
    // ✅ 电脑端：qty>0 才显示，并且要“替换按钮”
    if (n > 0) {
      wrap.style.display = "inline-flex";
    } else {
      wrap.style.display = "none";
    }
  });

  // ✅ 电脑端按钮替换逻辑：qty>0 隐藏加入购物车按钮
  if (!isMobileView2()) {
    document.querySelectorAll(`.product-buy-row`).forEach((row) => {
      const ctrl = row.querySelector(`.product-qty-ctrl[data-pid="${pid}"]`);
      const btn = row.querySelector(`.product-add-fixed[data-add-pid="${pid}"]`);
      if (!ctrl || !btn) return;

      if (n > 0) {
        btn.style.display = "none";
        ctrl.style.display = "inline-flex";
      } else {
        btn.style.display = "";
        ctrl.style.display = "none";
      }
    });
  }
}

/** 从 cart snapshot 取当前 pid 数量 */
function getQtyByPid(pid) {
  const cart = getCartSnapshot();
  const map = normalizeCartToQtyMap(cart);
  return Number(map[pid] || 0);
}

/** 增减 qty：确保 - 只减 1 个 */
function changeQtyByPid(pid, delta, productForAdd) {
  const cartApi =
    (window.FreshCart && typeof window.FreshCart.addItem === "function" && window.FreshCart) ||
    (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
    null;

  if (!cartApi) {
    alert("购物车模块暂未启用（请确认 cart.js 已加载）");
    return;
  }

  const cur = getQtyByPid(pid);
  const next = Math.max(0, cur + delta);

  // ✅ 优先用 updateQty / setQty（如果你的 cart.js 有）
  if (typeof cartApi.updateQty === "function") {
    cartApi.updateQty(pid, next);
  } else if (typeof cartApi.setQty === "function") {
    cartApi.setQty(pid, next);
  } else if (delta < 0 && typeof cartApi.removeOne === "function") {
    cartApi.removeOne(pid); // 有些实现会提供 removeOne
  } else if (delta < 0 && typeof cartApi.removeItem === "function" && next === 0) {
    cartApi.removeItem(pid);
  } else {
    // ✅ 兜底：用 addItem 增加 / 减少（减法用 -1）
    // ⚠️ 你的 cart.js 如果不支持负数，就会无效；那就需要改 cart.js（我也能帮你）
    cartApi.addItem(productForAdd, delta);
  }

  // ✅ UI 先乐观更新一次（立刻响应）
  setProductQtyCtrl(pid, next);

  // ✅ 再异步从 cart 真实数据同步一次（防止写入延迟）
  setTimeout(() => {
    try {
      const real = getQtyByPid(pid);
      setProductQtyCtrl(pid, real);
    } catch {}
  }, 120);

  // 广播
  try {
    window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta } }));
  } catch {}
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
      const lk = k.toLowerCase();
      if (lk.includes("cart")) candidates.push(k);
    }

    candidates.sort((a, b) => {
      const A = a.toLowerCase();
      const B = b.toLowerCase();
      const score = (s) =>
        (s.includes("freshbuy") ? 10 : 0) +
        (s.includes("fb") ? 3 : 0) +
        (s.includes("cart") ? 1 : 0);
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
      const id =
        String(
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

      const qty = Number(
        it.qty ??
          it.quantity ??
          it.count ??
          it.num ??
          it.amount ??
          it.n ??
          it.q ??
          0
      );

      if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
    });
    return map;
  }

  if (typeof cart === "object") {
    for (const k of Object.keys(cart)) {
      const v = cart[k];
      if (!k) continue;

      const lk = String(k).toLowerCase();
      if (
        lk === "total" ||
        lk === "meta" ||
        lk === "items" ||
        lk === "cart" ||
        lk === "state" ||
        lk === "data"
      )
        continue;

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

  // ✅ 这里必须同步 product-qty-ctrl（而不是不存在的 product-qty-badge）
  document.querySelectorAll(".product-qty-ctrl[data-pid]").forEach((wrap) => {
    const pid = wrap.getAttribute("data-pid");
    setProductBadge(pid, qtyMap[pid] || 0);
  });
}

function createProductCard(p, extraBadgeText) {
  const article = document.createElement("article");
  article.className = "product-card";

  const pid = String(p._id || p.id || p.sku || "").trim();

  const basePrice = Number(p.price ?? p.originPrice ?? p.regularPrice ?? 0);
  const salePrice = Number(
    p.salePrice ?? p.specialPrice ?? p.discountPrice ?? p.flashPrice ?? 0
  );

  const finalPrice =
    basePrice > 0 && salePrice > 0 && salePrice < basePrice
      ? salePrice
      : basePrice || salePrice || 0;

  const originNum =
    basePrice > 0 && salePrice > 0 && salePrice < basePrice
      ? basePrice
      : Number(p.originPrice ?? 0);

  const hasOrigin = originNum > 0 && originNum > finalPrice;

  const badgeText =
    extraBadgeText || ((p.tag || "").includes("爆品") ? "爆品" : "");

  const imageUrl =
    p.image && String(p.image).trim()
      ? String(p.image).trim()
      : `https://picsum.photos/seed/${encodeURIComponent(
          pid || p.name || "fb"
        )}/500/400`;

  const tagline = (p.tag || p.category || "").slice(0, 18);
  const limitQty = p.limitQty || p.limitPerUser || p.maxQty || p.purchaseLimit || 0;

  article.innerHTML = `
    <div class="product-image-wrap">
      ${badgeText ? `<span class="special-badge">${badgeText}</span>` : ""}
      <img src="${imageUrl}" class="product-image" alt="${p.name || ""}" />

      <!-- ✅ 盒马风格：右下角数量控件（qty=0 时整组隐藏） -->
      <div class="product-qty-ctrl" data-pid="${pid}" style="display:none;">
        <button type="button" class="qty-btn minus" data-qty-minus="${pid}" aria-label="减少">−</button>
        <span class="qty-num" data-qty-num="${pid}">0</span>
        <button type="button" class="qty-btn plus" data-qty-plus="${pid}" aria-label="增加">+</button>
      </div>

      <div class="product-overlay">
        <div class="overlay-btn-row">
          <button type="button" class="overlay-btn fav">⭐ 收藏</button>
          <button type="button" class="overlay-btn add" data-add-pid="${pid}">
            加入购物车${limitQty > 0 ? `（限购${limitQty}）` : ""}
          </button>
        </div>
      </div>
    </div>

    <div class="product-name">${p.name || ""}</div>
    <div class="product-desc">${p.desc || ""}</div>

    <div class="product-price-row">
      <span class="product-price">$${finalPrice.toFixed(2)}</span>
      ${hasOrigin ? `<span class="product-origin">$${originNum.toFixed(2)}</span>` : ""}
    </div>

    <div class="product-tagline">${tagline}</div>

    <div class="product-buy-row">
  <button type="button" class="product-add-fixed" data-add-pid="${pid}">
    加入购物车
  </button>

  <!-- ✅ 数量控件：手机端显示在图上；电脑端显示在按钮位（qty>0 才显示） -->
  <div class="product-qty-ctrl" data-pid="${pid}" style="display:none;">
    <button type="button" class="qty-btn minus" data-qty-minus="${pid}" aria-label="减少">−</button>
    <span class="qty-num" data-qty-num="${pid}">0</span>
    <button type="button" class="qty-btn plus" data-qty-plus="${pid}" aria-label="增加">+</button>
  </div>
</div>
  `;

  // ✅ 点击卡片跳详情（但点击 qty / 按钮不跳）
  article.addEventListener("click", () => {
    if (!pid) return;
    window.location.href = "product_detail.html?id=" + encodeURIComponent(pid);
  });

  function getCartApi() {
    const cartApi =
      (window.FreshCart &&
        typeof window.FreshCart.addItem === "function" &&
        window.FreshCart) ||
      (window.Cart && typeof window.Cart.addItem === "function" && window.Cart) ||
      null;
    return cartApi;
  }

  function doAdd(ev) {
    ev.stopPropagation();

    const cartApi = getCartApi();
    if (!cartApi) {
      alert("购物车模块暂未启用（请确认 cart.js 已加载）");
      return;
    }

    const normalized = {
      id: pid,
      name: p.name || "商品",
      price: finalPrice,
      priceNum: finalPrice,
      image: p.image || imageUrl,
      tag: p.tag || "",
      type: p.type || "",
      isSpecial: isHotProduct(p),
      isDeal: isHotProduct(p),
    };

    cartApi.addItem(normalized, 1);

    // ✅ 立即把控件显示出来（不依赖 cart.js 广播）
    try {
      const ctrl = article.querySelector(`.product-qty-ctrl[data-pid="${pid}"]`);
      const numEl = article.querySelector(`.qty-num[data-qty-num="${pid}"]`);
      const cur = Number(numEl?.textContent || 0) || 0;
      const next = Math.min(cur + 1, 99);
      setProductBadge(pid, next);
    } catch {}

    try {
      window.dispatchEvent(
        new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } })
      );
    } catch {}

    // ✅ 等 cart.js/localStorage 真正写入后，再同步一次（避免被覆盖）
    setTimeout(() => {
      try {
        trySyncBadgesFromCart();
      } catch {}
    }, 150);
  }

  // ✅ 加入购物车按钮
  const overlayAdd = article.querySelector('.overlay-btn.add[data-add-pid]');
  if (overlayAdd) overlayAdd.addEventListener("click", doAdd);

  const fixedAdd = article.querySelector('.product-add-fixed[data-add-pid]');
  if (fixedAdd) fixedAdd.addEventListener("click", doAdd);

  // ✅ 收藏
  const favBtn = article.querySelector(".overlay-btn.fav");
  if (favBtn) {
    favBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      alert("收藏功能后续接入，这里先做占位提示。");
    });
  }

  // ===============================
  // ✅✅✅ 盒马风格：+- 事件绑定（真正生效）
  // ===============================
  const qtyCtrl = article.querySelector(`.product-qty-ctrl[data-pid="${pid}"]`);
  if (qtyCtrl) {
    // 点击控件本身不跳详情
    qtyCtrl.addEventListener("click", (ev) => ev.stopPropagation());
  }

  const plusBtn = article.querySelector(`.qty-btn.plus[data-qty-plus="${pid}"]`);
  if (plusBtn) {
    plusBtn.addEventListener("click", (ev) => {
      // 复用加购逻辑
      doAdd(ev);
    });
  }

  const minusBtn = article.querySelector(`.qty-btn.minus[data-qty-minus="${pid}"]`);
  if (minusBtn) {
    minusBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();

      const cartApi = getCartApi();
      if (!cartApi) return;

      // 当前显示数量（先用UI，UI没有再用购物车快照）
      let cur = 0;
      try {
        const numEl = article.querySelector(`.qty-num[data-qty-num="${pid}"]`);
        cur = Number(numEl?.textContent || 0) || 0;
      } catch {}
      if (!cur) {
        const map = normalizeCartToQtyMap(getCartSnapshot());
        cur = Number(map[pid] || 0) || 0;
      }

      const next = Math.max(0, cur - 1);

      // ✅ 调用 cart.js 的“减一”能力（多兼容）
      if (typeof cartApi.removeItem === "function") {
        cartApi.removeItem(pid, 1);
      } else if (typeof cartApi.decreaseItem === "function") {
        cartApi.decreaseItem(pid, 1);
      } else if (typeof cartApi.updateQty === "function") {
        cartApi.updateQty(pid, next);
      } else if (typeof cartApi.setQty === "function") {
        cartApi.setQty(pid, next);
      } else {
        // 没有减法API也至少把UI正确隐藏
      }

      // ✅ 立即更新UI（0 则整组隐藏）
      setProductBadge(pid, next);

      try {
        window.dispatchEvent(
          new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: -1 } })
        );
      } catch {}

      setTimeout(() => {
        try {
          trySyncBadgesFromCart();
        } catch {}
      }, 150);
    });
  }

  return article;
}
setProductQtyCtrl(pid, getQtyByPid(pid)); // ✅ 让电脑端马上从按钮切换成 -数字+
// IP 建议 ZIP（不强制）—— ✅ 如果 ZIP 已被“默认地址锁定”，则不要再用 IP 覆盖
// ✅ 绑定 +/-（两份控件一起生效）
function bindQtyButtons() {
  const minusBtns = article.querySelectorAll(`.qty-btn.minus[data-qty-minus="${pid}"]`);
  const plusBtns = article.querySelectorAll(`.qty-btn.plus[data-qty-plus="${pid}"]`);

  // ✅ 这个对象用来 addItem 增加时用
  const normalized = {
    id: pid,
    name: p.name || "商品",
    price: finalPrice,
    priceNum: finalPrice,
    image: p.image || imageUrl,
    tag: p.tag || "",
    type: p.type || "",
    isSpecial: isHotProduct(p),
    isDeal: isHotProduct(p),
  };

  minusBtns.forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      changeQtyByPid(pid, -1, normalized); // ✅ - 永远只减 1
    });
  });

  plusBtns.forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      changeQtyByPid(pid, +1, normalized);
    });
  });
}

bindQtyButtons();

// ✅ 初次渲染就同步一次 qty（如果购物车里已有）
setTimeout(() => {
  try {
    setProductQtyCtrl(pid, getQtyByPid(pid));
  } catch {}
}, 0);
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

    if (!list.length) {
      [
        "productGridHot",
        "productGridDaily",
        "productGridNew",
        "productGridBest",
        "productGridNormal",
      ].forEach((id) => {
        const grid = document.getElementById(id);
        if (grid)
          grid.innerHTML =
            '<div style="padding:12px;font-size:13px;color:#6b7280;">暂时没有商品</div>';
      });
      return;
    }

    window.allProducts = list;

    const hotList = list.filter((p) => isHotProduct(p));
    const nonHotList = list.filter((p) => !isHotProduct(p));

    let familyList = nonHotList.filter((p) => isFamilyProduct(p));
    let newList = nonHotList.filter((p) => isNewProduct(p));
    if (newList.length > 30) newList = newList.slice(0, 30);

    let bestList = nonHotList.filter((p) => isBestSellerProduct(p));
    if (bestList.length > 30) bestList = bestList.slice(0, 30);

    const allList = nonHotList;

    if (!familyList.length) familyList = [];
    if (!newList.length) newList = allList.slice(0, 12);
    if (!bestList.length) bestList = allList.slice(0, 12);

    function renderIntoGrid(gridId, items, typeLabel) {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      grid.innerHTML = "";

      if (!items.length) {
        grid.innerHTML =
          '<div style="padding:12px;font-size:13px;color:#6b7280;">暂时没有商品</div>';
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

    // ✅ 商品渲染完后同步一次数量控件
    try {
      setTimeout(() => trySyncBadgesFromCart(), 0);
    } catch {}
  } catch (err) {
    console.error("首页加载 /api/products-simple 失败：", err);
  }
}

// =========================
// 3) 登录 / 注册弹窗 + 顶部头像
// =========================
const AUTH_TOKEN_KEY = "freshbuy_token";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}
function setToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
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

  if (res.status === 401 || (data && data.success === false && data.msg === "未登录")) {
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

async function apiSendSmsCode(phone) {
  const { res, data } = await apiFetch("/api/sms/send-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!res.ok || !data?.success) throw new Error(data?.message || "发送验证码失败");
  return data;
}

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

async function apiMe() {
  const token = getToken();
  if (!token) return null;
  const { res, data } = await apiFetch("/api/auth/me");
  if (!res.ok || !data?.success) return null;
  return data.user || null;
}

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

const authBackdrop = document.getElementById("authBackdrop");
const authCloseBtn = document.getElementById("authCloseBtn");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const authTitle = document.getElementById("authTitle");

const loginPanel = document.getElementById("loginPanel");
const registerPanel = document.getElementById("registerPanel");

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

async function initAuthUIFromStorage() {
  const me = await apiMe();
  if (me && me.phone) applyLoggedInUI(me.phone);
  else applyLoggedOutUI();
  return me || null;
}

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

function switchAuthMode(mode) {
  if (!tabLogin || !tabRegister || !loginPanel || !registerPanel || !authTitle)
    return;
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
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(pwd || ""));
}

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

// ===============================
// ✅ ZIP 锁定/解锁（左右同步）
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

  const userSelected = localStorage.getItem(MODE_USER_SELECTED_KEY) === "1";
  if (!userSelected) {
    try {
      localStorage.setItem("freshbuy_pref_mode", "groupDay");
      window.dispatchEvent(
        new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: "groupDay" } })
      );
    } catch {}

    const areaBtn = document.querySelector('.delivery-pill[data-mode="area-group"]');
    if (areaBtn) {
      document
        .querySelectorAll(".delivery-pill")
        .forEach((b) => b.classList.remove("active"));
      areaBtn.classList.add("active");
    }
    renderDeliveryInfo("area-group");
  } else {
    const active = document.querySelector(".delivery-pill.active");
    const currentMode =
      active?.dataset?.mode || toUiModeKey(localStorage.getItem("freshbuy_pref_mode"));
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
  if (!/^\d{5}$/.test(z)) return { ok: false, deliverable: false, zip: z, reason: "invalid zip" };

  try {
    const r = await fetch(
      `/api/public/zones/by-zip?zip=${encodeURIComponent(z)}&ts=${Date.now()}`,
      { cache: "no-store" }
    );
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

// =========================
// 4) 页面完成后初始化
// =========================
window.addEventListener("DOMContentLoaded", async () => {
  loadCategories();
  await loadHomeProductsFromSimple();
  bindGlobalSearch();
  await initAuthUIFromStorage();
  await applyZipFromDefaultAddressIfLoggedIn();

  if (window.FreshCart && typeof FreshCart.initCartUI === "function") {
    FreshCart.initCartUI(cartConfig);
  }

  await initZipAutoZone();

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
      setTimeout(() => trySyncBadgesFromCart(), 0);
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
    matched
      .slice(0, limit)
      .forEach((p) => gridAll.appendChild(createProductCard(p, "")));
  }

  try {
    setTimeout(() => trySyncBadgesFromCart(), 0);
  } catch {}

  try {
    const sec =
      document.getElementById("sectionAll") || document.getElementById("productGridNormal");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {}
}

// =========================
// 🔍 顶部搜索栏
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

// ===== 密码显示/隐藏 =====
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

  document.addEventListener("click", (e) => {
    const user = e.target.closest("#userProfile");
    if (user) {
      e.preventDefault();
      e.stopPropagation();
      goUserCenter();
      return;
    }
  });

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
// ✅ 数量控件：同步购物车数量
// ================================
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => trySyncBadgesFromCart(), 0);
});

window.addEventListener("freshbuy:cartUpdated", () => {
  trySyncBadgesFromCart();
});

window.addEventListener("storage", (e) => {
  if (!e || !e.key) return;
  if (String(e.key).toLowerCase().includes("cart")) {
    trySyncBadgesFromCart();
  }
});
