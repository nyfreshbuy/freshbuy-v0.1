// frontend/user/assets/js/checkout.js
// 统一处理：最低消费、运费、配送方式限制 + 游客不显示地址/钱包

(function () {
  console.log("Checkout script loaded");

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
})();
