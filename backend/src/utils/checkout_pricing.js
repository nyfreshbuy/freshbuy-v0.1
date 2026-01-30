// backend/src/utils/checkout_pricing.js
// =======================================================
// ✅ 全站统一结算（算法与前端一致）
//
// - 特价：同一套字段支持：
//    * N=1  => 单件特价（单价 = specialTotalPrice）
//    * N>=2 => N for $X（买够 N 才触发；remainder 按原价）
//
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
 * ✅ 从任意来源提取“特价字段”（兼容你项目里各种命名）
 * @returns { specialQty, specialTotalPrice }
 */
export function getSpecialFields(src = {}) {
  const specialQty = safeNum(
    src.specialQty ?? src.specialN ?? src.specialCount ?? src.dealQty ?? 0,
    0
  );

  const specialTotalPrice = safeNum(
    src.specialTotalPrice ??
      src.specialTotal ??
      src.specialPrice ?? // 某些数据会这么叫
      src.dealTotalPrice ??
      src.dealPrice ??
      0,
    0
  );

  return { specialQty, specialTotalPrice };
}

/**
 * ✅ 把 DB 的特价覆盖/补全到 item 上（解决：前端 payload 没带特价字段导致后端算价不生效）
 *
 * 用法（在 orders.js 拿到 product 后）：
 *   applyDbSpecialToItem(item, productOrVariant)
 *
 * 规则：
 * - item 已经带了 specialQty/specialTotalPrice 且 >0：尊重 item（前端明确传了）
 * - 否则用 db 的 special
 * - 特别支持：db specialQty=1 时，补全到 item（单件特价）
 */
export function applyDbSpecialToItem(item = {}, dbSource = {}) {
  if (!item || typeof item !== "object") return item;

  const itSp = getSpecialFields(item);
  const dbSp = getSpecialFields(dbSource);

  const itemHasSpecial = itSp.specialQty > 0 && itSp.specialTotalPrice > 0;
  const dbHasSpecial = dbSp.specialQty > 0 && dbSp.specialTotalPrice > 0;

  if (!itemHasSpecial && dbHasSpecial) {
    item.specialQty = dbSp.specialQty;
    item.specialTotalPrice = dbSp.specialTotalPrice;
  }

  // 统一回写，避免后面 calcSpecialLineTotal 读不到
  const finalSp = getSpecialFields(item);
  item.specialQty = finalSp.specialQty;
  item.specialTotalPrice = finalSp.specialTotalPrice;

  return item;
}

/**
 * ✅ 特价：N for $X 行小计（支持 N=1 单件特价 + N>=2 多件特价）
 * 规则：
 * - specialQty = 1：单个就特价（单价 = specialTotalPrice）
 * - specialQty >= 2：买够 N 才触发组价；remainder 按原价 basePrice
 */
export function calcSpecialLineTotal(it, qty) {
  const q = Math.max(0, Math.floor(safeNum(qty, 0)));
  if (!it || q <= 0) return 0;

  const basePrice = safeNum(it.priceNum ?? it.price ?? it.basePrice, 0);

  const { specialQty, specialTotalPrice } = getSpecialFields(it);

  // ✅ 1 for X：单件特价（立刻生效）
  if (specialQty === 1 && specialTotalPrice > 0) {
    return round2(q * specialTotalPrice);
  }

  // ✅ N for X（N>=2）：必须买够 N 才触发；多出来的按原价
  if (specialQty >= 2 && specialTotalPrice > 0 && q >= specialQty) {
    const groups = Math.floor(q / specialQty);
    const remainder = q % specialQty;
    return round2(groups * specialTotalPrice + remainder * basePrice);
  }

  // ✅ 无特价：原价
  return round2(q * basePrice);
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
 * @param options { payChannel, taxRateNY, platformRate, platformFixed, debug }
 */
export function computeTotalsFromPayload(payload = {}, options = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const ship = payload?.shipping || {};
  const debug = options?.debug === true;

  // 1) subtotal（特价口径）
  let subtotal = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.floor(safeNum(it.qty, 1)));

    if (debug) {
      const { specialQty, specialTotalPrice } = getSpecialFields(it);
      console.log("🧮 PRICING ITEM", {
        name: it?.name,
        qty,
        basePrice: it?.priceNum ?? it?.price,
        specialQty,
        specialTotalPrice,
        lineTotal: calcSpecialLineTotal(it, qty),
      });
    }

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

  // 5) deposit（支持前端直接传“押金总额” override：pricing.bottleDeposit）
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
