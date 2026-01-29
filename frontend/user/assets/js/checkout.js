// frontend/user/assets/js/checkout.js
// 统一处理：最低消费、运费、配送方式限制 + 游客不显示地址/钱包
// ✅ FIX: 防重复加载 + checkout items productId/variantKey 拆分（库存扣减关键）
// ✅ FIX: 纯爆品订单 => mode=dealsDay（后端规则要求）
// ✅ NEW: 平台服务费 = $0.50 + 商品小计*2%
// ✅ NEW: 显示 NY Sales Tax 金额（并显示税率）
// ✅ NEW: 瓶子押金（按 item.deposit / item.bottleDeposit 累加）
// ✅ NEW: 下单 payload 带 platformFee / taxAmount / bottleDeposit / subtotal / shippingFee

(function () {
  // =========================
  // ✅ 防重复加载：避免老版本脚本仍然绑定 click 导致发错 payload
  // =========================
  if (window.__FRESHBUY_CHECKOUT_JS_LOADED__) {
    console.warn("⚠️ checkout.js already loaded, skip");
    return;
  }
  window.__FRESHBUY_CHECKOUT_JS_LOADED__ = true;

  console.log("Checkout script loaded (FULL FIXED + FEES/TAX/DEPOSIT)");

  // =========================
  // 费用/税配置
  // =========================
  const PLATFORM_FEE_FIXED = 0.5; // 每单固定 $0.50
  const PLATFORM_FEE_RATE = 0.02; // 商品小计 2%
  const NY_TAX_RATE = 0.08875; // NY 8.875%

  // =========================
  // Auth
  // =========================
  function getAnyToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("freshbuy_token") ||
      localStorage.getItem("jwt") ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("access_token") ||
      ""
    );
  }

  function getToken() {
    return getAnyToken();
  }
// ✅ checkout intentKey：同一次下单复用；下次下单才会换新
const CHECKOUT_INTENT_KEY_LS = "fb_checkout_intentKey";

function getOrCreateIntentKey() {
  let k = localStorage.getItem(CHECKOUT_INTENT_KEY_LS);
  if (!k) {
    if (window.crypto && crypto.randomUUID) k = "ik_" + crypto.randomUUID();
    else k = "ik_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    localStorage.setItem(CHECKOUT_INTENT_KEY_LS, k);
  }
  return k;
}

