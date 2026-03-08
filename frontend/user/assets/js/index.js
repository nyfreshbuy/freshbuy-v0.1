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
    default: 12, // 电脑端所有区块默认 8
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

// ✅ 区域团时间文案（新）：优先用后端 zone.deliveryDays 自动生成
function weekdayCN(n) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][n] || "";
}

// deliveryDay: 0-6（0周日...6周六）
function buildAreaGroupScheduleFromDeliveryDay(deliveryDay) {
  const d = Number(deliveryDay);
  if (!Number.isFinite(d) || d < 0 || d > 6) return null;

  const eta = `本周${weekdayCN(d)} 18:00 - 22:00`;

  // 截单默认：配送前一天 23:59:59
  const cutoffWeekday = (d + 6) % 7; // 前一天
  const cutoff = { weekday: cutoffWeekday, hour: 23, minute: 59, second: 59 };
  const cutoffText = `${weekdayCN(cutoffWeekday)} 23:59:59`;

  return { eta, cutoff, cutoffText };
}

// ✅ 统一取 schedule：优先 zone.deliveryDays[0]，否则才走“按名称兜底”
function getZoneScheduleByZone(zoneObjOrName) {
  // 1) 传进来的是 zone 对象（推荐）
  if (zoneObjOrName && typeof zoneObjOrName === "object") {
    const d0 = Array.isArray(zoneObjOrName.deliveryDays)
      ? Number(zoneObjOrName.deliveryDays[0])
      : NaN;

    const s = buildAreaGroupScheduleFromDeliveryDay(d0);
    if (s) return s;
  }

  // 2) 兜底：老逻辑按名称（防止旧数据没 deliveryDays）
  const zoneName = typeof zoneObjOrName === "string" ? zoneObjOrName : "";
  const key = String(zoneName || "").trim();

  if (key === "白石镇/大学点地区") {
    return {
      eta: "本周六 18:00 - 22:00",
      cutoff: { weekday: 5, hour: 23, minute: 59, second: 59 },
      cutoffText: "周五 23:59:59",
    };
  }
  if (key === "新鲜草原地区") {
    return {
      eta: "本周五 18:00 - 22:00",
      cutoff: { weekday: 4, hour: 23, minute: 59, second: 59 },
      cutoffText: "周四 23:59:59",
    };
  }

  // 3) 最终兜底
  return {
    eta: "本周五 18:00 - 22:00",
    cutoff: { weekday: 4, hour: 23, minute: 59, second: 59 },
    cutoffText: "配送前一天 23:59:59 前",
  };
}
const deliveryStats = {
  "area-group": {
    areaName: "区域团",
    joinedOrders: 0, // ✅ 不写死
    needOrders: 50,  // ✅ 默认目标
    realJoined: 0,
    fakeJoined: 0,
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

  const totalSec = Math.floor(diff / 1000);

const days = Math.floor(totalSec / 86400);
const hours = Math.floor((totalSec % 86400) / 3600);
const mins = Math.floor((totalSec % 3600) / 60);
const secs = totalSec % 60;

// 显示：X天 XX小时 XX分钟 XX秒
el.textContent =
  (days > 0 ? `${days}天 ` : "") +
  `${String(hours).padStart(2, "0")}小时 ` +
  `${String(mins).padStart(2, "0")}分钟 ` +
  `${String(secs).padStart(2, "0")}秒`;
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
  const schedule = getZoneScheduleByZone(z || zoneName);
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
  if (mode === "pickup") {
    deliveryHint.textContent = `当前：自提点自提 · 系统推荐附近自提点`;
    deliveryInfoBody.innerHTML = `
      <div class="delivery-info-title">自提点自提</div>
      <ul class="delivery-info-list">
        <li>系统会根据你的 ZIP 推荐附近自提点</li>
        <li>你也可以自由选择自己喜欢的自提点</li>
        <li>自提点将在结算页进行确认</li>
        <li class="delivery-highlight">自提点自提通常免配送费</li>
      </ul>
    `;
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
  if (m === "pickup") return "pickup";
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
// ✅ 统一布尔判定（修复：isTrueFlag is not defined）
function isTrueFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
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
// ✅ 更强：从 FreshCart / Cart / localStorage 自动找“像购物车”的数据
function getCartSnapshot() {
  // 1) FreshCart 优先（你现在有 getState）
  try {
    const fc = window.FreshCart;
    if (fc) {
      if (typeof fc.getState === "function") return fc.getState();
      // 兜底：有些实现把 state 直接挂出来
      if (fc.state) return fc.state;
      if (fc.cart) return fc.cart;
    }
  } catch {}

  // 2) Cart 兼容（你现在也有 getState）
  try {
    const c = window.Cart;
    if (c) {
      if (typeof c.getState === "function") return c.getState();
      if (c.state) return c.state;
      if (c.cart) return c.cart;
    }
  } catch {}

  // 3) 最后才扫 localStorage（兜底）
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
      const score = (s) =>
        (s.includes("freshbuy") ? 10 : 0) + (s.includes("fb") ? 3 : 0) + (s.includes("cart") ? 1 : 0);
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
        // ✅ 新增：更多常见字段
    if (obj.itemsById) return obj.itemsById;
    if (obj.cartItems) return obj.cartItems;
    if (obj.lines) return obj.lines;
    if (obj.lineItems) return obj.lineItems;
    for (const key of Object.keys(obj)) {
      const got = findItems(obj[key], depth + 1);
      if (got) return got;
    }
    return null;
  }

  const items = findItems(cart);
   // ✅ 新增：支持 items 是对象映射（FreshCart/某些实现会用 map 而不是数组）
  if (items && typeof items === "object" && !Array.isArray(items)) {
    Object.keys(items).forEach((k) => {
      const it = items[k];
      if (!it || typeof it !== "object") return;

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
          k || ""
      ).trim();

      const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.q ?? 0);
      if (id) map[id] = (map[id] || 0) + (Number.isFinite(qty) ? qty : 0);
    });

    return map;
  }
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

      const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.q ?? 0);
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
// 2) 把购物车里某个 pid 的数量设置为 targetQty
// normalizedItem：当需要 addItem 时用（createProductCard 里已挂 card.__normalizedItem）
function setCartQty(pid, targetQty, normalizedItem) {
  const next = Math.max(0, Math.floor(Number(targetQty || 0) || 0));

  const cartApi = (window.FreshCart && window.FreshCart) || (window.Cart && window.Cart) || null;
  if (!cartApi) {
    alert("购物车模块暂未启用（请确认 cart.js 已加载）");
    return false;
  }

  const curQty = getCartQty(pid);

  // =========================
  // 目标为 0：优先 remove / setQty(0)
  // =========================
  if (next === 0) {
    try {
      if (typeof cartApi.setQty === "function") {
        cartApi.setQty(pid, 0);
        return true;
      }
    } catch {}
    try {
      if (typeof cartApi.removeItem === "function") {
        cartApi.removeItem(pid);
        return true;
      }
      if (typeof cartApi.remove === "function") {
        cartApi.remove(pid);
        return true;
      }
    } catch {}
    // 即使没有 remove，也视为成功（UI 会隐藏）
    return true;
  }

  // =========================
  // next > 0 且当前不存在：必须 addItem 创建
  // =========================
  if (curQty <= 0) {
    if (typeof cartApi.addItem === "function") {
      const item = normalizedItem || { id: pid };
      try {
        cartApi.addItem(item, next); // addItem(item, qty)
        return true;
      } catch {}
      try {
        cartApi.addItem(pid, next); // addItem(pid, qty)
        return true;
      } catch {}
      try {
        cartApi.addItem({ ...item, qty: next, quantity: next, count: next }); // addItem({.., qty})
        return true;
      } catch {}
    }
    return false;
  }

  // =========================
  // 当前已存在：优先 setQty / updateQty / changeQty
  // =========================
  try {
    if (typeof cartApi.setQty === "function") {
      cartApi.setQty(pid, next);
      return true;
    }
    if (typeof cartApi.updateQty === "function") {
      cartApi.updateQty(pid, next);
      return true;
    }
    if (typeof cartApi.setItemQty === "function") {
      cartApi.setItemQty(pid, next);
      return true;
    }
    if (typeof cartApi.changeQty === "function") {
      const delta = next - curQty; // changeQty 用增量
      cartApi.changeQty(pid, delta);
      return true;
    }
  } catch {}

  // =========================
  // ✅ 兜底：差量逻辑（你原来这段被 return false 卡死了）
  // =========================
  const delta = next - curQty;
  if (delta === 0) return true;

  // 需要增加：用 addItem 增量
  if (delta > 0) {
    if (typeof cartApi.addItem === "function") {
      const item = normalizedItem || { id: pid };
      try {
        cartApi.addItem(item, delta);
        return true;
      } catch {}
      try {
        cartApi.addItem(pid, delta);
        return true;
      } catch {}
      try {
        cartApi.addItem({ ...item, qty: delta, quantity: delta, count: delta });
        return true;
      } catch {}
    }
    return false;
  }

  // 需要减少：优先 removeOne / decreaseItem；否则循环减
  const steps = Math.abs(delta);
  for (let i = 0; i < steps; i++) {
    try {
      if (typeof cartApi.decreaseItem === "function") {
        cartApi.decreaseItem(pid, 1);
        continue;
      }
      if (typeof cartApi.removeOne === "function") {
        cartApi.removeOne(pid);
        continue;
      }
      // 没有逐个减少方法，就退化：如果目标是 0，直接 remove
      if (i === steps - 1 && next === 0) {
        if (typeof cartApi.removeItem === "function") {
          cartApi.removeItem(pid);
          return true;
        }
        if (typeof cartApi.remove === "function") {
          cartApi.remove(pid);
          return true;
        }
      }
    } catch {}
  }

  return true;
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
// ✅ 兼容旧调用：你代码里还在用 renderActionByCartQty()
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
    // ✅ 提前准备好购物车 item（给全局事件委托用）
  const normalized = {
    id: pid,                // cartKey（productId::variantKey）
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
  article.__normalizedItem = normalized;
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
  // ✅ 只用全局统一模块渲染（不要再用卡片内 renderActionByCartQty）
  function syncQtyUI() {
  selectedQty = clampQty(selectedQty);

  if (btnMinus) btnMinus.disabled = selectedQty <= 1 || maxQty <= 0;
  if (btnPlus) btnPlus.disabled = maxQty <= 0 || selectedQty >= maxQty;

  const newMaxText = unitCount > 1 ? `仅剩 ${Math.max(0, maxQty)} 箱` : `仅剩 ${Math.max(0, maxQty)}`;
  if (qtyHint) qtyHint.textContent = maxQty <= 0 ? "已售罄" : newMaxText;

  const overlayAdd = article.querySelector(`.overlay-btn.add[data-add-pid="${pid}"]`);
const fixedAdd = article.querySelector(`.product-add-fixed[data-add-pid="${pid}"]`);
  if (overlayAdd) overlayAdd.disabled = maxQty <= 0;
  if (fixedAdd) fixedAdd.disabled = maxQty <= 0;
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
    renderCardAction(article);
 // ✅ 关键：库存刷新后黑框回到购物车数量
    // 强制同步徽章（兜底：如果购物车里原数量>新库存，会被 setProductBadge 压回去）
    try {
      scheduleBadgeSync();
    } catch {}
  };
  // 初次渲染：根据购物车数量决定显示“加入购物车”还是“黑框”
  return article;
}
// =====================================================
// ✅ 共享给 hot.html 使用：把爆品页需要的能力挂到 window.FB
// 插入位置：createProductCard() 结束后
// =====================================================
window.FB = window.FB || {};
window.FB.createProductCard = createProductCard;
window.FB.expandProductsWithVariants = expandProductsWithVariants;
window.FB.isHotProduct = isHotProduct;
window.FB.money = money;

// 购物车徽章/按钮切换（hot 页也要用）
window.FB.scheduleBadgeSync = scheduleBadgeSync;
window.FB.renderAllCardsAction = renderAllCardsAction;
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
// =========================
// ✅ iOS 键盘：弹窗不溢出屏幕（锁滚动 + visualViewport 高度变量）
// =========================
let __modalScrollY = 0;

function setVvhVar() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${h}px`);
}

function lockBodyScroll() {
  __modalScrollY = window.scrollY || 0;

  // ✅ 锁住页面（防止 iOS 把页面整体顶来顶去）
  document.documentElement.classList.add("modal-open");
  document.body.classList.add("modal-open");

  document.body.style.position = "fixed";
  document.body.style.top = `-${__modalScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";

  setVvhVar();
}

function unlockBodyScroll() {
  // ✅ 解锁
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");

  const y = __modalScrollY || 0;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";

  // ✅ 恢复滚动位置
  window.scrollTo(0, y);
  __modalScrollY = 0;

  document.documentElement.style.removeProperty("--vvh");
}

// ✅ 键盘弹出/收起时，实时更新可见视口高度变量（给 CSS 用）
(function bindVisualViewportVar() {
  setVvhVar();
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener("resize", setVvhVar);
  vv.addEventListener("scroll", setVvhVar);
})();
// =====================================================
// ✅ iOS：搜索栏 & ZIP 输入框 —— 键盘打开不撑破页面
// =====================================================
let __kbScrollY = 0;
let __kbLocked = false;

function kbSetVvh() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${h}px`);
}

function kbLockForInput() {
  if (document.body.classList.contains("modal-open")) return;
  if (__kbLocked) return;

  // ✅ 关键：延迟到下一帧，避免 iOS Safari 失焦
  requestAnimationFrame(() => {
    if (__kbLocked) return;
    __kbLocked = true;
    __kbScrollY = window.scrollY || 0;

    document.body.classList.add("kb-open");
    document.body.style.position = "fixed";
    document.body.style.top = `-${__kbScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    kbSetVvh();
  });
}
function kbUnlockForInput() {
  if (!__kbLocked) return;
  __kbLocked = false;

  document.body.classList.remove("kb-open");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  document.body.style.overflow = "";

  window.scrollTo(0, __kbScrollY || 0);
  __kbScrollY = 0;
}

