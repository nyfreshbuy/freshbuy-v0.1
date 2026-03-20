import mongoose from "mongoose";

const TierSchema = new mongoose.Schema(
  {
    from: { type: Number, required: true },      // inclusive
    to: { type: Number, required: true },        // inclusive
    normalRate: { type: Number, required: true } // e.g. 0.06
  },
  { _id: false }
);

const CommissionConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },

    // ---------- 结算 ----------
    settleDays: { type: Number, default: 14 },

    // ---------- 客户现金充值赠送 ----------
    cashTopupBonusRate: { type: Number, default: 0.05 },

    // ---------- 自提团长费率 ----------
    hotRatePickup: { type: Number, default: 0.0 },        // 爆品自提佣金
    normalRatePickup: { type: Number, default: 0.06 },    // 非爆品自提佣金
    walletBonusPickup: { type: Number, default: 0.02 },   // 自提钱包额外佣金（建议仅非爆品）

    // ---------- 推荐团长费率 ----------
    hotRateRecommend: { type: Number, default: 0.0 },     // 爆品推荐佣金（通常0）
    walletBonusRecommend: { type: Number, default: 0.0 }, // 推荐钱包额外（你要区分就用这个）

    // 推荐递减阶梯：按【非自提有效订单】次数
    recommendTiers: {
      type: [TierSchema],
      default: [
        { from: 1, to: 3, normalRate: 0.06 },
        { from: 4, to: 10, normalRate: 0.03 },
        { from: 11, to: 999999, normalRate: 0.01 },
      ],
    },

    // ✅ 推荐团长独享窗口（前N单区域合伙人不拿服务费）
    recommendExclusiveFirstN: { type: Number, default: 10 },

    // ---------- 区域合伙人 ----------
    partnerServiceRateDefault: { type: Number, default: 0.015 }, // 1.5%
  },
  { timestamps: true }
);

CommissionConfigSchema.index({ enabled: 1, updatedAt: -1 });

export default mongoose.model("CommissionConfig", CommissionConfigSchema);