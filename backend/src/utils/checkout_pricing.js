// backend/src/utils/checkout_pricing.js
// =======================================================
// ✅ 全站统一结算（算法与前端一致）
// - 特价：N for $X
// - ✅ 单件特价：salePrice / promoPrice / discountPrice / specialPrice(兼容)
// - 运费：按 mode
// - 税：NY 才收（默认 0.08875，可覆盖）
// - 押金：deposit * qty * unitCount（或前端 override 总额）
// - 小费：tip
// - 平台费：Stripe 渠道 = $0.50 + 2% * subtotal；钱包 = 0
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

/**
 * ✅ 取“单件有效价”（支持单件特价）
 * 优先级：
 * 1) salePrice / promoPrice / discountPrice / specialUnitPrice
 * 2) specialPrice（仅当不是 N for X 时才当单件特价，避免误判）
 * 3) priceNum / price
 */
export function getEffectiveUnitPrice(it) {
  const basePrice = safeNum(it?.priceNum ?? it?.price, 0);

  // 第一梯队：明确语义的单件特价字段
  const saleCandidate = safeNum(
    it?.salePrice ?? it?.promoPrice ?? it?.discountPrice ?? it?.specialUnitPrice ?? NaN,
    NaN
  );

  if (Number.isFinite(saleCandidate) && saleCandidate > 0 && saleCandidate < basePrice) {
    return saleCandidate;
  }

  // 第二梯队：specialPrice 兼容（⚠️ 注意：specialPrice 很多人用来表示“单件特价”，
  // 但也有人用来表示“N for X 的总价”。为了不串，我们只在“不是 N for X”时把它当单件特价）
  const hasGroupDeal =
    safeNum(it?.specialQty ?? it?.specialN ?? it?.specialCount ?? it?.dealQty, 0) > 0 &&
    safeNum(it?.specialTotalPrice ?? it?.specialTotal ?? it?.dealTotalPrice ?? it?.dealPrice, 0) >
      0;

  if (!hasGroupDeal) {
    const sp = safeNum(it?.specialPrice ?? NaN, NaN);
    if (Number.isFinite(sp) && sp > 0 && sp < basePrice) return sp;
  }

  return basePrice;
}

// ✅ 特价：N for $X 行小计（前端口径） + ✅ 单件特价
export function calcSpecialLineTotal(it, qty) {
  const q = Math.max(0, Math.floor(safeNum(qty, 0)));
  if (!it || q <= 0) return 0;

  const unitPrice = getEffectiveUnitPrice(it);

  const specialQty = safeNum(
    it.specialQty ?? it.specialN ?? it.specialCount ?? it.dealQty,
    0
  );

  // ✅ 这里“只认” group total 的字段，不再把 specialPrice 塞进来
  const specialTotalPrice = safeNum(
    it.specialTotalPrice ?? it.specialTotal ?? it.dealTotalPrice ?? it.dealPrice,
    0
  );

  if (specialQty > 0 && specialTotalPrice > 0 && q >= specialQty) {
    const groups = Math.floor(q / specialQty);
    const remainder = q % specialQty;
    return round2(groups * specialTotalPrice + remainder * unitPrice);
  }

  return round2(q * unitPrice);
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

    // ✅ Debug（你需要时就看这些字段有没有带到）
    console.log("🧮 PRICING ITEM", {
      name: it?.name,
      qty,
      basePrice: it?.priceNum ?? it?.price,
      // 单件特价字段
      salePrice: it?.salePrice,
      promoPrice: it?.promoPrice,
      discountPrice: it?.discountPrice,
      specialPrice: it?.specialPrice,
      // N for X 字段
      specialQty: it?.specialQty ?? it?.specialN ?? it?.specialCount ?? it?.dealQty,
      specialTotalPrice:
        it?.specialTotalPrice ?? it?.specialTotal ?? it?.dealTotalPrice ?? it?.dealPrice,
      effectiveUnitPrice: getEffectiveUnitPrice(it),
      lineTotal: calcSpecialLineTotal(it, qty),
    });

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
    : shipState === "NY"
      ? taxRateNY
      : 0;

  const salesTax = round2(taxableSubtotal * taxRate);

  // 5) deposit（支持前端 override：pricing.bottleDeposit）
  const depositOverrideRaw =
    payload?.pricing?.bottleDeposit ??
    payload?.pricing?.depositTotal ??
    payload?.pricing?.deposit ??
    payload?.bottleDeposit ??
    payload?.depositTotal ??
    payload?.deposit;

  const depositOverride = safeNum(depositOverrideRaw, NaN);

  const depositTotal =
    Number.isFinite(depositOverride) && depositOverride > 0
      ? round2(depositOverride)
      : computeDepositTotal(items);

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

  // 7) platform fee（Stripe：每单 0.5 + 2% * subtotal；Wallet：0）
  const payChannel = options.payChannel === "wallet" ? "wallet" : "stripe";
  const platformRate = safeNum(options.platformRate, 0.02);
  const platformFixed = safeNum(options.platformFixed, 0.5);

  const platformFee =
    payChannel === "stripe" ? Math.max(0, round2(platformFixed + subtotal * platformRate)) : 0;

  // 8) total
  const totalAmount = round2(subtotal + shipping + salesTax + depositTotal + tipFee + platformFee);

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