// 绑定到指定 input
function bindKbSafeInput(selector) {
  const el = document.querySelector(selector);
  if (!el) return;

  el.addEventListener("focus", () => {
    kbLockForInput();
    // 保证输入框在可视区
    setTimeout(() => {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {}
    }, 0);
  });

  el.addEventListener("blur", () => {
    setTimeout(kbUnlockForInput, 80);
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setTimeout(kbUnlockForInput, 80);
  });
}

// 初始化绑定（✅ 必须 DOMReady 后再绑，避免输入框还没渲染导致没绑定上）
function bindKbSafeInputLite(selector) {
  const el = document.querySelector(selector);
  if (!el) return;

  // ✅ 只更新 --vvh，不锁 body（Safari 顶部固定搜索栏最容易被 lock 搞丢焦点）
  el.addEventListener("focus", () => {
    kbSetVvh();
  });

  el.addEventListener("blur", () => {
    // 轻微延迟，避免 iOS blur/focus 抖动
    setTimeout(() => {
      document.documentElement.style.removeProperty("--vvh");
    }, 120);
  });
}

// 初始化绑定（✅ 必须 DOMReady 后再绑）
function bindKbInputs() {
  // 🔍 顶部搜索：不要锁 body（关键修复）
  bindKbSafeInputLite("#globalSearchInput");

  // 📦 ZIP（左 / 右）：可以继续用“锁 body”方案
  bindKbSafeInput("#zipInput");
  bindKbSafeInput("#zipInputRight");

  // 键盘高度变化时实时更新
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", () => {
      if (__kbLocked) kbSetVvh();
    });
    vv.addEventListener("scroll", () => {
      if (__kbLocked) kbSetVvh();
    });
  }
}
// ✅ DOM 完成后再绑定（最关键）
window.addEventListener("DOMContentLoaded", bindKbInputs);

