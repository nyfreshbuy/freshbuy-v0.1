// frontend/user/assets/js/checkout.js
// 统一处理：最低消费、运费、配送方式限制 + 游客不显示地址/钱包

(function () {
  console.log("Checkout script loaded");
  // =========================
  // ✅ API 工具
  // =========================
  function getToken() {
    return getAnyToken();
  }

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

  function readPayMethod() {
    const el =
      document.querySelector('input[name="payMethod"]:checked') ||
      document.querySelector('input[name="paymentMethod"]:checked');
    return el ? String(el.value || "").trim() : "stripe";
  }

  function mapDeliveryMode(uiVal) {
    // 你的 UI 值：next-day / area-group
    // 后端需要：normal / groupDay / dealsDay / friendGroup
    if (uiVal === "area-group") return "groupDay";
    return "normal"; // next-day
  }

  function readTip() {
    const el = document.getElementById("tipAmount") || document.getElementById("tip") || document.querySelector('[name="tip"]');
    const v = el ? Number(el.value || 0) : 0;
    return Number.isFinite(v) ? v : 0;
  }

  function buildShippingPayload() {
    // ⚠️ 你的 id 可能不同，这里按你常见写法先取
    const firstName = (document.getElementById("firstName")?.value || "").trim();
    const lastName = (document.getElementById("lastName")?.value || "").trim();
    const phone = (document.getElementById("phone")?.value || "").trim();

    const street1 =
      (document.getElementById("street")?.value || document.getElementById("street1")?.value || "").trim();
    const apt = (document.getElementById("apt")?.value || "").trim();
    const city = (document.getElementById("city")?.value || "").trim();
    const state = (document.getElementById("state")?.value || "NY").trim();
    const zip = (document.getElementById("zip")?.value || "").trim();

    // 如果你页面是 Places 下拉，会有 lat/lng
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
  // Auth guard（游客/已登录判断）
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

  function clearCheckoutUserUI() {
    // ✅ 方案1：按常见 id 清（你若 id 不同也没关系，下面还有方案2兜底）
    const ids = ["firstName", "lastName", "phone", "street", "apt", "city", "zip"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    // ✅ 方案2（兜底）：把收货信息区域里的 input 都清掉（避免你 id 不一致）
    const shipBox =
      document.getElementById("shippingForm") ||
      document.querySelector(".shipping-box") ||
      document.querySelector('[data-section="shipping"]') ||
      document.querySelector(".checkout-left") ||
      document.querySelector("form");

    if (shipBox) {
      shipBox.querySelectorAll('input[type="text"],input[type="tel"],input[type="number"]').forEach((i) => {
        i.value = "";
      });
    }

    // 钱包余额显示清空
    const walletEl =
      document.getElementById("walletBalance") ||
      document.getElementById("walletAmount") ||
      document.querySelector("[data-wallet-balance]");
    if (walletEl) walletEl.textContent = "--";

    // 禁用“钱包支付”
    const walletRadio =
      document.querySelector('input[name="payMethod"][value="wallet"]') ||
      document.querySelector('input[value="wallet"]');
    if (walletRadio) {
      walletRadio.checked = false;
      walletRadio.disabled = true;
    }
  }

  // =========================
  // 获取购物车概况（来自 cart.js）
  // =========================
  function getSummary() {
    if (!window.FreshCart) return null;
    return window.FreshCart.getSummary();
  }

  // =========================
  // 配置（你可以未来从后台读取）
  // =========================
  const CONFIG = {
    minAmountNormal: 49.99, // 混合订单 / 非爆品最低消费
    nextDayFee: 4.99,       // 次日配送运费
    areaFee: 0,             // 区域团配送运费（这里你设成 0）
  };

  function updateCheckoutUI() {
    const s = getSummary();
    if (!s) return;

    const deliveryModeSelect = document.getElementById("deliveryMode");
    const feeEl = document.getElementById("deliveryFee");
    const minTip = document.getElementById("minConsumeTip");

    if (!deliveryModeSelect || !feeEl) return;

    // =============== 情况 1：纯爆品订单 ===============
    if (s.hasSpecial && !s.hasNormal) {
      // 只能区域团
      deliveryModeSelect.innerHTML = `
        <option value="area-group" selected>区域团配送（爆品专用 · 无门槛 无运费）</option>
      `;
      feeEl.textContent = "$0.00";
      if (minTip) minTip.textContent = "本单为爆品订单 · 无门槛 无运费";
      return;
    }

    // =============== 情况 2：混合（爆品 + 非爆品） ===============
    if (s.hasSpecial && s.hasNormal) {
      deliveryModeSelect.innerHTML = `
        <option value="next-day">次日配送</option>
        <option value="area-group">区域团配送</option>
      `;
      // 默认次日
      if (!deliveryModeSelect.value) deliveryModeSelect.value = "next-day";

      // 最低消费提示
      if (s.normalAmount < CONFIG.minAmountNormal) {
        const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
        if (minTip) minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
      } else {
        if (minTip) minTip.textContent = "";
      }

      const fee = deliveryModeSelect.value === "next-day" ? CONFIG.nextDayFee : CONFIG.areaFee;
      feeEl.textContent = "$" + Number(fee).toFixed(2);
      return;
    }

    // =============== 情况 3：纯非爆品 ===============
    deliveryModeSelect.innerHTML = `
      <option value="next-day">次日配送（$${CONFIG.nextDayFee}）</option>
      <option value="area-group">区域团配送（满 $${CONFIG.minAmountNormal} 免运费）</option>
    `;

    // 最低消费提示
    if (s.normalAmount < CONFIG.minAmountNormal) {
      const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
      if (minTip) minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
    } else {
      if (minTip) minTip.textContent = "";
    }

    // 运费计算
    const selected = deliveryModeSelect.value || "next-day";
    let fee = 0;
    if (selected === "next-day") {
      fee = CONFIG.nextDayFee;
    } else {
      fee = s.normalAmount >= CONFIG.minAmountNormal ? 0 : CONFIG.nextDayFee;
    }

    feeEl.textContent = "$" + Number(fee).toFixed(2);
  }

  // =========================
  // 初始化（只做一次）
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    const token = getAnyToken();
    const isGuest = !token;

    // ✅ 游客：清空地址/钱包，禁用钱包支付
    if (isGuest) {
      clearCheckoutUserUI();
    }

    // ✅ 不管是否登录，都要跑运费/配送方式 UI
    updateCheckoutUI();
  });

  // =========================
  // 监听配送方式变化
  // =========================
  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "deliveryMode") {
      updateCheckoutUI();
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

    const deliveryModeUI = document.getElementById("deliveryMode")?.value || "next-day";
    const mode = mapDeliveryMode(deliveryModeUI);

    const shipping = buildShippingPayload();
    const tipAmount = readTip();
    const payMethodRaw = readPayMethod(); // wallet / stripe
        // ✅ 提交前强校验最低消费（避免后端 400）
    if (s.hasSpecial && !s.hasNormal) {
      // 纯爆品：只能 groupDay
      // 这里你已经 UI 强制了，但提交时也再兜底一次
    } else {
      // 非纯爆品时：normalAmount 低于最低消费，禁止区域团（或禁止下单，按你规则）
      const deliveryModeUI = document.getElementById("deliveryMode")?.value || "next-day";

      if (deliveryModeUI === "area-group" && s.normalAmount < CONFIG.minAmountNormal) {
        const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
        alert(`区域团配送需满 $${CONFIG.minAmountNormal}，还差 $${remain}`);
        return;
      }
    }
    // ✅ wallet 表示“先用钱包能扣多少扣多少，剩下走 stripe” => 发给后端用 auto 更安全
const payMethod = payMethodRaw === "wallet" ? "auto" : "stripe";
    // ✅ 关键：orders.js 的 buildOrderPayload 需要 items + shipping/receiver + mode + tip
    const payload = {
      mode,
      deliveryMode: mode,
      items: s.items,          // FreshCart 的 items（应含 productId/qty/variantKey）
      shipping,
      receiver: shipping,
      tipAmount,
      payMethod,
      paymentMethod: payMethod,
      deliveryDate: document.getElementById("deliveryDate")?.value || undefined,
      deliveryType: "home",
    };

    // 1) 先走后端 checkout（这里才会扣钱包）
    const out = await apiFetch("/api/orders/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // out: { orderId, walletUsed, remaining, paid, payment, ... }
    if (out.paid === true || out.remaining <= 0) {
      alert("支付成功（钱包）");
      // ✅ 清空购物车（按你项目 cart.js 的实现可能不同）
      try { window.FreshCart?.clear?.(); } catch (e) {}
      location.href = "./orderSuccess.html?orderId=" + encodeURIComponent(out.orderId);
      return;
    }

    // 2) 如果还有剩余金额，创建 Stripe intent（给已有订单创建，不再新建订单）
    const pi = await apiFetch("/api/pay/stripe/intent-for-order", {
      method: "POST",
      body: JSON.stringify({ orderId: out.orderId }),
    });

    // 3) 交给你现有的 Stripe 前端支付逻辑
    // ⚠️ 你项目里可能已有 Stripe.confirmPayment 封装，这里只把 clientSecret 暴露出去
    window.__FB_STRIPE_PAY__ = {
      orderId: out.orderId,
      clientSecret: pi.clientSecret,
      paymentIntentId: pi.paymentIntentId,
      remaining: pi.remaining,
    };

    alert("钱包已抵扣部分金额，将跳转信用卡支付剩余部分");
    // 你可以在这里打开 Stripe 支付弹窗/页面
    // location.href = "./stripePay.html?orderId=" + encodeURIComponent(out.orderId);
  }

  // =========================
  // ✅ 绑定“下单/支付”按钮
  // =========================
  document.addEventListener("click", (e) => {
    const btn =
      e.target.closest("#placeOrderBtn") ||
      e.target.closest("#payBtn") ||
      e.target.closest('[data-action="place-order"]');

    if (!btn) return;
    e.preventDefault();
    submitCheckout().catch((err) => {
      console.error("submitCheckout error:", err);
      alert(err?.message || "下单失败");
    });
  });
})();
