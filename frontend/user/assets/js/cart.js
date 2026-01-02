// assets/js/cart.js
// ======================================================
// 通用购物车逻辑（DB zones + 配送模式偏好版）
//
// ✅ 修复：点选“次日配送”后运费不刷新（全站监听 deliveryMode radio + Cart.recalc）
// ✅ 规则：只要购物车含【爆品】(含爆品/混合) → 强制【区域团 groupDay】；不允许选 次日配送/好友拼单（UI 禁用）
// ✅ 运费：纯爆品 groupDay 且免运费；爆品+正常 按区域团门槛（>=49.99免，否则4.99）
// ✅ 修复：结算一直提示“请先保存默认收货地址” —— 优先从 /api/addresses/my 找 isDefault 地址
// ✅ 修复：结算页金额区（配送费/总计）不更新 —— 新增 checkout 金额 DOM 同步（支持 id + data-cart-*）
// ✅ 新增：taxable 字段写入/读取（用于后续 NY 税计算）
//
// 说明：
// - 购物车页：用 data-cart-subtotal / data-cart-shipping / data-cart-total
// - 顶部抽屉：用 FreshCart.initCartUI(config) 的 id
// - 结算页：支持以下任意一种：
//   A) 继续用 data-cart-*（同购物车页）
//   B) 或者用 id：checkoutSubtotal / checkoutShipping / checkoutTotal（如果你有这几个 id 会自动更新）
// ======================================================

console.log("✅ cart.js loaded on", location.pathname);

