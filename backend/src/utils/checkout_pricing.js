// backend/src/utils/checkout_pricing.js
// =======================================================
// ✅ 全站统一结算（算法与前端一致）
// - 特价：N for $X
// - 运费：按 mode
// - 税：NY 才收（默认 0.08875，可覆盖）
// - 押金：deposit * qty * unitCount
// - 小费：tip
// - 平台费：Stripe 渠道 = 0.5 + 2% * subtotal；钱包 = 0
// =======================================================

export const NY_TAX_RATE_DEFAULT = 0.08875;

export function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
export function isTruthy(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// ✅ 特价：N for $X 行小计（前端口径）
export function calcSpecialLineTotal(it, qty) {
  const q = Math.max(0, Math.floor(safeNum(qty, 0)));
  if (!it || q <= 0) return 0;

  const price = safeNum(it.priceNum ?? it.price, 0);

  const specialQty = safeNum(
    it.specialQty ?? it.specialN ?? it.specialCount ?? it.dealQty,
    0
  );

  const specialTotalPrice = safeNum(
    it.specialTotalPrice ??
      it.specialTotal ??
      it.specialPrice ??
      it.dealTotalPrice ??
      it.dealPrice,
    0
  );

  if (specialQty > 0 && specialTotalPrice > 0 && q >= specialQty) {
    const groups = Math.floor(q / specialQty);
    const remainder = q % specialQty;
    return round2(groups * specialTotalPrice + remainder * price);
  }
  return round2(q * price);
}

// ✅ 押金（deposit * qty * unitCount）
export function computeDepositTotal(items = []) {
  let sum = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.floor(safeNum(it.qty, 1)));
    const unitCount = Math.max(1, Math.floor(safeNum(it.unitCount ?? 1, 1)));
    const dep = safeNum(it.deposit ?? it.bottleDeposit ?? it.crv ?? 0, 0);
    if (dep > 0) sum += dep * qty * unitCount;
  }
  return round2(sum);
}

// ✅ 运费 + 最低消费（按你现有前端规则）
export function computeShippingAndRules(mode, subtotal) {
  const m = String(mode || "normal").trim();

  let shipping = 0;
  let canSubmit = true;

  if (m === "dealsDay") {
    shipping = 0;
    canSubmit = true;
  } else if (m === "groupDay") {
    shipping = subtotal >= 49.99 ? 0 : 4.99;
    canSubmit = true; // 区域团未满可结算，只是收运费
  } else if (m === "friendGroup") {
    shipping = 4.99;
    canSubmit = subtotal >= 29;
  } else {
    // normal
    shipping = 4.99;
    canSubmit = subtotal >= 49.99;
  }

  return { shipping: round2(shipping), canSubmit };
}

/**
 * ✅ 统一结算入口：Stripe / Wallet 都调用它
 *
 * @param payload { items, shipping, mode, pricing/tip }
 * @param options { payChannel, taxRateNY, platformRate, platformFixed }
 */
export function computeTotalsFromPayload(payload = {}, options = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const ship = payload?.shipping || {};

  // 1) subtotal（特价口径）
  let subtotal = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.floor(safeNum(it.qty, 1)));
    subtotal += calcSpecialLineTotal(it, qty);
  }
  subtotal = Math.max(0, round2(subtotal));

  // 2) shipping
  const mode = String(payload?.mode || payload?.deliveryMode || "normal").trim();
  const { shipping, canSubmit } = computeShippingAndRules(mode, subtotal);

  // 3) taxableSubtotal（特价口径 + taxable/hasTax）
  let taxableSubtotal = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.floor(safeNum(it.qty, 1)));
    const taxable = isTruthy(it.taxable) || isTruthy(it.hasTax);
    if (taxable) taxableSubtotal += calcSpecialLineTotal(it, qty);
  }
  taxableSubtotal = round2(taxableSubtotal);

  // 4) tax：NY 才收
  const shipState = String(ship.state || "").trim().toUpperCase();
  const taxRateNY = safeNum(options.taxRateNY, NY_TAX_RATE_DEFAULT);

  const taxRateFromPayload = safeNum(payload?.pricing?.taxRate ?? payload?.taxRate, NaN);
  const taxRate = Number.isFinite(taxRateFromPayload)
    ? taxRateFromPayload
    : (shipState === "NY" ? taxRateNY : 0);

  const salesTax = round2(taxableSubtotal * taxRate);

  // 5) deposit
  const depositTotal = computeDepositTotal(items);

  // 6) tip
  const tipFee = Math.max(
    0,
    round2(
      safeNum(
        payload?.pricing?.tipAmount ??
          payload?.pricing?.tip ??
          payload?.tipAmount ??
          payload?.tip ??
          0,
        0
      )
    )
  );

  // 7) platform fee（✅ 你要的新规则：每单 0.5 + 2%）
  const payChannel = options.payChannel === "wallet" ? "wallet" : "stripe";
  const platformRate = safeNum(options.platformRate, 0.02);
  const platformFixed = safeNum(options.platformFixed, 0.5);

  const platformFee =
  payChannel === "stripe"
    ? Math.max(0, round2(platformFixed + subtotal * platformRate))
    : 0;
  // 8) total
  const totalAmount = round2(
    subtotal + shipping + salesTax + depositTotal + tipFee + platformFee
  );

  return {
    mode,
    subtotal,
    shipping,
    taxableSubtotal,
    taxRate,
    salesTax,
    depositTotal,
    tipFee,
    platformFee,
    totalAmount,
    canSubmit,
  };
}
