// frontend/user/assets/js/checkout.js
// 统一处理：最低消费、运费、配送方式限制 + 游客不显示地址/钱包
// ✅ FIX: 防重复加载 + checkout items productId/variantKey 拆分（库存扣减关键）
// ✅ FIX: 纯爆品订单 => mode=dealsDay（后端规则要求）
// ✅ NEW: 平台服务费 = $0.50 + 商品小计*2%
// ✅ NEW: 显示 NY Sales Tax 金额（并显示税率）
// ✅ NEW: 瓶子押金（按 item.deposit / item.bottleDeposit 累加）
// ✅ NEW: 下单 payload 带 platformFee / taxAmount / bottleDeposit / subtotal / shippingFee
// ✅ NEW: 自提点支持现金支付（cash），仅自提可见

(function () {
  // =========================
  // ✅ 防重复加载：避免老版本脚本仍然绑定 click 导致发错 payload
  // =========================
  if (window.__FRESHBUY_CHECKOUT_JS_LOADED__) {
    console.warn("⚠️ checkout.js already loaded, skip");
    return;
  }
  window.__FRESHBUY_CHECKOUT_JS_LOADED__ = true;

  console.log("Checkout script loaded (FULL FIXED + FEES/TAX/DEPOSIT + CASH PICKUP)");

  // =========================
  // 费用/税配置
  // =========================
  const PLATFORM_FEE_FIXED = 0.5;
  const PLATFORM_FEE_RATE = 0.02;
  const NY_TAX_RATE = 0.08875;

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
  function flashStreet() {
    const street = document.getElementById("street") || document.getElementById("street1");
    if (!street) return;
    street.classList.add("fb-flash");
    street.scrollIntoView({ behavior: "smooth", block: "center" });
    street.focus();
    setTimeout(() => street.classList.remove("fb-flash"), 1200);
  }

  function openAddrHintModal() {
    const modal = document.getElementById("addrHintModal");
    const btnBack = document.getElementById("addrHintBack");
    if (!modal || !btnBack) {
      alert("请在 Street Address 输入后，从下拉建议中选择一个地址（验证必需）。");
      return;
    }
    modal.classList.add("open");
    btnBack.onclick = () => modal.classList.remove("open");
  }

  function enforceDropdownPickOrStop(shipping) {
    const placeId = String(shipping?.placeId || "").trim();
    const latOk = Number.isFinite(Number(shipping?.lat));
    const lngOk = Number.isFinite(Number(shipping?.lng));

    if (placeId && latOk && lngOk) return true;

    flashStreet();
    openAddrHintModal();
    return false;
  }

  function readPayMethod() {
    const el =
      document.querySelector('input[name="payMethod"]:checked') ||
      document.querySelector('input[name="paymentMethod"]:checked');
    return el ? String(el.value || "").trim().toLowerCase() : "stripe";
  }

  function setPayMethod(value) {
    const v = String(value || "").trim().toLowerCase();
    const selectors = [
      `input[name="payMethod"][value="${v}"]`,
      `input[name="paymentMethod"][value="${v}"]`,
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.checked = true;
        return true;
      }
    }
    return false;
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

    const lat = Number(
      document.getElementById("addrLat")?.value ?? document.getElementById("lat")?.value
    );
    const lng = Number(
      document.getElementById("addrLng")?.value ?? document.getElementById("lng")?.value
    );

    const placeId = (
      document.getElementById("addrPlaceId")?.value ||
      document.getElementById("placeId")?.value ||
      ""
    ).trim();

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
      placeId,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      note: (document.getElementById("orderNote")?.value || "").trim(),
    };
  }

  // =========================
  // ✅ 自提点：真实团长自提点（与首页同源）
  // =========================
  const CHECKOUT_PICKUP_SELECTED_KEY = "freshbuy_selected_pickup_point";

  function saveCheckoutSelectedPickupPoint(point) {
    try {
      localStorage.setItem(CHECKOUT_PICKUP_SELECTED_KEY, JSON.stringify(point || {}));
    } catch {}
  }

  function getCheckoutSelectedPickupPoint() {
    try {
      return JSON.parse(localStorage.getItem(CHECKOUT_PICKUP_SELECTED_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function getSelectedPickupPoint() {
    try {
      return JSON.parse(localStorage.getItem("freshbuy_selected_pickup_point") || "{}");
    } catch {
      return {};
    }
  }

  async function getRecommendedPickupPointsByZip(zip) {
    const z = String(zip || "").trim();
    if (!z) return [];

    const res = await fetch(`/api/public/zones/by-zip?zip=${encodeURIComponent(z)}&ts=${Date.now()}`, {
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.success) {
      throw new Error(data?.message || "获取自提点失败");
    }

    return Array.isArray(data.pickupPoints) ? data.pickupPoints : [];
  }

  function getCheckoutZip() {
    const zip =
      localStorage.getItem("freshbuy_zip") ||
      document.getElementById("zip")?.value ||
      document.getElementById("zipInput")?.value ||
      "";

    return String(zip || "").trim();
  }

  function ensureCashOptionExists() {
    const paymentBox =
      document.getElementById("paymentMethods") ||
      document.querySelector(".payment-methods") ||
      document.querySelector('[data-payment-methods]') ||
      document.querySelector(".checkout-payment") ||
      document.querySelector(".payment-box");

    if (!paymentBox) return null;

    let wrap = document.getElementById("cashPayOptionWrap");
    if (wrap) return wrap;

    wrap = document.createElement("label");
    wrap.id = "cashPayOptionWrap";
    wrap.style.cssText = `
      display:none;
      align-items:flex-start;
      gap:10px;
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:12px 14px;
      margin-top:10px;
      background:#fff;
      cursor:pointer;
    `;
    wrap.innerHTML = `
      <input type="radio" name="payMethod" value="cash" style="margin-top:3px;" />
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:700;color:#111827;">现金支付（到自提点付款）</div>
        <div style="margin-top:4px;font-size:12px;color:#6b7280;line-height:1.5;">
          仅限团长自提点订单使用。提交订单后，请按预约时间到自提点现场付款取货。
        </div>
      </div>
    `;

    paymentBox.appendChild(wrap);
    return wrap;
  }

  function isPickupSelected() {
    const deliveryModeSelect = document.getElementById("deliveryMode");
    const deliveryModeUI = String(deliveryModeSelect?.value || "").trim().toLowerCase();
    if (deliveryModeUI === "pickup") return true;

    const selectedPickupPoint = getCheckoutSelectedPickupPoint() || getSelectedPickupPoint() || {};
    const pickupPointId = String(selectedPickupPoint?.id || "").trim();
    return !!pickupPointId && deliveryModeUI === "pickup";
  }

  function syncCashOptionVisibility() {
    const wrap = ensureCashOptionExists();
    if (!wrap) return;

    const pickup = isPickupSelected();
    wrap.style.display = pickup ? "flex" : "none";

    const cashRadio = wrap.querySelector('input[type="radio"][value="cash"]');
    if (!cashRadio) return;

    if (!pickup) {
      if (cashRadio.checked) {
        setPayMethod("stripe");
      }
      cashRadio.checked = false;
      cashRadio.disabled = true;
    } else {
      cashRadio.disabled = false;
    }
  }

  function renderRealPickupPoints(points) {
    const container =
      document.getElementById("pickupPointsContainer") ||
      document.getElementById("pickupPointList") ||
      document.querySelector("[data-pickup-points]");

    if (!container) {
      console.warn("❌ 未找到自提点容器：#pickupPointsContainer / #pickupPointList / [data-pickup-points]");
      return;
    }

    const homepageSelected = getSelectedPickupPoint();
    const checkoutSelected = getCheckoutSelectedPickupPoint();
    const selectedId = String(checkoutSelected?.id || homepageSelected?.id || "");

    container.innerHTML = "";

    if (!Array.isArray(points) || !points.length) {
      container.innerHTML = `
        <div style="padding:12px;border:1px solid #eee;border-radius:12px;color:#6b7280;">
          当前暂无可用自提点
        </div>
      `;
      syncCashOptionVisibility();
      return;
    }

    points.forEach((p, idx) => {
      const pointId = String(p.id || "");
      const checked = selectedId ? selectedId === pointId : idx === 0;
      const distText = Number.isFinite(Number(p.distanceMiles))
        ? `${Number(p.distanceMiles).toFixed(1)} miles`
        : "";

      const card = document.createElement("label");
      card.className = "pickup-option-card";
      card.style.cssText = `
        display:block;
        border:1px solid ${checked ? "#22c55e" : "#e5e7eb"};
        border-radius:16px;
        padding:14px;
        margin-bottom:12px;
        background:${checked ? "#f0fdf4" : "#fff"};
        cursor:pointer;
      `;

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:15px;font-weight:800;color:#111827;">
              ${p.name || "团长自提点"}
              ${p.recommended ? '<span style="color:#16a34a;font-size:12px;margin-left:6px;">推荐</span>' : ""}
            </div>

            <div style="margin-top:6px;font-size:14px;color:#6b7280;line-height:1.5;">
              ${p.maskedAddress || p.addressLine1 || p.addressLine || "地址待更新"}
            </div>

            <div style="margin-top:6px;font-size:13px;color:#6b7280;">
              取货时间：${p.pickupTimeText || "—"}
            </div>

            ${p.displayArea ? `
              <div style="margin-top:4px;font-size:13px;color:#6b7280;">
                区域：${p.displayArea}
              </div>
            ` : ""}

            ${distText ? `
              <div style="margin-top:4px;font-size:13px;color:#16a34a;">
                ${distText}
              </div>
            ` : ""}
          </div>

          <input
            type="radio"
            name="pickupPoint"
            value="${pointId}"
            ${checked ? "checked" : ""}
            data-pickup-id="${pointId}"
            style="margin-top:4px;"
          />
        </div>
      `;

      container.appendChild(card);
    });

    const current = getCheckoutSelectedPickupPoint();
    if (!current?.id && !selectedId && points[0]) {
      saveCheckoutSelectedPickupPoint(points[0]);
      try {
        localStorage.setItem("freshbuy_selected_pickup_point", JSON.stringify(points[0]));
      } catch {}
    }

    container.querySelectorAll('input[name="pickupPoint"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const id = String(radio.value || "");
        const picked = points.find((x) => String(x.id || "") === id);
        if (!picked) return;

        saveCheckoutSelectedPickupPoint(picked);

        try {
          localStorage.setItem("freshbuy_selected_pickup_point", JSON.stringify(picked));
        } catch {}

        renderRealPickupPoints(points);
        syncCashOptionVisibility();
      });
    });

    syncCashOptionVisibility();
  }

  async function loadRealPickupPointsForCheckout() {
    try {
      const zip = getCheckoutZip();
      if (!zip) {
        console.warn("⚠️ checkout 未拿到 ZIP，暂不加载自提点");
        syncCashOptionVisibility();
        return;
      }

      const rawPoints = await getRecommendedPickupPointsByZip(zip);
      renderRealPickupPoints(rawPoints);
    } catch (err) {
      console.error("loadRealPickupPointsForCheckout error:", err);
      syncCashOptionVisibility();
    }
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
  // ✅ 拆 productId::variantKey
  // ✅ 带出特价/税/押金字段
  // =========================
  function normalizeCheckoutItems(items) {
    return (items || []).map((it) => {
      const p = it?.product || it;

      let raw = String(it.productId || it._id || it.id || p._id || p.id || "").trim();
      let pid = raw;
      let variantKey = String(it.variantKey || it.variant || p.variantKey || p.variant || "").trim();

      if (raw.includes("::")) {
        const parts = raw.split("::");
        pid = String(parts[0] || "").trim();
        if (!variantKey) variantKey = String(parts[1] || "").trim();
      }

      const qty = Math.max(1, Math.floor(Number(it.qty || 1)));

      const priceNum = (it.priceNum ?? p.priceNum);
      const price = (it.price ?? p.price);

      const specialQty =
        Number(
          it.specialQty ??
            p.specialQty ??
            it.specialN ??
            p.specialN ??
            it.specialCount ??
            p.specialCount ??
            it.dealQty ??
            p.dealQty ??
            0
        ) || 0;

      const specialTotalPrice =
        Number(
          it.specialTotalPrice ??
            p.specialTotalPrice ??
            it.specialTotal ??
            p.specialTotal ??
            it.dealTotalPrice ??
            p.dealTotalPrice ??
            it.dealPrice ??
            p.dealPrice ??
            0
        ) || 0;

      const taxable = it.taxable ?? p.taxable;
      const hasTax = it.hasTax ?? p.hasTax;
      const deposit = it.deposit ?? p.deposit ?? it.bottleDeposit ?? p.bottleDeposit ?? p.crv ?? it.crv;
      const unitCount = it.unitCount ?? p.unitCount;

      return {
        ...it,
        productId: pid,
        variantKey: variantKey || "single",
        qty,
        priceNum,
        price,
        specialQty,
        specialTotalPrice,
        taxable,
        hasTax,
        deposit,
        unitCount,
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
      const basePrice = Number(it.priceNum ?? it.price ?? 0) || 0;

      const specialQty = Number(
        it.specialQty ?? it.specialN ?? it.specialCount ?? it.dealQty ?? 0
      ) || 0;

      const specialTotalPrice = Number(
        it.specialTotalPrice ?? it.specialTotal ?? it.dealTotalPrice ?? it.dealPrice ?? 0
      ) || 0;

      if (specialQty === 1 && specialTotalPrice > 0) {
        subtotal += qty * specialTotalPrice;
        continue;
      }

      if (specialQty >= 2 && specialTotalPrice > 0 && qty >= specialQty) {
        const groups = Math.floor(qty / specialQty);
        const remainder = qty % specialQty;
        subtotal += groups * specialTotalPrice + remainder * basePrice;
        continue;
      }

      subtotal += qty * basePrice;
    }

    return toMoney(subtotal);
  }

  function calcBottleDeposit(items) {
    let dep = 0;
    for (const it of items || []) {
      const qty = Math.max(0, Number(it.qty || 0));
      const unitCount = Math.max(1, Number(it.unitCount || 1));
      const d = Number(it.deposit || it.bottleDeposit || it.containerDeposit || 0);
      if (Number.isFinite(d) && d > 0) dep += d * qty * unitCount;
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

    if (!deliveryModeSelect || !feeEl) {
      syncCashOptionVisibility();
      return;
    }

    const canPickup = !!(
      document.getElementById("pickupPointsContainer") ||
      document.getElementById("pickupPointList") ||
      document.querySelector("[data-pickup-points]")
    );

    const currentValue = String(deliveryModeSelect.value || "").trim();
    let pickupOptionHtml = "";
    if (canPickup && !deliveryModeSelect.querySelector('option[value="pickup"]')) {
      pickupOptionHtml = `<option value="pickup">团长自提（到自提点取货）</option>`;
    }

    if (s.hasSpecial && !s.hasNormal) {
      deliveryModeSelect.innerHTML = `
        ${pickupOptionHtml}
        <option value="area-group" selected>区域团配送（爆品专用 · 无门槛 无运费）</option>
      `;
      if (currentValue === "pickup") deliveryModeSelect.value = "pickup";
      feeEl.textContent = deliveryModeSelect.value === "pickup" ? "$0.00" : "$0.00";
      if (minTip) {
        minTip.textContent =
          deliveryModeSelect.value === "pickup"
            ? "本单为自提订单 · 到自提点取货"
            : "本单为爆品订单 · 无门槛 无运费";
      }
      syncCashOptionVisibility();
      return;
    }

    if (s.hasSpecial && s.hasNormal) {
      deliveryModeSelect.innerHTML = `
        ${pickupOptionHtml}
        <option value="next-day">次日配送</option>
        <option value="area-group">区域团配送</option>
      `;

      if (currentValue && deliveryModeSelect.querySelector(`option[value="${currentValue}"]`)) {
        deliveryModeSelect.value = currentValue;
      } else if (!deliveryModeSelect.value) {
        deliveryModeSelect.value = "next-day";
      }

      if (deliveryModeSelect.value === "pickup") {
        feeEl.textContent = "$0.00";
        if (minTip) minTip.textContent = "团长自提订单 · 到自提点取货";
        syncCashOptionVisibility();
        return;
      }

      if (s.normalAmount < CONFIG.minAmountNormal) {
        const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
        if (minTip) {
          minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
        }
      } else {
        if (minTip) minTip.textContent = "";
      }

      const fee = deliveryModeSelect.value === "next-day" ? CONFIG.nextDayFee : CONFIG.areaFee;
      feeEl.textContent = "$" + Number(fee).toFixed(2);
      syncCashOptionVisibility();
      return;
    }

    deliveryModeSelect.innerHTML = `
      ${pickupOptionHtml}
      <option value="next-day">次日配送（$${CONFIG.nextDayFee}）</option>
      <option value="area-group">区域团配送（满 $${CONFIG.minAmountNormal} 免运费）</option>
    `;

    if (currentValue && deliveryModeSelect.querySelector(`option[value="${currentValue}"]`)) {
      deliveryModeSelect.value = currentValue;
    }

    if (deliveryModeSelect.value === "pickup") {
      feeEl.textContent = "$0.00";
      if (minTip) minTip.textContent = "团长自提订单 · 到自提点取货";
      syncCashOptionVisibility();
      return;
    }

    if (s.normalAmount < CONFIG.minAmountNormal) {
      const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
      if (minTip) {
        minTip.textContent = `还差 $${remain} 可满足最低消费 $${CONFIG.minAmountNormal}`;
      }
    } else {
      if (minTip) minTip.textContent = "";
    }

    const selected = deliveryModeSelect.value || "next-day";
    let fee = 0;
    if (selected === "next-day") fee = CONFIG.nextDayFee;
    else fee = s.normalAmount >= CONFIG.minAmountNormal ? 0 : CONFIG.nextDayFee;

    feeEl.textContent = "$" + Number(fee).toFixed(2);
    syncCashOptionVisibility();
  }

  // =========================
  // ✅ 更新右侧汇总
  // =========================
  function computeCheckoutAmounts() {
    const s = getSummary();
    const items = Array.isArray(s?.items) ? s.items : [];

    const subtotal =
      Number.isFinite(Number(s?.amount)) ? toMoney(s.amount) :
      Number.isFinite(Number(s?.totalAmount)) ? toMoney(s.totalAmount) :
      Number.isFinite(Number(s?.itemsAmount)) ? toMoney(s.itemsAmount) :
      calcSubtotalFromItems(items);

    const shippingFee = getCurrentShippingFeeFromUI();
    const tipAmount = toMoney(readTip());

    const payMethod = readPayMethod();
    const isCash = payMethod === "cash";
    const platformFee = isCash ? 0 : calcPlatformFee(subtotal);

    const taxAmount = calcTaxAmount(subtotal);
    const bottleDeposit = calcBottleDeposit(items);

    const total = toMoney(subtotal + shippingFee + platformFee + taxAmount + bottleDeposit + tipAmount);

    return { subtotal, shippingFee, platformFee, taxAmount, bottleDeposit, tipAmount, total };
  }

  function renderFeesTaxDepositUI() {
    const a = computeCheckoutAmounts();

    const platformEl = document.getElementById("platformFeeAmount");
    if (platformEl) platformEl.textContent = "$" + a.platformFee.toFixed(2);

    const taxLabelEl = document.getElementById("taxLabel");
    if (taxLabelEl) taxLabelEl.textContent = `NY Sales Tax (${(NY_TAX_RATE * 100).toFixed(3)}%)`;

    const taxEl = document.getElementById("taxAmount");
    if (taxEl) taxEl.textContent = "$" + a.taxAmount.toFixed(2);

    const depEl = document.getElementById("bottleDepositAmount");
    if (depEl) depEl.textContent = "$" + a.bottleDeposit.toFixed(2);

    const totalEl =
      document.getElementById("orderTotal") ||
      document.getElementById("totalAmount") ||
      document.querySelector("[data-total-amount]");
    if (totalEl) totalEl.textContent = "$" + a.total.toFixed(2);

    const subEl =
      document.getElementById("itemsSubtotal") ||
      document.getElementById("subtotalAmount") ||
      document.querySelector("[data-subtotal]");
    if (subEl) subEl.textContent = "$" + a.subtotal.toFixed(2);
  }

  // =========================
  // 初始化
  // =========================
  document.addEventListener("DOMContentLoaded", async () => {
    const token = getAnyToken();
    const isGuest = !token;

    if (isGuest) clearCheckoutUserUI();

    ensureCashOptionExists();
    updateCheckoutUI();
    renderFeesTaxDepositUI();

    await loadRealPickupPointsForCheckout();

    syncCashOptionVisibility();
    renderFeesTaxDepositUI();
  });

  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "deliveryMode") {
      updateCheckoutUI();
      syncCashOptionVisibility();
      renderFeesTaxDepositUI();
      return;
    }

    if (
      e.target &&
      (
        e.target.matches('input[name="payMethod"]') ||
        e.target.matches('input[name="paymentMethod"]')
      )
    ) {
      syncCashOptionVisibility();
      renderFeesTaxDepositUI();
    }
  });

  document.addEventListener("input", (e) => {
    const id = e.target?.id;
    if (id === "tipAmount" || id === "tip") {
      renderFeesTaxDepositUI();
    }
  });

  // =========================
  // ✅ 提交订单
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
    const selectedPickupPoint = getCheckoutSelectedPickupPoint() || getSelectedPickupPoint() || {};
    const pickupPointId = String(selectedPickupPoint?.id || "").trim();

    const deliveryModeUI = document.getElementById("deliveryMode")?.value || "next-day";
    const isPickup = deliveryModeUI === "pickup";

    if (!isPickup) {
      if (!enforceDropdownPickOrStop(shipping)) return;
    } else {
      if (!pickupPointId) {
        alert("请选择自提点");
        return;
      }
    }

    const tipAmount = readTip();
    const payMethodRaw = readPayMethod();

    const normalizedItems = normalizeCheckoutItems(s.items);

    console.log("🧾 raw cart items =", s.items);
    console.log("✅ normalized checkout items =", normalizedItems);

    let mode = "normal";

    if (deliveryModeUI === "pickup") {
      mode = "pickup";
    } else if (s.hasSpecial && !s.hasNormal) {
      mode = "dealsDay";
    } else {
      mode = deliveryModeUI === "area-group" ? "groupDay" : "normal";
    }

    if (!(s.hasSpecial && !s.hasNormal)) {
      if (!isPickup && deliveryModeUI === "area-group" && s.normalAmount < CONFIG.minAmountNormal) {
        const remain = (CONFIG.minAmountNormal - s.normalAmount).toFixed(2);
        alert(`区域团配送需满 $${CONFIG.minAmountNormal}，还差 $${remain}`);
        return;
      }
    }

    let payMethod = "stripe";
    if (payMethodRaw === "wallet") {
      payMethod = "wallet";
    } else if (payMethodRaw === "cash") {
      if (!isPickup) {
        alert("现金支付仅支持自提点自提订单");
        return;
      }
      payMethod = "cash";
    } else {
      payMethod = "stripe";
    }

    const amounts = computeCheckoutAmounts();

    const payload = {
      intentKey: getOrCreateIntentKey(),
      mode,
      deliveryMode: deliveryModeUI,
      items: normalizedItems,
      shipping,
      receiver: shipping,
      tipAmount,
      payMethod,
      paymentMethod: payMethod,
      payment: { method: payMethod },
      deliveryDate: document.getElementById("deliveryDate")?.value || undefined,

      deliveryType: isPickup ? "pickup" : "home",
      pickupPointId: isPickup ? pickupPointId : undefined,
      pickupPoint: isPickup ? selectedPickupPoint : undefined,

      source: "web_checkout",

      subtotal: amounts.subtotal,
      shippingFee: amounts.shippingFee,
      platformFee: amounts.platformFee,
      taxAmount: amounts.taxAmount,
      bottleDeposit: amounts.bottleDeposit,
    };

    const out = await apiFetch("/api/orders/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (out?.payment?.method === "cash") {
      clearIntentKey();
      try {
        window.FreshCart?.clear?.();
      } catch (e) {}
      alert("订单已提交，请到自提点现场现金付款取货");
      location.href = "./orderSuccess.html?orderId=" + encodeURIComponent(out.orderId);
      return;
    }

    if (out.paid === true || out.remaining <= 0) {
      clearIntentKey();
      alert("支付成功（钱包）");
      try {
        window.FreshCart?.clear?.();
      } catch (e) {}
      location.href = "./orderSuccess.html?orderId=" + encodeURIComponent(out.orderId);
      return;
    }

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
  // ✅ 绑定“下单/支付”按钮
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