function clearIntentKey() {
  localStorage.removeItem(CHECKOUT_INTENT_KEY_LS);
}
  // =========================
  // ✅ API 工具
  // =========================
  async function apiFetch(url, opts = {}) {
    const token = getToken();
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {},
      token ? { Authorization: "Bearer " + token } : {}
    );

    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || ("HTTP " + res.status);
      throw new Error(msg);
    }
    return data;
  }

  // =========================
  // UI 读取
  // =========================
  function readPayMethod() {
    const el =
      document.querySelector('input[name="payMethod"]:checked') ||
      document.querySelector('input[name="paymentMethod"]:checked');
    return el ? String(el.value || "").trim() : "stripe";
  }

  function readTip() {
    const el =
      document.getElementById("tipAmount") ||
      document.getElementById("tip") ||
      document.querySelector('[name="tip"]');
    const v = el ? Number(el.value || 0) : 0;
    return Number.isFinite(v) ? v : 0;
  }

  function buildShippingPayload() {
    const firstName = (document.getElementById("firstName")?.value || "").trim();
    const lastName = (document.getElementById("lastName")?.value || "").trim();
    const phone = (document.getElementById("phone")?.value || "").trim();

    const street1 =
      (document.getElementById("street")?.value ||
        document.getElementById("street1")?.value ||
        "").trim();
    const apt = (document.getElementById("apt")?.value || "").trim();
    const city = (document.getElementById("city")?.value || "").trim();
    const state = (document.getElementById("state")?.value || "NY").trim();
    const zip = (document.getElementById("zip")?.value || "").trim();

    const lat = Number(document.getElementById("lat")?.value);
    const lng = Number(document.getElementById("lng")?.value);

    const fullText =
      (document.getElementById("addressText")?.value || "").trim() ||
      [street1, apt, city, state, zip].filter(Boolean).join(", ");

    return {
      firstName,
      lastName,
      phone,
      street1,
      apt,
      city,
      state,
      zip,
      fullText,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      note: (document.getElementById("orderNote")?.value || "").trim(),
    };
  }

  // =========================
  // 游客 UI 清理
  // =========================
  function clearCheckoutUserUI() {
    const ids = ["firstName", "lastName", "phone", "street", "apt", "city", "zip"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    const shipBox =
      document.getElementById("shippingForm") ||
      document.querySelector(".shipping-box") ||
      document.querySelector('[data-section="shipping"]') ||
      document.querySelector(".checkout-left") ||
      document.querySelector("form");

    if (shipBox) {
      shipBox
        .querySelectorAll('input[type="text"],input[type="tel"],input[type="number"]')
        .forEach((i) => {
          i.value = "";
        });
    }

    const walletEl =
      document.getElementById("walletBalance") ||
      document.getElementById("walletAmount") ||
      document.querySelector("[data-wallet-balance]");
    if (walletEl) walletEl.textContent = "--";

    const walletRadio =
      document.querySelector('input[name="payMethod"][value="wallet"]') ||
      document.querySelector('input[value="wallet"]');
    if (walletRadio) {
      walletRadio.checked = false;
      walletRadio.disabled = true;
    }
  }

  // =========================
  // 购物车 Summary（来自 cart.js）
  // =========================
  function getSummary() {
    if (!window.FreshCart) return null;
    return window.FreshCart.getSummary();
  }

  // =========================
  // ✅ 关键修复：把 "productId::variantKey" 拆开（否则后端无法识别 ObjectId，库存不扣）
  // =========================
  function normalizeCheckoutItems(items) {
    return (items || []).map((it) => {
      let raw = String(it.productId || it._id || it.id || "").trim();
      let pid = raw;
      let variantKey = String(it.variantKey || it.variant || "").trim();

      if (raw.includes("::")) {
        const parts = raw.split("::");
        pid = String(parts[0] || "").trim();
        if (!variantKey) variantKey = String(parts[1] || "").trim();
      }

      const qty = Math.max(1, Math.floor(Number(it.qty || 1)));

      return {
        ...it,
        productId: pid, // ✅ 纯 24位 ObjectId
        variantKey: variantKey || "single",
        qty,
      };
    });
  }

  // =========================
  // 配置
  // =========================
  const CONFIG = {
    minAmountNormal: 49.99,
    nextDayFee: 4.99,
    areaFee: 0,
  };

  // =========================
  // 金额工具
  // =========================
  function toMoney(n) {
    const x = Number(n || 0);
    return Number.isFinite(x) ? +x.toFixed(2) : 0;
  }

  function parseMoneyText(txt) {
    const s = String(txt || "").replace(/[^0-9.\-]/g, "");
    const v = Number(s || 0);
    return Number.isFinite(v) ? v : 0;
  }

  function calcSubtotalFromItems(items) {
    let subtotal = 0;
    for (const it of items || []) {
      const qty = Math.max(0, Number(it.qty || 0));
      // 兼容字段：finalPrice / price / unitPrice / salePrice / dealPrice...
      const priceCandidates = [
        it.finalPrice,
        it.priceFinal,
        it.unitPrice,
        it.price,
        it.salePrice,
        it.dealPrice,
        it.specialPrice,
        it.payPrice,
      ];
      let p = 0;
      for (const c of priceCandidates) {
        const v = Number(c);
        if (Number.isFinite(v) && v >= 0) {
          p = v;
          break;
        }
      }
      subtotal += p * qty;
    }
    return toMoney(subtotal);
  }

  function calcBottleDeposit(items) {
    let dep = 0;
    for (const it of items || []) {
      const qty = Math.max(0, Number(it.qty || 0));
      const d = Number(it.deposit || it.bottleDeposit || it.containerDeposit || 0);
      if (Number.isFinite(d) && d > 0) dep += d * qty;
    }
    return toMoney(dep);
  }

  function calcPlatformFee(subtotal) {
    return toMoney(PLATFORM_FEE_FIXED + Number(subtotal || 0) * PLATFORM_FEE_RATE);
  }

  function calcTaxAmount(subtotal) {
    return toMoney(Number(subtotal || 0) * NY_TAX_RATE);
  }

  function getCurrentShippingFeeFromUI() {
    const feeEl = document.getElementById("deliveryFee");
    if (!feeEl) return 0;
    return toMoney(parseMoneyText(feeEl.textContent));
  }

  // =========================
  // UI：运费/模式提示
  // =========================
  function updateCheckoutUI() {
    const s = getSummary();
    if (!s) return;

    const deliveryModeSelect = document.getElementById("deliveryMode");
    const feeEl = document.getElementById("deliveryFee");
    const minTip = document.getElementById("minConsumeTip");

    if (!deliveryModeSelect || !feeEl) return;

    // 情况 1：纯爆品
    if (s.hasSpecial && !s.hasNormal) {
      deliveryModeSelect.innerHTML = `
        <option value="area-group" selected>区域团配送（爆品专用 · 无门槛 无运费）</option>
      `;
      feeEl.textContent = "$0.00";
      if (minTip) minTip.textContent = "本单为爆品订单 · 无门槛 无运费";
      return;
    }

    // 情况 2：混合
    if (s.hasSpecial && s.hasNormal) {
      deliveryModeSelect.innerHTML = `
        <option value="next-day">次日配送</option>
        <option value="area-group">区域团配送</option>
      `;
      if (!deliveryModeSelect.value) deliveryModeSelect.value = "next-day";

      if (s.normalAmount < CONFIG.minAmountNormal) {
        const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
        if (minTip)
          minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
      } else {
        if (minTip) minTip.textContent = "";
      }

      const fee = deliveryModeSelect.value === "next-day" ? CONFIG.nextDayFee : CONFIG.areaFee;
      feeEl.textContent = "$" + Number(fee).toFixed(2);
      return;
    }

    // 情况 3：纯非爆品
    deliveryModeSelect.innerHTML = `
      <option value="next-day">次日配送（$${CONFIG.nextDayFee}）</option>
      <option value="area-group">区域团配送（满 $${CONFIG.minAmountNormal} 免运费）</option>
    `;

    if (s.normalAmount < CONFIG.minAmountNormal) {
      const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
      if (minTip)
        minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
    } else {
      if (minTip) minTip.textContent = "";
    }

    const selected = deliveryModeSelect.value || "next-day";
    let fee = 0;
    if (selected === "next-day") fee = CONFIG.nextDayFee;
    else fee = s.normalAmount >= CONFIG.minAmountNormal ? 0 : CONFIG.nextDayFee;

    feeEl.textContent = "$" + Number(fee).toFixed(2);
  }

  // =========================
  // ✅ NEW：更新右侧汇总（平台费/税/押金显示 + 方便给 payload）
  // =========================
  function computeCheckoutAmounts() {
    const s = getSummary();
    const items = Array.isArray(s?.items) ? s.items : [];

    // 优先用购物车 summary 的金额字段（如果存在），否则自己算
    const subtotal =
      Number.isFinite(Number(s?.amount)) ? toMoney(s.amount) :
      Number.isFinite(Number(s?.totalAmount)) ? toMoney(s.totalAmount) :
      Number.isFinite(Number(s?.itemsAmount)) ? toMoney(s.itemsAmount) :
      calcSubtotalFromItems(items);

    const shippingFee = getCurrentShippingFeeFromUI();
    const tipAmount = toMoney(readTip());

    const platformFee = calcPlatformFee(subtotal);
    const taxAmount = calcTaxAmount(subtotal);
    const bottleDeposit = calcBottleDeposit(items);

    const total = toMoney(subtotal + shippingFee + platformFee + taxAmount + bottleDeposit + tipAmount);

    return { subtotal, shippingFee, platformFee, taxAmount, bottleDeposit, tipAmount, total };
  }

  function renderFeesTaxDepositUI() {
    const a = computeCheckoutAmounts();

    // 这几个 id 需要你在 checkout.html 右侧汇总里加（不存在也不会报错）
    const platformEl = document.getElementById("platformFeeAmount");
    if (platformEl) platformEl.textContent = "$" + a.platformFee.toFixed(2);

    const taxLabelEl = document.getElementById("taxLabel");
    if (taxLabelEl) taxLabelEl.textContent = `NY Sales Tax (${(NY_TAX_RATE * 100).toFixed(3)}%)`;

    const taxEl = document.getElementById("taxAmount");
    if (taxEl) taxEl.textContent = "$" + a.taxAmount.toFixed(2);

    const depEl = document.getElementById("bottleDepositAmount");
    if (depEl) depEl.textContent = "$" + a.bottleDeposit.toFixed(2);

    // 如果你页面有总计 id，就顺便更新（不确定你用哪个）
    const totalEl =
      document.getElementById("orderTotal") ||
      document.getElementById("totalAmount") ||
      document.querySelector("[data-total-amount]");
    if (totalEl) totalEl.textContent = "$" + a.total.toFixed(2);

    // 可选：如果你有小计显示
    const subEl =
      document.getElementById("itemsSubtotal") ||
      document.getElementById("subtotalAmount") ||
      document.querySelector("[data-subtotal]");
    if (subEl) subEl.textContent = "$" + a.subtotal.toFixed(2);
  }

  // =========================
  // 初始化
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    const token = getAnyToken();
    const isGuest = !token;

    if (isGuest) clearCheckoutUserUI();

    updateCheckoutUI();
    renderFeesTaxDepositUI();
  });

  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "deliveryMode") {
      updateCheckoutUI();
      renderFeesTaxDepositUI();
    }
  });

  // tip 改变时也刷新总计（如果存在 tip 输入框）
  document.addEventListener("input", (e) => {
    const id = e.target?.id;
    if (id === "tipAmount" || id === "tip") {
      renderFeesTaxDepositUI();
    }
  });

  // =========================
  // ✅ 提交订单（钱包优先，剩余走 Stripe）
  // =========================
  async function submitCheckout() {
    const token = getToken();
    if (!token) {
      alert("请先登录再下单");
      return;
    }

    const s = getSummary();
    if (!s || !Array.isArray(s.items) || s.items.length === 0) {
      alert("购物车为空");
      return;
    }

    const shipping = buildShippingPayload();
    const tipAmount = readTip();
    const payMethodRaw = readPayMethod(); // wallet / stripe

    // ✅ 先把 items 标准化（库存扣减关键）
    const normalizedItems = normalizeCheckoutItems(s.items);

    // ✅ 调试：你要看的就是这里！
    console.log("🧾 raw cart items =", s.items);
    console.log("✅ normalized checkout items =", normalizedItems);

    // ✅ 订单模式：必须按购物车内容决定
    // - 纯爆品 => dealsDay（后端规则要求）
    // - 其他 => normal / groupDay（由 UI 选择）
    const deliveryModeUI = document.getElementById("deliveryMode")?.value || "next-day";

    let mode = "normal";
    if (s.hasSpecial && !s.hasNormal) {
      mode = "dealsDay";
    } else {
      mode = deliveryModeUI === "area-group" ? "groupDay" : "normal";
    }

    // ✅ 提交前强校验最低消费（避免后端 400）
    if (!(s.hasSpecial && !s.hasNormal)) {
      if (deliveryModeUI === "area-group" && s.normalAmount < CONFIG.minAmountNormal) {
        const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
        alert(`区域团配送需满 $${CONFIG.minAmountNormal}，还差 $${remain}`);
        return;
      }
    }

    // ✅ wallet 表示“自动能扣多少扣多少”
    // ✅ 对齐后端：用户选 wallet 就传 "wallet"；否则 "stripe"
const payMethod = payMethodRaw === "wallet" ? "wallet" : "stripe";
    // ✅ NEW：提交时把费用/税/押金算出来一起给后端（后端仍建议再算一遍）
    const amounts = computeCheckoutAmounts();

    const payload = {
     intentKey: getOrCreateIntentKey(), // ✅ 新增：短幂等键（给后端/Stripe 用）
      mode,
      deliveryMode: deliveryModeUI,
      items: normalizedItems,
      shipping,
      receiver: shipping,
      tipAmount,
      payMethod,
      paymentMethod: payMethod,
      deliveryDate: document.getElementById("deliveryDate")?.value || undefined,
      deliveryType: "home",
      source: "web_checkout",

      // ✅ NEW fields
      subtotal: amounts.subtotal,
      shippingFee: amounts.shippingFee,
      platformFee: amounts.platformFee,
      taxAmount: amounts.taxAmount,
      bottleDeposit: amounts.bottleDeposit,
    };

    // 1) 先走后端 checkout（事务里会扣库存 + 扣钱包）
    const out = await apiFetch("/api/orders/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (out.paid === true || out.remaining <= 0) {
      clearIntentKey();
      alert("支付成功（钱包）");   
      try {
        window.FreshCart?.clear?.();
      } catch (e) {}
      location.href = "./orderSuccess.html?orderId=" + encodeURIComponent(out.orderId);
      return;
    }

    // 2) 有剩余 => 创建 Stripe intent
    const pi = await apiFetch("/api/pay/stripe/intent-for-order", {
      method: "POST",
      body: JSON.stringify({ orderId: out.orderId }),
    });

    window.__FB_STRIPE_PAY__ = {
      orderId: out.orderId,
      clientSecret: pi.clientSecret,
      paymentIntentId: pi.paymentIntentId,
      remaining: pi.remaining,
    };

    alert("钱包已抵扣部分金额，将跳转信用卡支付剩余部分");
    // location.href = "./stripePay.html?orderId=" + encodeURIComponent(out.orderId);
  }

  // =========================
  // ✅ 绑定“下单/支付”按钮（防重复绑定）
  // =========================
  function bindCheckoutBtnOnce() {
    if (window.__FRESHBUY_CHECKOUT_BTN_BOUND__) return;
    window.__FRESHBUY_CHECKOUT_BTN_BOUND__ = true;

    document.addEventListener("click", (e) => {
      const btn =
        e.target.closest("#placeOrderBtn") ||
        e.target.closest("#payBtn") ||
        e.target.closest('[data-action="place-order"]');

      if (!btn) return;
      e.preventDefault();

      submitCheckout().catch((err) => {
  console.error("submitCheckout error:", err);

  const msg = String(err?.message || "");
  if (msg.includes("复用了同一个下单Key") || msg.includes("409")) {
    clearIntentKey();
  }

  alert(msg || "下单失败");
});
    });
  }

  bindCheckoutBtnOnce();
})();
