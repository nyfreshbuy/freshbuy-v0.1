// backend/src/utils/leaderCommission.js
// =======================================================
// ✅ 团长佣金计算（与后端结算口径一致）
//
// 关键点：
// 1) 必须用 calcSpecialLineTotal(it, qty) 计算“成交行金额”
//    - 支持 1 for X / N for $X
// 2) 爆品：优先用 orders.js 里算出来的 hotFlag（后端权威）
// 3) 支持按 item/订单维度返回 breakdown，方便你做结算单
// =======================================================

import { calcSpecialLineTotal } from "./checkout_pricing.js";

/**
 * ✅ 单品佣金比例（按 item 决定）
 * 规则建议：
 * - hotFlag=true => 0%
 * - 可再加：高毛利类目/标签 => 8%
 * - 默认 => 5%
 */
export function calcLeaderCommissionRateByItem(item = {}) {
  // ✅ 爆品：0%
  if (item.hotFlag === true) return 0;

  // 兼容旧字段（如果你某些地方还没写 hotFlag）
  if (item.isHot === true || item.isSpecial === true) return 0;
  const tag = String(item.tag || "");
  if (tag.includes("爆品") || tag.includes("爆品日")) return 0;

  // ✅ 高毛利：8%（你可以按实际类目/标签改）
  const category = String(item.category || "");
  if (category.includes("高毛利") || tag.includes("高毛利")) return 0.08;

  // ✅ 常规：5%
  return 0.05;
}

/**
 * ✅ 计算单个 item 的佣金（返回行成交额、比例、佣金）
 */
export function calcLeaderCommissionForItem(item = {}) {
  const qty = Math.max(0, Math.floor(Number(item.qty || 0)));
  if (qty <= 0) {
    return { lineTotal: 0, rate: 0, commission: 0 };
  }

  // ✅ 与订单结算一致：行成交额（已经包含特价规则）
  const lineTotal = calcSpecialLineTotal(item, qty); // 已 round2

  const rate = calcLeaderCommissionRateByItem(item);
  const commission = Math.round(lineTotal * rate * 100) / 100;

  return { lineTotal, rate, commission };
}

/**
 * ✅ 从订单计算总佣金（含 breakdown）
 * @returns { amount, breakdown, rateHint }
 */
export function calcLeaderCommissionFromOrder(order = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];

  let amount = 0;
  const breakdown = [];

  for (const it of items) {
    const r = calcLeaderCommissionForItem(it);
    amount += r.commission;

    breakdown.push({
      name: it.name || "",
      sku: it.sku || "",
      qty: Number(it.qty || 0),
      price: Number(it.price ?? it.priceNum ?? 0),
      specialQty: Number(it.specialQty || 0),
      specialTotalPrice: Number(it.specialTotalPrice || 0),
      hotFlag: it.hotFlag === true,

      lineTotal: r.lineTotal,
      rate: r.rate,
      commission: r.commission,
    });
  }

  amount = Math.round(amount * 100) / 100;

  // 给一个“提示比例”（方便后台展示，不用于结算）
  const sales = breakdown.reduce((s, x) => s + (Number(x.lineTotal) || 0), 0);
  const rateHint = sales > 0 ? Math.round((amount / sales) * 10000) / 10000 : 0;

  return { amount, breakdown, rateHint };
}