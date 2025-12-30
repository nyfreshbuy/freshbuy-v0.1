// assets/js/checkout.js
// 统一处理：最低消费、运费、配送方式限制

(function () {
  console.log("Checkout script loaded");

  // 获取购物车概况（来自 cart.js）
  function getSummary() {
    if (!window.FreshCart) return null;
    return window.FreshCart.getSummary();
  }

  // 配置（你可以未来从后台读取）
  const CONFIG = {
    minAmountNormal: 49.99,   // 混合订单 / 非爆品最低消费
    nextDayFee: 4.99,         // 次日配送运费
    areaFee: 0,               // 区域团配送运费
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
      deliveryModeSelect.value = "next-day";

      // 检查是否达标
      if (s.normalAmount < CONFIG.minAmountNormal) {
        const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
        if (minTip)
          minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
      } else {
        if (minTip) minTip.textContent = "";
      }

      const fee =
        deliveryModeSelect.value === "next-day"
          ? CONFIG.nextDayFee
          : CONFIG.areaFee;

      feeEl.textContent = "$" + fee.toFixed(2);
      return;
    }

    // =============== 情况 3：纯非爆品 =============== 
    deliveryModeSelect.innerHTML = `
      <option value="next-day">次日配送（$${CONFIG.nextDayFee}）</option>
      <option value="area-group">区域团配送（满 $${CONFIG.minAmountNormal} 免运费）</option>
    `;

    // 最低消费检查
    if (s.normalAmount < CONFIG.minAmountNormal) {
      const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
      if (minTip)
        minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
    } else {
      if (minTip) minTip.textContent = "";
    }

    // 运费计算
    const selected = deliveryModeSelect.value;
    let fee = 0;

    if (selected === "next-day") {
      fee = CONFIG.nextDayFee;
    } else {
      // 区域团：是否达标免运费
      fee = s.normalAmount >= CONFIG.minAmountNormal ? 0 : CONFIG.nextDayFee;
    }

    feeEl.textContent = "$" + fee.toFixed(2);
  }

  // =============== 监听配送方式变化 ===============
  document.addEventListener("change", (e) => {
    if (e.target.id === "deliveryMode") {
      updateCheckoutUI();
    }
  });

  // 初次加载执行
  window.addEventListener("DOMContentLoaded", updateCheckoutUI);

})();