(function () {
  console.log("✅ Freshbuy cart.js loaded (db-zones + pref-mode)");

  // ==============================
  // 1. 默认 Zone & 常量
  // ==============================

  const DEFAULT_ZONE = {
    id: "zone_freshmeadows",
    name: "Fresh Meadows",
    enabled: true,

    normal: {
      enabled: true,
      deliveryTime: "次日 17:00-21:00",
      shippingFee: 4.99,
      minAmount: 49.99,
      note: "次日配送需满 $49.99，运费 $4.99",
    },

    dealsDay: {
      enabled: true,
      weekday: 5,
      deliveryTime: "周五 17:00-21:00",
      shippingFee: 0,
      minAmount: 0,
      note: "仅限爆品商品，本单免运费",
    },

    groupDay: {
      enabled: true,
      weekday: 5,
      deliveryTime: "周五 17:00-21:00",
      freeThreshold: 49.99,
      shippingFee: 4.99,
      note: "区域团购：满 $49.99 免运费，未满收取 $4.99 运费",
    },

    friendGroup: {
      enabled: true,
      minAmount: 29,
      shippingFee: 4.99,
      note: "好友拼单：分享链接一起下单，系统将按参与人数平摊运费",
    },
  };

  const EPSILON = 0.01;
  const STORAGE_KEY = "fresh_cart_v1";

  const ZONE_LS_KEY = "freshbuy_zone";
  const PREF_MODE_KEY = "freshbuy_pref_mode";

  // ==============================
  // 2. 状态
  // ==============================

  const cartState = {
    items: [], // [{ product, qty }]
    mode: "groupDay",
    zone: DEFAULT_ZONE,
    mixedTipShown: false,
  };

  let headerUIConfig = null;

  // ==============================
  // 3. 小工具
  // ==============================

  function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function isDealProduct(product) {
    if (!product) return false;

    if (
      product.isDeal === true ||
      product.isDeal === "true" ||
      product.isSpecial === true ||
      product.isSpecial === "true" ||
      product.isHot === true ||
      product.isHot === "true"
    ) {
      return true;
    }

    if (typeof product.tag === "string" && product.tag.includes("爆品")) return true;
    if (typeof product.type === "string" && product.type.toLowerCase() === "hot") return true;

    return false;
  }

  function isPureDeals(items) {
    if (!items.length) return false;
    return items.every(({ product }) => isDealProduct(product));
  }

  function analyzeCartItems(items) {
    let hasDeal = false;
    let hasNonDeal = false;

    items.forEach(({ product }) => {
      if (!product) return;
      if (isDealProduct(product)) hasDeal = true;
      else hasNonDeal = true;
    });

    return { hasDeal, hasNonDeal };
  }

  function calcCartSubtotal(items) {
    return items.reduce((sum, { product, qty }) => {
      if (!product) return sum;
      const price = Number(product.price ?? product.priceNum ?? 0);
      return sum + price * qty;
    }, 0);
  }

  function getCartItemCount() {
    return cartState.items.reduce((sum, it) => sum + (it.qty || 0), 0);
  }

  // ✅ 图片字段统一入口
  function getProductImageUrl(product, index = 0) {
    const raw =
      (product?.imageUrl && String(product.imageUrl).trim()) ||
      (product?.image && String(product.image).trim()) ||
      (product?.img && String(product.img).trim()) ||
      "";

    if (!raw) {
      return (
        "https://picsum.photos/seed/" +
        encodeURIComponent(product?.id || product?._id || ("x" + index)) +
        "/160/160"
      );
    }

    if (/^https?:\/\//i.test(raw)) return raw;

    if (/^[a-zA-Z]:\\/.test(raw)) {
      return (
        "https://picsum.photos/seed/" +
        encodeURIComponent(product?.id || product?._id || ("x" + index)) +
        "/160/160"
      );
    }

    if (raw.startsWith("/")) return location.origin + raw;
    if (raw.startsWith("uploads/")) return location.origin + "/" + raw;

    return raw;
  }

  // ---------- ✅ mode 归一 ----------
  function normalizeModeInput(v) {
    const s = String(v || "").trim();

    if (s === "area-group") return "groupDay";
    if (s === "next-day") return "normal";
    if (s === "friend-group") return "friendGroup";

    if (s === "groupDay" || s === "normal" || s === "friendGroup") return s;
    return "";
  }

  function getPreferredMode() {
    const raw = localStorage.getItem(PREF_MODE_KEY) || "";
    const v = normalizeModeInput(raw);
    return v || "";
  }

  function setPreferredMode(mode, options = {}) {
    const { silent = false } = options;
    const v = normalizeModeInput(mode);
    if (!v) return false;

    try {
      const old = localStorage.getItem(PREF_MODE_KEY) || "";
      if (normalizeModeInput(old) === v && silent) return true;
      localStorage.setItem(PREF_MODE_KEY, v);
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: v } }));
    } catch {}

    return true;
  }

  function normalizeZone(z) {
    if (!z || typeof z !== "object") return DEFAULT_ZONE;

    const merged = {
      ...DEFAULT_ZONE,
      ...z,
      normal: { ...DEFAULT_ZONE.normal, ...(z.normal || {}) },
      dealsDay: { ...DEFAULT_ZONE.dealsDay, ...(z.dealsDay || {}) },
      groupDay: { ...DEFAULT_ZONE.groupDay, ...(z.groupDay || {}) },
      friendGroup: { ...DEFAULT_ZONE.friendGroup, ...(z.friendGroup || {}) },
    };

    const w = merged.groupDay?.weekday;
    if (typeof w === "string" && /^\d+$/.test(w)) merged.groupDay.weekday = Number(w);

    return merged;
  }

  function loadZoneFromStorage() {
    try {
      const raw = localStorage.getItem(ZONE_LS_KEY);
      if (!raw) return;
      const z = JSON.parse(raw);
      if (z && z.id) cartState.zone = normalizeZone(z);
    } catch {}
  }

  function saveZoneToStorage(zoneObj) {
    try {
      localStorage.setItem(ZONE_LS_KEY, JSON.stringify(zoneObj || {}));
    } catch {}
  }

  // ==============================
  // 4. localStorage（购物车）
  // ==============================

  function loadCartFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return;

      cartState.items = data.items.map((it) => {
        const p = { ...(it.product || {}) };

        // ✅ 关键：这里加 taxable / isDeal 归一
        p.taxable = !!p.taxable;
        p.isDeal = isDealProduct(p);

        return { product: p, qty: Number(it.qty) || 1 };
      });

      cartState.mode = data.mode || "groupDay";
      cartState.mixedTipShown = false;
    } catch (err) {
      console.warn("加载购物车本地存储失败:", err);
    }
  }

  function saveCartToStorage() {
    try {
      const data = {
        items: cartState.items.map(({ product, qty }) => ({
          product: {
            id: product.id,
            name: product.name,
            price: product.price,
            priceNum: product.priceNum,
            tag: product.tag,
            type: product.type,
            taxable: !!product.taxable, // ✅ 保存 taxable
            isDeal: isDealProduct(product),
            isSpecial: product.isSpecial,
            imageUrl: product.imageUrl || product.image || product.img || "",
          },
          qty,
        })),
        mode: cartState.mode,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("保存购物车到本地存储失败:", err);
    }
  }

  // ==============================
  // 5. 运费规则（核心）
  // ==============================

  function getCurrentShippingRule() {
    const zone = cartState.zone || DEFAULT_ZONE;
    const subtotal = calcCartSubtotal(cartState.items);

    if (!cartState.items.length) {
      return { rule: null, subtotal, shippingFee: 0, meetMin: true };
    }

    const { hasDeal, hasNonDeal } = analyzeCartItems(cartState.items);

    // 1) 纯爆品 → 强制区域团（但免运费）
    if (hasDeal && !hasNonDeal && zone.groupDay?.enabled) {
      cartState.mode = "groupDay";

      const freeTh = safeNum(zone.groupDay?.freeThreshold, 49.99);
      const baseFee = safeNum(zone.groupDay?.shippingFee, 4.99);

      const shippingFee = 0;

      const rule = {
        mode: "groupDay",
        deliveryTime: zone.groupDay?.deliveryTime,
        weekday: zone.groupDay?.weekday,
        freeThreshold: freeTh,
        shippingBaseFee: baseFee,
        shippingFee,
        note: "纯爆品订单：仅支持区域团配送，本单免运费。",
      };

      return { rule, subtotal, shippingFee, meetMin: true };
    }

    // 2) 含爆品（混合） → 强制区域团
    if (hasDeal && hasNonDeal && zone.groupDay?.enabled) {
      cartState.mode = "groupDay";

      const freeTh = safeNum(zone.groupDay?.freeThreshold, 49.99);
      const baseFee = safeNum(zone.groupDay?.shippingFee, 4.99);
      const free = subtotal + EPSILON >= freeTh;
      const shippingFee = free ? 0 : baseFee;

      const rule = {
        mode: "groupDay",
        deliveryTime: zone.groupDay?.deliveryTime,
        weekday: zone.groupDay?.weekday,
        freeThreshold: freeTh,
        shippingBaseFee: baseFee,
        shippingFee,
        note:
          zone.groupDay?.note ||
          `区域团购：满 $${freeTh.toFixed(2)} 免运费，未满收取 $${baseFee.toFixed(2)} 运费`,
      };

      return { rule, subtotal, shippingFee, meetMin: true };
    }

    // 3) 只有非爆品 → 默认区域团，但可按偏好切 normal / friendGroup
    const pref = getPreferredMode();
    const targetMode = pref || "groupDay";

    if (targetMode === "friendGroup" && zone.friendGroup?.enabled) {
      cartState.mode = "friendGroup";
      const min = safeNum(zone.friendGroup?.minAmount, 29);
      const shippingFee = safeNum(zone.friendGroup?.shippingFee, 4.99);
      const meetMin = subtotal + EPSILON >= min;

      const rule = {
        ...zone.friendGroup,
        mode: "friendGroup",
        minAmount: min,
        shippingFee,
        note: zone.friendGroup?.note || "好友拼单：分享链接一起下单，系统将按人数平摊运费",
      };
      return { rule, subtotal, shippingFee, meetMin };
    }

    if (targetMode === "normal" && zone.normal?.enabled) {
      cartState.mode = "normal";
      const min = safeNum(zone.normal?.minAmount, 49.99);
      const shippingFee = safeNum(zone.normal?.shippingFee, 4.99);
      const meetMin = subtotal + EPSILON >= min;

      const rule = { ...zone.normal, mode: "normal", minAmount: min, shippingFee };
      return { rule, subtotal, shippingFee, meetMin };
    }

    // fallback：区域团
    if (zone.groupDay?.enabled) {
      cartState.mode = "groupDay";

      const freeTh = safeNum(zone.groupDay?.freeThreshold, 49.99);
      const baseFee = safeNum(zone.groupDay?.shippingFee, 4.99);
      const free = subtotal + EPSILON >= freeTh;
      const shippingFee = free ? 0 : baseFee;

      const rule = {
        mode: "groupDay",
        deliveryTime: zone.groupDay?.deliveryTime,
        weekday: zone.groupDay?.weekday,
        freeThreshold: freeTh,
        shippingBaseFee: baseFee,
        shippingFee,
        note:
          zone.groupDay?.note ||
          `区域团购：满 $${freeTh.toFixed(2)} 免运费，未满收取 $${baseFee.toFixed(2)} 运费`,
      };

      return { rule, subtotal, shippingFee, meetMin: true };
    }

    return { rule: null, subtotal, shippingFee: 0, meetMin: true };
  }

  // ==============================
  // 6. 混合弹窗提示
  // ==============================

  function showMixedTipModal(currentAmount, freeThreshold, baseFee) {
    const meetFree = currentAmount + EPSILON >= freeThreshold;
    const diff = meetFree ? 0 : (freeThreshold - currentAmount).toFixed(2);

    const lines = [
      "已在爆品购物车中添加普通商品，本单将按照【区域团购】规则结算。",
      "",
      "区域团规则：",
      `· 爆品 + 普通商品一起下单，满 $${freeThreshold.toFixed(2)} 免运费；`,
      `· 未满则收取 $${baseFee.toFixed(2)} 运费。`,
      "",
      `当前金额：$${currentAmount.toFixed(2)}`,
    ];

    if (!meetFree) lines.push(`再加 $${diff} 即可免运费。`);
    else lines.push("当前金额已满足免运费条件。");

    alert(lines.join("\n"));
  }

  // ==============================
  // 7. 角标/抖动
  // ==============================

  function updateCartBadge() {
    const count = getCartItemCount();

    const counters = document.querySelectorAll("[data-cart-count]");
    counters.forEach((el) => {
      el.textContent = count;
      el.style.display = count > 0 ? "inline-flex" : "none";
    });

    const idCounter = document.getElementById("cartCount");
    if (idCounter) {
      idCounter.textContent = count;
      idCounter.style.display = count > 0 ? "inline-flex" : "none";
    }

    const icon =
      document.querySelector("[data-cart-icon]") ||
      document.querySelector(".cart-icon") ||
      document.getElementById("cartIcon");
    if (icon && count > 0) {
      icon.classList.add("cart-shake");
      setTimeout(() => icon.classList.remove("cart-shake"), 500);
    }
  }

  // ==============================
  // 8. 购物车页渲染（data-cart-*）
  // ==============================

  function renderCartItemsPage() {
    const listEl = document.querySelector("[data-cart-items]");
    if (!listEl) return;

    if (!cartState.items.length) {
      listEl.innerHTML = `<div class="cart-empty">购物车空空如也～</div>`;
      return;
    }

    listEl.innerHTML = cartState.items
      .map(({ product, qty }, index) => {
        const price = safeNum(product.price ?? product.priceNum, 0).toFixed(2);
        const imgUrl = getProductImageUrl(product, index);
        const fallback =
          "https://picsum.photos/seed/" +
          encodeURIComponent(product?.id || product?._id || ("x" + index)) +
          "/160/160";

        const isDealTag = isDealProduct(product)
          ? `<span class="cart-tag cart-tag-deal">爆品</span>`
          : "";

        return `
          <div class="cart-item" data-id="${product.id}">
            <div class="cart-item-left" style="display:flex;gap:12px;align-items:center;">
              <div class="cart-thumb" style="width:64px;height:64px;border-radius:12px;overflow:hidden;background:#f3f4f6;flex:0 0 auto;">
                <img
                  src="${imgUrl}"
                  alt="${String(product.name || "").replace(/"/g, "&quot;")}"
                  style="width:100%;height:100%;object-fit:cover;display:block;"
                  onerror="this.onerror=null;this.src='${fallback}';"
                />
              </div>

              <div class="cart-item-main" style="flex:1;min-width:0;">
                <div class="cart-item-title" style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${product.name || "未命名商品"} ${isDealTag}
                </div>
                <div class="cart-item-price" style="color:#16a34a;font-weight:800;margin-top:4px;">
                  $${price}
                </div>
                <div class="cart-item-sku" style="color:#6b7280;font-size:12px;margin-top:4px;">
                  商品编号：${product.id || "--"}
                </div>
              </div>
            </div>

            <div class="cart-item-actions">
              <button class="cart-btn-minus" data-id="${product.id}">-</button>
              <span class="cart-item-qty">${qty}</span>
              <button class="cart-btn-plus" data-id="${product.id}">+</button>
              <button class="cart-btn-remove" data-id="${product.id}">删除</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderCartSummaryPage() {
    const subtotalEl = document.querySelector("[data-cart-subtotal]");
    const shippingEl = document.querySelector("[data-cart-shipping]");
    const totalEl = document.querySelector("[data-cart-total]");
    const modeBadgeEl = document.querySelector("[data-cart-mode-badge]");
    const tipEl = document.querySelector("[data-cart-tip]");
    const checkoutBtn = document.querySelector("[data-cart-checkout-btn]");

    const { rule, subtotal, shippingFee, meetMin } = getCurrentShippingRule();
    const total = subtotal + (rule ? shippingFee : 0);

    if (subtotalEl) subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
    if (shippingEl) shippingEl.textContent = rule ? `$${shippingFee.toFixed(2)}` : "--";
    if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;

    if (modeBadgeEl) {
      let text = "";
      if (cartState.mode === "groupDay")
        text = `区域团购配送（${cartState.zone?.name || "当前区域"}）`;
      else if (cartState.mode === "normal") text = "次日配送";
      else if (cartState.mode === "friendGroup") text = "好友拼单配送";
      else text = cartState.mode || "";
      modeBadgeEl.textContent = text;
    }

    if (tipEl) {
      if (!rule) {
        tipEl.textContent = "";
      } else if (rule.mode === "groupDay") {
        const { hasDeal, hasNonDeal } = analyzeCartItems(cartState.items);
        const isPureDealOrder = hasDeal && !hasNonDeal;

        const th = safeNum(rule.freeThreshold, 49.99);
        const base = safeNum(rule.shippingBaseFee ?? rule.shippingFee, 4.99);

        if (shippingFee === 0) {
          tipEl.textContent = isPureDealOrder
            ? "纯爆品订单：仅支持区域团配送，本单免运费。"
            : `已满 $${th.toFixed(2)}，本单按【区域团购】免运费`;
        } else {
          const diff = Math.max(0, th - subtotal).toFixed(2);
          tipEl.textContent = `区域团购：再加 $${diff} 即可免运费（当前运费 $${base.toFixed(2)}）`;
        }
      } else if (rule.mode === "normal") {
        const min = safeNum(rule.minAmount, 49.99);
        if (!meetMin) {
          const diff = Math.max(0, min - subtotal).toFixed(2);
          tipEl.textContent = `次日配送需满 $${min.toFixed(2)} 才可下单，还差 $${diff}`;
        } else {
          tipEl.textContent = rule.note || "";
        }
      } else if (rule.mode === "friendGroup") {
        const min = safeNum(rule.minAmount, 29);
        if (!meetMin) {
          const diff = Math.max(0, min - subtotal).toFixed(2);
          tipEl.textContent = `好友拼单最低 $${min.toFixed(2)} 才可下单，还差 $${diff}`;
        } else {
          tipEl.textContent = rule.note || "";
        }
      } else {
        tipEl.textContent = rule.note || "";
      }
    }

    if (checkoutBtn) {
      let canCheckout = false;
      if (!cartState.items.length) canCheckout = false;
      else if (cartState.mode === "normal" || cartState.mode === "friendGroup")
        canCheckout = !!meetMin;
      else canCheckout = true;

      checkoutBtn.disabled = !canCheckout;
      checkoutBtn.classList.toggle("btn-disabled", !canCheckout);
    }
  }

  // ==============================
  // ✅ 8.5 结算页金额区同步
  // ==============================

  function setTextBySelector(sel, text) {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  }

  function renderCheckoutPricing() {
    const { rule, subtotal, shippingFee } = getCurrentShippingRule();
    const total = subtotal + (rule ? shippingFee : 0);

    setTextBySelector("[data-cart-subtotal]", `$${subtotal.toFixed(2)}`);
    setTextBySelector("[data-cart-shipping]", rule ? `$${shippingFee.toFixed(2)}` : "--");
    setTextBySelector("[data-cart-total]", `$${total.toFixed(2)}`);

    setTextBySelector("#checkoutSubtotal", `$${subtotal.toFixed(2)}`);
    setTextBySelector("#checkoutShipping", rule ? `$${shippingFee.toFixed(2)}` : "--");
    setTextBySelector("#checkoutTotal", `$${total.toFixed(2)}`);

    setTextBySelector("#paySubtotal", `$${subtotal.toFixed(2)}`);
    setTextBySelector("#payShipping", rule ? `$${shippingFee.toFixed(2)}` : "--");
    setTextBySelector("#payTotal", `$${total.toFixed(2)}`);
  }

  // ==============================
  // 9. 结算（下单）
  // ==============================

  function getAuthToken() {
  return (
    localStorage.getItem("freshbuy_token") ||
    localStorage.getItem("jwt") ||          // ✅ 补上
    localStorage.getItem("token") ||
    localStorage.getItem("auth_token") ||
    ""
  );
}
  function pickDefaultAddressFromList(list) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return null;
    const a = arr.find((x) => x && x.isDefault) || arr[0];
    if (!a) return null;

    const fullName = `${a.firstName || ""} ${a.lastName || ""}`.trim();

    return {
      fullName: fullName || "",
      phone: a.phone || "",
      zip: a.zip || "",
      address1: a.street1 || "",
      address2: a.apt || "",
      city: a.city || "",
      state: a.state || "",
      placeId: a.placeId || "",
      lat: typeof a.lat === "number" ? a.lat : a.lat != null ? Number(a.lat) : null,
      lng: typeof a.lng === "number" ? a.lng : a.lng != null ? Number(a.lng) : null,
    };
  }

  async function getDefaultShipping() {
    const token = getAuthToken();

    if (token) {
      try {
        const r = await fetch("/api/addresses/my", {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));

        const list = j.addresses || j.list || j.items || j.data?.addresses || j.data || [];
        const shipping = pickDefaultAddressFromList(list);
        if (shipping) return shipping;
      } catch (e) {
        console.warn("getDefaultShipping: /api/addresses/my failed:", e);
      }
    }

    if (token) {
      try {
        const r = await fetch("/api/auth/me", {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        const u = j?.user;
        const addr = u?.defaultAddress || u?.profile?.defaultAddress || null;

        if (u && addr) {
          return {
            fullName: addr.fullName || u.name || "",
            phone: addr.phone || u.phone || "",
            zip: addr.zip || "",
            address1: addr.address1 || "",
            address2: addr.address2 || "",
            city: addr.city || "",
            state: addr.state || "",
          };
        }
      } catch (e) {
        console.warn("getDefaultShipping: /api/auth/me failed:", e);
      }
    }

    try {
      return JSON.parse(localStorage.getItem("freshbuy_default_address") || "null");
    } catch {
      return null;
    }
  }

  function isValidShipping(s) {
    if (!s) return false;
    const phoneDigits = String(s.phone || "").replace(/\D/g, "");
    const phoneOk = phoneDigits.length >= 10;
    const zipOk = /^\d{5}$/.test(String(s.zip || "").trim());
    const addrOk = String(s.address1 || "").trim().length >= 5;
    return phoneOk && zipOk && addrOk;
  }

  function buildOrderItemsFromCart() {
    return cartState.items.map(({ product, qty }) => ({
      productId: product.id,
      name: product.name,
      price: safeNum(product.price ?? product.priceNum, 0),
      qty: Number(qty) || 1,
      tag: product.tag || "",
      type: product.type || "",
      isDeal: isDealProduct(product),
      taxable: !!product.taxable, // ✅ 订单里也带上（后续算税用）
    }));
  }

  async function quickCheckout() {
    const { rule, subtotal, shippingFee, meetMin } = getCurrentShippingRule();
    if (!rule || !cartState.items.length) return;

    if ((cartState.mode === "normal" || cartState.mode === "friendGroup") && !meetMin) {
      alert("未满足最低消费，暂无法下单");
      return;
    }

    const shipping = await getDefaultShipping();
    if (!isValidShipping(shipping)) {
      alert("请先在【个人信息】保存默认收货地址（只需一次），以后可直接结算。");
      window.location.href = "/user/user_center.html";
      return;
    }

    const payload = {
      mode: cartState.mode,
      zoneId: cartState.zone?.id || "",
      zoneName: cartState.zone?.name || "",
      rule,
      subtotal: Number(subtotal.toFixed(2)),
      shippingFee: Number(shippingFee.toFixed(2)),
      total: Number((subtotal + shippingFee).toFixed(2)),
      items: buildOrderItemsFromCart(),
      shipping,
    };

    const token = getAuthToken();
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      alert(data?.message || data?.msg || "下单失败");
      return;
    }

    Cart.clear();

    const orderId = data.orderId || data.id || data?.order?._id || "";
    window.location.href = "/user/order_success.html?id=" + encodeURIComponent(orderId);
  }

  // ==============================
  // 10. 混合规则 + 统一更新入口
  // ==============================

  function enforceModeByRules(options = {}) {
    const { fromAdd = false, addedProduct = null, wasPureDeals = false } = options;

    const zone = cartState.zone || DEFAULT_ZONE;
    const { hasDeal, hasNonDeal } = analyzeCartItems(cartState.items);

    if (hasDeal) {
      cartState.mode = "groupDay";

      if (hasNonDeal) {
        const subtotal = calcCartSubtotal(cartState.items);
        const freeTh = safeNum(zone.groupDay?.freeThreshold, 49.99);
        const baseFee = safeNum(zone.groupDay?.shippingFee, 4.99);

        if (
          fromAdd &&
          addedProduct &&
          !isDealProduct(addedProduct) &&
          wasPureDeals &&
          !cartState.mixedTipShown
        ) {
          showMixedTipModal(subtotal, freeTh, baseFee);
          cartState.mixedTipShown = true;
        }
      } else {
        cartState.mixedTipShown = false;
      }
      return;
    }

    cartState.mixedTipShown = false;

    const pref = getPreferredMode();
    const target = pref || "groupDay";

    if (target === "friendGroup" && zone.friendGroup?.enabled) cartState.mode = "friendGroup";
    else if (target === "normal" && zone.normal?.enabled) cartState.mode = "normal";
    else cartState.mode = "groupDay";
  }

  function handleCartChange(options = {}) {
    enforceModeByRules(options);

    renderCartItemsPage();
    renderCartSummaryPage();
    renderHeaderCart();
    renderCheckoutPricing();
    updateCartBadge();

    if (!options || options.skipSave !== true) {
      saveCartToStorage();
    }

    try {
      const detail = {
        items: cartState.items,
        mode: cartState.mode,
        zone: cartState.zone,
        count: getCartItemCount(),
        subtotal: calcCartSubtotal(cartState.items),
      };
      window.dispatchEvent(new CustomEvent("freshcart:updated", { detail }));
    } catch {}
  }

  // ==============================
  // 11. 绑定购物车页事件
  // ==============================
function bindCartDOMEventsPage() {
  // 1) 列表 +/- 删除
  const listEl = document.querySelector("[data-cart-items]");
  if (listEl) {
    listEl.addEventListener("click", (e) => {
      const target = e.target;
      const id = target.getAttribute("data-id");
      if (!id) return;

      if (target.classList.contains("cart-btn-plus")) {
        Cart.changeQty(id, 1);
      } else if (target.classList.contains("cart-btn-minus")) {
        Cart.changeQty(id, -1);
      } else if (target.classList.contains("cart-btn-remove")) {
        Cart.removeItem(id);
      }
    });
  }

  // 2) ✅ 去结算按钮
  const checkoutBtn =
    document.querySelector("[data-cart-checkout-btn]") ||
    document.getElementById("btnCheckout");

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", (e) => {
      e.preventDefault();

      // 如果按钮被逻辑禁用，就不处理
      if (checkoutBtn.disabled) return;

      // cart.html -> 跳到 checkout.html
      const path = String(location.pathname || "");
      const isCheckoutPage = path.includes("checkout");

      if (isCheckoutPage) {
        // 如果你结算页也复用这个按钮：直接下单
        quickCheckout();
      } else {
        window.location.href = "/user/checkout.html";
      }
    });
  }
}
  // ==============================
  // 12. 顶部抽屉渲染（header UI）
  // ==============================

  function renderHeaderCart() {
    if (!headerUIConfig) return;

    const {
      cartItemsListId,
      cartEmptyTextId,
      cartTotalItemsId,
      cartSubtotalId,
      cartShippingId,
      cartTotalId,
      toastId,
    } = headerUIConfig;

    const { rule, subtotal, shippingFee } = getCurrentShippingRule();
    const total = subtotal + (rule ? shippingFee : 0);
    const totalQty = getCartItemCount();

    if (cartItemsListId) {
      const listEl = document.getElementById(cartItemsListId);
      if (listEl) {
        if (!cartState.items.length) {
          listEl.innerHTML = "";
        } else {
          listEl.innerHTML = cartState.items
            .map(({ product, qty }) => {
              const price = safeNum(product.price ?? product.priceNum, 0).toFixed(2);
              const tag = isDealProduct(product)
                ? '<span class="cart-tag cart-tag-deal">爆品</span>'
                : "";

              return `
                <div class="cart-item-row" data-id="${product.id}">
                  <div class="cart-item-main">
                    <div class="cart-item-title">
                      ${product.name || "未命名商品"} ${tag}
                    </div>
                    <div class="cart-item-price">$${price}</div>
                  </div>
                  <div class="cart-item-actions">
                    <button class="cart-btn-minus" data-id="${product.id}">-</button>
                    <span class="cart-item-qty">${qty}</span>
                    <button class="cart-btn-plus" data-id="${product.id}">+</button>
                  </div>
                </div>
              `;
            })
            .join("");
        }
      }
    }

    if (cartEmptyTextId) {
      const el = document.getElementById(cartEmptyTextId);
      if (el) el.style.display = cartState.items.length ? "none" : "block";
    }

    if (cartTotalItemsId) {
      const el = document.getElementById(cartTotalItemsId);
      if (el) el.textContent = `${totalQty} 件商品`;
    }

    if (cartSubtotalId) {
      const el = document.getElementById(cartSubtotalId);
      if (el) el.textContent = `$${subtotal.toFixed(2)}`;
    }
    if (cartShippingId) {
      const el = document.getElementById(cartShippingId);
      if (el) el.textContent = `$${(rule ? shippingFee : 0).toFixed(2)}`;
    }
    if (cartTotalId) {
      const el = document.getElementById(cartTotalId);
      if (el) el.textContent = `$${total.toFixed(2)}`;
    }

    if (toastId) {
      const toastEl = document.getElementById(toastId);
      if (toastEl) toastEl.style.display = "none";
    }
  }

  function bindHeaderEvents() {
    if (!headerUIConfig) return;

    const { cartIconId, cartBackdropId, cartDrawerId, cartCloseBtnId, cartItemsListId, goCartBtnId, cartPageUrl } =
      headerUIConfig;

    const icon = cartIconId && document.getElementById(cartIconId);
    const drawer = cartDrawerId && document.getElementById(cartDrawerId);
    const backdrop = cartBackdropId && document.getElementById(cartBackdropId);
    const closeBtn = cartCloseBtnId && document.getElementById(cartCloseBtnId);

    function openDrawer() {
      if (drawer) drawer.classList.add("active");
      if (backdrop) backdrop.classList.add("active");
    }
    function closeDrawer() {
      if (drawer) drawer.classList.remove("active");
      if (backdrop) backdrop.classList.remove("active");
    }

    if (icon) icon.addEventListener("click", openDrawer);
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeDrawer();
      });
    }

    if (cartItemsListId) {
      const listEl = document.getElementById(cartItemsListId);
      if (listEl) {
        listEl.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const id = btn.getAttribute("data-id");
          if (!id) return;

          if (btn.classList.contains("cart-btn-plus")) Cart.changeQty(id, 1);
          else if (btn.classList.contains("cart-btn-minus")) Cart.changeQty(id, -1);
        });
      }
    }

    if (goCartBtnId) {
      const btn = document.getElementById(goCartBtnId);
      if (btn) {
        btn.addEventListener("click", () => {
          const url = cartPageUrl || "/user/cart.html";
          window.location.href = url;
        });
      }
    }
  }

  function showAddToast() {
    if (!headerUIConfig || !headerUIConfig.toastId) return;
    const toastEl = document.getElementById(headerUIConfig.toastId);
    if (!toastEl) return;
    toastEl.style.display = "block";
    toastEl.classList.add("show");
    setTimeout(() => {
      toastEl.classList.remove("show");
      toastEl.style.display = "none";
    }, 1200);
  }

  // ==============================
  // ✅ 全站监听 deliveryMode radio（任何页面都生效）
  // ==============================
  function bindGlobalDeliveryModeRadios() {
    document.addEventListener(
      "change",
      (e) => {
        const t = e.target;
        if (!t) return;
        if (t.matches && t.matches('input[name="deliveryMode"]')) {
          const v = normalizeModeInput(t.value);
          if (!v) return;

          const { hasDeal } = analyzeCartItems(cartState.items);
          if (hasDeal && v !== "groupDay") {
            setPreferredMode("groupDay");
            if (window.Cart && typeof window.Cart.recalc === "function") window.Cart.recalc();
            return;
          }

          setPreferredMode(v);
          if (window.Cart && typeof window.Cart.recalc === "function") window.Cart.recalc();
        }
      },
      true
    );
  }

  // ==============================
  // 13. Cart / FreshCart 对外
  // ==============================

  const Cart = {
    init(options = {}) {
      loadZoneFromStorage();
      if (options.zone) cartState.zone = normalizeZone(options.zone);

      loadCartFromStorage();

      handleCartChange({ fromAdd: false, skipSave: true });

      bindCartDOMEventsPage();
    },

    recalc() {
      handleCartChange({ fromAdd: false });
    },

    getPricing() {
      const { rule, subtotal, shippingFee, meetMin } = getCurrentShippingRule();
      const total = subtotal + (rule ? shippingFee : 0);
      return {
        rule,
        subtotal: Number(subtotal.toFixed(2)),
        shippingFee: Number((rule ? shippingFee : 0).toFixed(2)),
        total: Number(total.toFixed(2)),
        meetMin: !!meetMin,
        mode: cartState.mode,
        zone: cartState.zone,
      };
    },

    addItem(product, qty = 1) {
      if (!product || !product.id) return;

      const normalized = { ...product };
      normalized.taxable = !!normalized.taxable; // ✅ 保证 boolean
      normalized.isDeal = isDealProduct(normalized);

      const wasPureDealsBefore = isPureDeals(cartState.items);

      const existing = cartState.items.find((it) => it.product.id === normalized.id);
      if (existing) existing.qty += qty;
      else cartState.items.push({ product: normalized, qty });

      handleCartChange({
        fromAdd: true,
        addedProduct: normalized,
        wasPureDeals: wasPureDealsBefore,
      });
    },

    changeQty(productId, delta) {
      const item = cartState.items.find((it) => it.product.id === productId);
      if (!item) return;

      item.qty += delta;
      if (item.qty <= 0) {
        Cart.removeItem(productId);
        return;
      }
      handleCartChange({ fromAdd: false });
    },

    removeItem(productId) {
      const idx = cartState.items.findIndex((it) => it.product.id === productId);
      if (idx !== -1) {
        cartState.items.splice(idx, 1);
        handleCartChange({ fromAdd: false });
      }
    },

    clear() {
      cartState.items = [];
      cartState.mode = "groupDay";
      cartState.mixedTipShown = false;
      saveCartToStorage();
      renderCartItemsPage();
      renderCartSummaryPage();
      renderHeaderCart();
      renderCheckoutPricing();
      updateCartBadge();
    },

    setZone(zone) {
      cartState.zone = normalizeZone(zone);
      saveZoneToStorage(cartState.zone);
      handleCartChange({ fromAdd: false });
    },

    getState() {
      return {
        items: cartState.items.map((it) => ({ product: { ...it.product }, qty: it.qty })),
        mode: cartState.mode,
        zone: cartState.zone,
      };
    },

    getCount() {
      return getCartItemCount();
    },

    getSubtotal() {
      return calcCartSubtotal(cartState.items);
    },
  };

  const FreshCart = {
    initCartUI(config) {
      headerUIConfig = {
        cartIconId: config.cartIconId || "cartIcon",
        cartBackdropId: config.cartBackdropId || "cartBackdrop",
        cartDrawerId: config.cartDrawerId || "cartDrawer",
        cartCloseBtnId: config.cartCloseBtnId || "cartCloseBtn",
        cartCountId: config.cartCountId || "cartCount",
        cartTotalItemsId: config.cartTotalItemsId || "cartTotalItems",
        cartEmptyTextId: config.cartEmptyTextId || "cartEmptyText",
        cartItemsListId: config.cartItemsListId || "cartItemsList",
        toastId: config.toastId || "addCartToast",
        goCartBtnId: config.goCartBtnId || "goCartBtn",
        cartPageUrl: config.cartPageUrl || "/user/cart.html",
        cartSubtotalId: config.cartSubtotalId || "cartSubtotal",
        cartShippingId: config.cartShippingId || "cartShipping",
        cartTotalId: config.cartTotalId || "cartTotal",
      };

      renderHeaderCart();
      renderCheckoutPricing();
      updateCartBadge();
      bindHeaderEvents();
    },

    addToCartWithLimit(payload) {
      if (!payload || !payload.id) return;

      const priceNum = safeNum(payload.priceNum ?? payload.price, 0);

      const product = {
        id: payload.id,
        name: payload.name || "商品",
        price: priceNum,
        priceNum: priceNum,
        tag: payload.tag || "",
        type: payload.type || "",
        taxable: !!payload.taxable, // ✅ 从后端商品管理传过来
        isSpecial: !!payload.isSpecial,
        isDeal: !!payload.isSpecial,
        imageUrl:
          payload.imageUrl ||
          payload.image ||
          payload.img ||
          (Array.isArray(payload.images) ? payload.images[0] : "") ||
          "",
      };

      Cart.addItem(product, 1);
      showAddToast();
    },

    addItem(product, qty) {
      Cart.addItem(product, qty || 1);
    },

    changeQty: Cart.changeQty,
    removeItem: Cart.removeItem,
    clear: Cart.clear,
    recalc: Cart.recalc,
    getPricing: Cart.getPricing,
    getState: Cart.getState,
    getCount: Cart.getCount,
    getSubtotal: Cart.getSubtotal,
  };

  window.Cart = Cart;
  window.FreshCart = FreshCart;
  console.log("✅ window.FreshCart ready:", window.FreshCart);

  bindGlobalDeliveryModeRadios();

  // ==============================
  // 14. 监听 index.js 的 zone / mode 事件
  // ==============================

  window.addEventListener("freshbuy:zoneChanged", (e) => {
    const z = e?.detail?.zone;
    const zip = e?.detail?.zip;
    if (!z || !z.id) return;

    cartState.zone = normalizeZone(z);
    saveZoneToStorage(cartState.zone);

    console.log("🧭 cart.js zone updated from event:", cartState.zone?.id, zip || "");
    handleCartChange({ fromAdd: false });
  });

  window.addEventListener("freshbuy:deliveryModeChanged", (e) => {
    const modeRaw = e?.detail?.mode || "";
    const v = normalizeModeInput(modeRaw);
    if (!v) return;

    const { hasDeal } = analyzeCartItems(cartState.items);
    const fixed = hasDeal ? "groupDay" : v;

    try {
      localStorage.setItem(PREF_MODE_KEY, fixed);
    } catch {}

    handleCartChange({ fromAdd: false });
  });

  // ==============================
  // 15. 页面加载自动 init
  // ==============================

  document.addEventListener("DOMContentLoaded", () => {
    const zone = window.__CURRENT_ZONE__ || DEFAULT_ZONE;
    Cart.init({ zone });

    try {
      renderCheckoutPricing();
    } catch {}
  });
})();

// ============================
// 配送方式页：ZIP -> Zone.zipWhitelist 即时判断
// ============================
(function () {
  const API = "/api/zones/by-zip";

  const elZip = document.getElementById("zipInput");
  const btnCheck = document.getElementById("btnCheckZip");
  const elPanel = document.getElementById("zonePanel");
  const elHint = document.getElementById("zipHint");

  const btnNormal = document.getElementById("btnNormal");
  const btnFriend = document.getElementById("btnFriendGroup");
  const btnGroup = document.getElementById("btnGroupDay");

  if (!elZip || !elPanel) return;

  function normZip(v) {
    const z = String(v || "").trim();
    return /^\d{5}$/.test(z) ? z : "";
  }

  function setHint(html, ok) {
    if (!elHint) return;
    elHint.innerHTML = html;
    elHint.style.color = ok ? "#0a7a2f" : "#b00020";
  }

  function setPanel(html) {
    elPanel.innerHTML = html;
  }

  function setActiveMode(mode) {
    const v = mode === "normal" || mode === "friendGroup" || mode === "groupDay" ? mode : "groupDay";

    localStorage.setItem("freshbuy_pref_mode", v);
    window.dispatchEvent(new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: v } }));

    const on = (b) => b && (b.style.outline = "2px solid #16a34a");
    const off = (b) => b && (b.style.outline = "none");
    off(btnNormal);
    off(btnFriend);
    off(btnGroup);
    if (v === "normal") on(btnNormal);
    if (v === "friendGroup") on(btnFriend);
    if (v === "groupDay") on(btnGroup);

    if (window.Cart && typeof window.Cart.recalc === "function") window.Cart.recalc();
  }

  async function queryZone(zip) {
    const res = await fetch(`${API}?zip=${encodeURIComponent(zip)}`);
    return res.json();
  }

  function renderNotDeliverable(zip, reason) {
    setHint(`暂不支持 ZIP: <b>${zip}</b>（请换一个或先联系客服）`, false);
    setPanel(`
      <div style="font-weight:900;font-size:16px;margin-bottom:8px;">当前 ZIP 暂未开通配送</div>
      <div style="line-height:1.7;">
        你输入的 ZIP：<b>${zip}</b><br/>
        原因：${reason || "暂不支持配送"}<br/><br/>
        如需查询你所在区域什么时候开通：<br/>
        ✅ 加微信：<b>nyfreshbuy</b> 咨询
      </div>
    `);

    localStorage.setItem("freshbuy_zone_ok", "0");
    localStorage.removeItem("freshbuy_zone");
    localStorage.setItem("freshbuy_zip", zip);
  }

  function renderDeliverable(zip, zone) {
    const zoneName = zone?.name || "覆盖区域";

    setActiveMode("groupDay");

    localStorage.setItem("freshbuy_zone_ok", "1");
    localStorage.setItem("freshbuy_zip", zip);
    localStorage.setItem("freshbuy_zone", JSON.stringify(zone || {}));

    setHint(`✅ ZIP: <b>${zip}</b> 可配送（匹配区域：<b>${zoneName}</b>）`, true);

    setPanel(`
      <div style="font-weight:900;font-size:16px;margin-bottom:8px;">
        区域团拼单配送 · ${zoneName}
      </div>
      <ul style="margin:0;padding-left:18px;line-height:1.9;">
        <li>匹配 ZIP：<b>${zip}</b></li>
        <li>所属区域：<b>${zoneName}</b></li>
        <li style="color:#64748b;">默认已选择：区域团拼单配送（可在左侧切换）</li>
      </ul>
    `);
  }

  let timer = null;
  async function checkZip(silent) {
    const zip = normZip(elZip.value);
    if (!zip) {
      if (!silent) {
        setHint("请输入 5 位 ZIP（例如 11357）", false);
        setPanel(`<div style="color:#64748b;">请输入 ZIP 后将自动判断是否可配送。</div>`);
      }
      return;
    }

    let r;
    try {
      r = await queryZone(zip);
    } catch (e) {
      setHint("查询失败：网络错误", false);
      setPanel(`<div style="color:#b00020;">查询失败，请稍后再试。</div>`);
      return;
    }

    if (r?.ok !== true) {
      renderNotDeliverable(zip, r?.message || r?.reason || "查询失败");
      return;
    }

    if (r?.deliverable) renderDeliverable(zip, r.zone);
    else renderNotDeliverable(zip, r?.reason || "该邮编暂不支持配送");
  }

  elZip.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => checkZip(true), 250);
  });

  elZip.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (timer) clearTimeout(timer);
      checkZip(false);
    }
  });

  if (btnCheck) btnCheck.addEventListener("click", () => checkZip(false));

  if (btnNormal) btnNormal.onclick = () => setActiveMode("normal");
  if (btnFriend) btnFriend.onclick = () => setActiveMode("friendGroup");
  if (btnGroup) btnGroup.onclick = () => setActiveMode("groupDay");

  const lastZip = localStorage.getItem("freshbuy_zip") || "";
  if (lastZip) elZip.value = lastZip;
  checkZip(true);

  setActiveMode(localStorage.getItem("freshbuy_pref_mode") || "groupDay");
})();

// ============================
// 结算页：显示配送模式 + 可修改
// ✅ 只要含爆品：禁用 次日配送/好友拼单，并强制 groupDay
// ============================
(function () {
  const el = document.getElementById("checkoutDeliveryModeBox");
  if (!el) return;

  function normalizeMode(v) {
    const s = String(v || "").trim();
    if (s === "area-group") return "groupDay";
    if (s === "next-day") return "normal";
    if (s === "friend-group") return "friendGroup";
    if (s === "groupDay" || s === "friendGroup" || s === "normal") return s;
    return "groupDay";
  }

  function getMode() {
    return normalizeMode(localStorage.getItem("freshbuy_pref_mode") || "groupDay");
  }

  function modeLabel(m) {
    if (m === "groupDay") return "区域团拼单配送";
    if (m === "friendGroup") return "好友拼单配送";
    if (m === "normal") return "次日配送";
    return m;
  }

  function getZoneName() {
    try {
      const z = JSON.parse(localStorage.getItem("freshbuy_zone") || "null");
      return z?.name || "";
    } catch {
      return "";
    }
  }

  function cartHasDealFromStorage() {
    try {
      if (window.Cart && typeof window.Cart.getState === "function") {
        const st = window.Cart.getState();
        const items = Array.isArray(st?.items) ? st.items : [];
        return items.some((it) => {
          const p = it?.product || {};
          if (p.isDeal === true || p.isSpecial === true || p.isHot === true) return true;
          if (String(p.tag || "").includes("爆品")) return true;
          if (String(p.type || "").toLowerCase() === "hot") return true;
          return false;
        });
      }
    } catch {}

    try {
      const raw = localStorage.getItem("fresh_cart_v1");
      const data = raw ? JSON.parse(raw) : null;
      const items = Array.isArray(data?.items) ? data.items : [];
      return items.some((it) => {
        const p = it?.product || {};
        if (p.isDeal === true || p.isSpecial === true || p.isHot === true) return true;
        if (String(p.tag || "").includes("爆品")) return true;
        if (String(p.type || "").toLowerCase() === "hot") return true;
        return false;
      });
    } catch {
      return false;
    }
  }

  function render() {
    const hasDeal = cartHasDealFromStorage();

    let mode = getMode();
    if (hasDeal && mode !== "groupDay") {
      localStorage.setItem("freshbuy_pref_mode", "groupDay");
      try {
        window.dispatchEvent(
          new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: "groupDay" } })
        );
      } catch {}
      mode = "groupDay";
    }

    const zoneName = getZoneName();
    const zoneText = zoneName ? `（${zoneName}）` : "";

    el.innerHTML = `
      <div style="padding:10px;border:1px solid #e5e7eb;border-radius:12px;margin-top:10px;">
        <div style="font-weight:900;margin-bottom:8px;">
          配送方式：<span style="color:#0a7a2f;">${modeLabel(mode)} ${zoneText}</span>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label><input type="radio" name="deliveryMode" value="groupDay" ${
            mode === "groupDay" ? "checked" : ""
          }/> 区域团</label>

          <label style="opacity:${hasDeal ? 0.55 : 1}">
            <input type="radio" name="deliveryMode" value="friendGroup" ${
              mode === "friendGroup" ? "checked" : ""
            } ${hasDeal ? "disabled" : ""}/> 好友拼单
          </label>

          <label style="opacity:${hasDeal ? 0.55 : 1}">
            <input type="radio" name="deliveryMode" value="normal" ${
              mode === "normal" ? "checked" : ""
            } ${hasDeal ? "disabled" : ""}/> 次日配送
          </label>
        </div>
        ${
          hasDeal
            ? `<div style="margin-top:8px;font-size:12px;color:#64748b;">购物车包含爆品：仅支持区域团配送（纯爆免运费；爆品+正常按区域团门槛计算）。</div>`
            : ``
        }
      </div>
    `;

    el.querySelectorAll('input[name="deliveryMode"]').forEach((r) => {
      r.addEventListener("change", () => {
        const v = normalizeMode(r.value);

        const stillHasDeal = cartHasDealFromStorage();
        if (stillHasDeal && v !== "groupDay") {
          localStorage.setItem("freshbuy_pref_mode", "groupDay");
          try {
            window.dispatchEvent(
              new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: "groupDay" } })
            );
          } catch {}
          if (window.Cart && typeof window.Cart.recalc === "function") window.Cart.recalc();
          render();
          return;
        }

        localStorage.setItem("freshbuy_pref_mode", v);
        try {
          window.dispatchEvent(
            new CustomEvent("freshbuy:deliveryModeChanged", { detail: { mode: v } })
          );
        } catch {}

        if (window.Cart && typeof window.Cart.recalc === "function") window.Cart.recalc();
        render();
      });
    });
  }

  render();
  window.addEventListener("freshbuy:deliveryModeChanged", render);
  window.addEventListener("freshcart:updated", render);
})();
