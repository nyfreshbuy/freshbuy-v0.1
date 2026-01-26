// frontend/user/assets/js/checkout.js
// 统一处理：最低消费、运费、配送方式限制 + 游客不显示地址/钱包
// ✅ FIX: 防重复加载 + checkout items productId/variantKey 拆分（库存扣减关键）
// ✅ FIX: 纯爆品订单 => mode=dealsDay（后端规则要求）

(function () {
  // =========================
  // ✅ 防重复加载：避免老版本脚本仍然绑定 click 导致发错 payload
  // =========================
  if (window.__FRESHBUY_CHECKOUT_JS_LOADED__) {
    console.warn("⚠️ checkout.js already loaded, skip");
    return;
  }
  window.__FRESHBUY_CHECKOUT_JS_LOADED__ = true;

  console.log("Checkout script loaded (FULL FIXED)");

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
        productId: pid,                 // ✅ 纯 24位 ObjectId
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
  // 初始化
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    const token = getAnyToken();
    const isGuest = !token;

    if (isGuest) clearCheckoutUserUI();

    updateCheckoutUI();
  });

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
    const payMethod = payMethodRaw === "wallet" ? "auto" : "stripe";

    const payload = {
      mode,
      deliveryMode: mode,
      items: normalizedItems,
      shipping,
      receiver: shipping,
      tipAmount,
      payMethod,
      paymentMethod: payMethod,
      deliveryDate: document.getElementById("deliveryDate")?.value || undefined,
      deliveryType: "home",
      source: "web_checkout",
    };

    // 1) 先走后端 checkout（事务里会扣库存 + 扣钱包）
    const out = await apiFetch("/api/orders/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (out.paid === true || out.remaining <= 0) {
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
        alert(err?.message || "下单失败");
      });
    });
  }

  bindCheckoutBtnOnce();
})();