// ✅ 兜底：如果脚本本来就在 body 最后加载，也允许立刻绑定一次
try { bindKbInputs(); } catch {}
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
function getToken() {
  return window.Auth?.getToken ? window.Auth.getToken() : (localStorage.getItem("freshbuy_token") || "");
}

async function apiGetDefaultAddress() {
  // 推荐：auth_client.js 统一实现这个函数并挂到 window.Auth
  if (window.Auth?.getDefaultAddress) return window.Auth.getDefaultAddress();

  // 兜底：如果你暂时还没在 auth_client.js 做，就用这里的最小 fallback（后面可删）
  const tk = getToken();
  if (!tk) return null;

  const r = await fetch("/api/addresses/my.defaultAddress", {
    headers: { Authorization: "Bearer " + tk },
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  return j?.success ? j.address : (j?.defaultAddress || null);
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
  if (cartMode === "pickup") return "pickup";
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
async function applyZoneToUI(zip, payload) {
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

 const briefZone = {
  id: zone.id || zone._id || "",
  name: zone.name || "",
  deliveryDays: Array.isArray(zone.deliveryDays) ? zone.deliveryDays : [],
  deliveryModes: Array.isArray(zone.deliveryModes) ? zone.deliveryModes : [],
  cutoffTime: zone.cutoffTime || "",
};
saveZone(briefZone);
  localStorage.setItem("freshbuy_zone_ok", "1");
// ✅ 拉取“真实+虚假”拼单数据，更新显示
try {
  const stats = await fetchAreaGroupStats(zip);
  if (stats) {
    deliveryStats["area-group"].joinedOrders = Number(stats.joinedOrders || 0);
    deliveryStats["area-group"].needOrders = Number(stats.needOrders || 50);
    deliveryStats["area-group"].realJoined = Number(stats.realJoined || 0);
    deliveryStats["area-group"].fakeJoined = Number(stats.fakeJoined || 0);
  }
} catch {}
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
async function fetchAreaGroupStats(zip) {
  const z = String(zip || "").trim();
  if (!/^\d{5}$/.test(z)) return null;

  try {
    const r = await fetch(`/api/public/zones/group-stats?zip=${encodeURIComponent(z)}&ts=${Date.now()}`, {
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.success || !j?.supported || !j?.stats) return null;
    return j.stats; // {realJoined,fakeJoined,joinedOrders,needOrders,remain}
  } catch {
    return null;
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
// ✅ 首页横幅：从后台读取 Banner（key=homepage_main）
// 需要你的 index.html 里有：
// #homepageBanner  容器
// #bannerTitle #bannerSubtitle #bannerBtns 这些元素（下面第 6 步我给你 index.html 要加的结构）
async function loadHomepageBanner() {
  try {
    const API_BASE =
      window.API_BASE ||
      localStorage.getItem("API_BASE") ||
      "";

    const r = await fetch(API_BASE + "/api/banners/homepage_main");
    const j = await r.json();

    // ✅ 没配置/接口失败/禁用 => 直接隐藏 banner（避免显示前台写死内容）
if (!j || j.success !== true || !j.banner) {
  const box = document.getElementById("homepageBanner");
  if (box) box.style.display = "none";
  return;
}

    const b = j.banner;

    const box = document.getElementById("homepageBanner");
    if (box) {
      box.style.background = b.bgColor || "#22c55e";
      if (b.imageUrl) {
        box.style.backgroundImage = `linear-gradient(rgba(0,0,0,.08), rgba(0,0,0,.08)), url(${b.imageUrl})`;
        box.style.backgroundSize = "cover";
        box.style.backgroundPosition = "center";
      } else {
        box.style.backgroundImage = "";
      }
    }

    const t = document.getElementById("bannerTitle");
    const s = document.getElementById("bannerSubtitle");
    if (t) t.textContent = b.title || "";
    if (s) s.textContent = b.subtitle || "";

    const btns = Array.isArray(b.buttons) ? b.buttons : [];
    const wrap = document.getElementById("bannerBtns");
    if (wrap) {
      wrap.innerHTML = btns
        .filter((x) => x && x.label)
        .slice(0, 10)
        .map(
          (x) =>
            `<a class="banner-chip" href="${x.link || "#"}">${x.label}</a>`
        )
        .join("");
    }
  } catch (e) {
    // 安静失败：不影响首页
    console.warn("loadHomepageBanner failed:", e);
  }
}
// =====================================================
// ✅ TOP-RIGHT AUTH UI 兜底（防止 applyLoggedOutUI / applyLoggedInUI 未定义导致整页 JS 崩）
// 放在 initTopRightAuthUI() 之前
// =====================================================
if (typeof window.applyLoggedOutUI !== "function") {
  window.applyLoggedOutUI = function () {
    try {
      // 常见：登录/注册按钮（按你页面实际 id 调整）
      const btnLogin = document.getElementById("btnLogin") || document.getElementById("loginBtn");
      const btnRegister = document.getElementById("btnRegister") || document.getElementById("registerBtn");

      // 常见：右上角用户入口
      const userProfile = document.getElementById("userProfile");

      if (btnLogin) btnLogin.style.display = "";
      if (btnRegister) btnRegister.style.display = "";
      if (userProfile) userProfile.style.display = "none";
    } catch (e) {
      console.warn("applyLoggedOutUI fallback failed:", e);
    }
  };
}

if (typeof window.applyLoggedInUI !== "function") {
  window.applyLoggedInUI = function (phone) {
    try {
      const btnLogin = document.getElementById("btnLogin") || document.getElementById("loginBtn");
      const btnRegister = document.getElementById("btnRegister") || document.getElementById("registerBtn");
      const userProfile = document.getElementById("userProfile");

      if (btnLogin) btnLogin.style.display = "none";
      if (btnRegister) btnRegister.style.display = "none";

      if (userProfile) {
        userProfile.style.display = "";
        // 可选：显示尾号
        const tail = String(phone || "").slice(-4);
        userProfile.textContent = tail ? `我 · 尾号${tail}` : "我的";
      }
    } catch (e) {
      console.warn("applyLoggedInUI fallback failed:", e);
    }
  };
}
async function initTopRightAuthUI() {
  try {
    const me = await (window.Auth?.me ? window.Auth.me() : null);

    if (me && me.phone) {
      // ✅ 如果全局有函数就用，没有就降级
      if (typeof window.applyLoggedInUI === "function") window.applyLoggedInUI(me.phone);
      else {
        const up = document.getElementById("userProfile");
        if (up) {
          up.style.display = "inline-flex";
          up.textContent = "我 / " + String(me.phone).slice(-4);
        }
        const btnLogin = document.getElementById("btnLogin");
        const btnRegister = document.getElementById("btnRegister");
        if (btnLogin) btnLogin.style.display = "none";
        if (btnRegister) btnRegister.style.display = "none";
      }
    } else {
      if (typeof window.applyLoggedOutUI === "function") window.applyLoggedOutUI();
      else {
        const btnLogin = document.getElementById("btnLogin");
        const btnRegister = document.getElementById("btnRegister");
        if (btnLogin) btnLogin.style.display = "";
        if (btnRegister) btnRegister.style.display = "";
        const up = document.getElementById("userProfile");
        if (up) up.style.display = "none";
      }
    }

    return me || null;
  } catch (e) {
    // ✅ 出错也不要炸页面
    const btnLogin = document.getElementById("btnLogin");
    const btnRegister = document.getElementById("btnRegister");
    if (btnLogin) btnLogin.style.display = "";
    if (btnRegister) btnRegister.style.display = "";
    const up = document.getElementById("userProfile");
    if (up) up.style.display = "none";
    return null;
  }
}
/* ====== 下一段从：页面最终初始化（DOMContentLoaded 主入口）开始 ====== */
// =========================
// 4) 页面完成后初始化（主入口）
// =========================
window.addEventListener("DOMContentLoaded", async () => {
  loadHomepageBanner();
  loadCategories();
  await loadHomeProductsFromSimple();
  bindGlobalSearch();
  await initTopRightAuthUI();
  await applyZipFromDefaultAddressIfLoggedIn();

  // ✅ FIX：只用 window.FreshCart，避免 ReferenceError: FreshCart is not defined
  if (window.FreshCart && typeof window.FreshCart.initCartUI === "function") {
  window.FreshCart.initCartUI(cartConfig);
} else {
  console.warn("❌ FreshCart 未就绪：请确认 index.html 先加载 cart.js 再加载 index.js");
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
    // 🚫 暂时隐藏/禁用：好友拼单按钮
  const fg = document.querySelector('.delivery-pill[data-mode="friend-group"]');
  if (fg) {
    fg.style.display = "none"; // 或者 fg.disabled = true; 取决于你用的元素类型
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
  if (!input) return;

  console.log("✅ 搜索栏已绑定");

  // 👉 进入搜索模式
  input.addEventListener("focus", () => {
    document.body.classList.add("search-active");
  });

  // 👉 退出搜索模式
  input.addEventListener("blur", () => {
    // 给一点延迟，避免点结果瞬间闪
    setTimeout(() => {
      if (!input.value.trim()) {
        document.body.classList.remove("search-active");
      }
    }, 120);
  });

  // Enter 搜索
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(input.value);
    }
  });

  // 清空时恢复
  input.addEventListener("input", () => {
    if (!input.value.trim()) {
      doSearch("");
    }
  });
}
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
  if (!addBtn && !overlayAddBtn && !minusBtn && !plusBtn) return;
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
    // ✅ 立即渲染（不依赖 getCartQty 立刻读到）
function renderActionInstant(nextQty) {
  const qtyRow = card.querySelector("[data-qty-row]");
  const addBtn2 = card.querySelector(".product-add-fixed[data-add-only]");
  const qtyDisplay = card.querySelector("[data-qty-display]");

  if (addBtn2) addBtn2.style.display = nextQty <= 0 ? "" : "none";
  if (qtyRow) qtyRow.style.display = nextQty > 0 ? "flex" : "none";
  if (qtyDisplay) qtyDisplay.textContent = String(Math.max(1, nextQty || 1));

  // 徽章立刻同步一下
  try { setProductBadge(pid, nextQty); } catch {}
}
  // 点击“加入购物车” => qty 变成 1
  if (addBtn) {
  if (cap <= 0) return;

  const next = 1;
  const ok = setCartQty(pid, 1, normalizedItem);
if (!ok) return;

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

  try { window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } })); } catch {}

  renderActionInstant(next);
  scheduleBadgeSync();
  return;
}
  // 点击 -
  if (minusBtn) {
  const next = Math.max(0, cur - 1);
  setCartQty(pid, next, normalizedItem);

  try { window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: -1 } })); } catch {}

  renderActionInstant(next);
  scheduleBadgeSync();
  return;
}
  // 点击 +
 if (plusBtn) {
  if (cap <= 0) return;

  const next = Math.min(cap, cur + 1);
  setCartQty(pid, next, normalizedItem);

  try { window.dispatchEvent(new CustomEvent("freshbuy:cartUpdated", { detail: { pid, delta: 1 } })); } catch {}

  renderActionInstant(next);
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
// ================================
// ✅ 绑定登录注册按钮
// ================================
document.addEventListener("DOMContentLoaded", () => {
  const btnLogin = document.getElementById("btnLogin");
  const btnRegister = document.getElementById("btnRegister");

  if (btnLogin) {
    btnLogin.addEventListener("click", () => {
      if (window.Auth?.openLoginModal) {
        window.Auth.openLoginModal();
      } else {
        window.location.href = "/user/login.html";
      }
    });
  }

  if (btnRegister) {
    btnRegister.addEventListener("click", () => {
      if (window.Auth?.openRegisterModal) {
        window.Auth.openRegisterModal();
      } else {
        window.location.href = "/user/register.html";
      }
    });
  }
});