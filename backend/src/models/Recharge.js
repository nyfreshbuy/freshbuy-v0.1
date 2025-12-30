// backend/src/models/Recharge.js
import mongoose from "mongoose";

/**
 * 小工具：把各种输入安全转成 Number
 * - "5" -> 5
 * - ""/null/undefined -> 0
 * - NaN -> 0
 */
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const RechargeSchema = new mongoose.Schema(
  {
    // 关联用户
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 用户手机号（强烈建议存一份：方便后台按 phone 搜）
    phone: {
      type: String,
      default: "",
      index: true,
    },

    // 充值金额
    amount: {
      type: Number,
      required: true,
      min: 0,
      set: toNumber,
    },

    // 赠送/奖励（建议 Number）
    bonus: {
      type: Number,
      default: 0,
      min: 0,
      set: toNumber,
    },

    /**
     * 支付方式
     * - test: 测试/手动
     * - admin: 后台手动充值
     * - stripe: Stripe
     * - zelle/cashapp/wechat: 预留
     */
    payMethod: {
      type: String,
      default: "test",
      index: true,
    },

    /**
     * 状态
     * - pending: 待确认（如 stripe 创建中）
     * - done/success: 成功（你现在用 done 也行）
     * - failed: 失败
     * - refunded: 已退款
     */
    status: {
      type: String,
      default: "done",
      index: true,
    },

    // 备注（对账很有用）
    remark: {
      type: String,
      default: "",
    },

    // 外部交易号（Stripe PaymentIntent / Charge id 等）
    externalId: {
      type: String,
      default: "",
      index: true,
    },

    // 操作者（后台充值时记录 adminId；用户充值可为空）
    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

/**
 * ✅ 常用复合索引：后台列表/用户记录都会用到
 * userId + createdAt：查“我的充值记录”最快
 */
RechargeSchema.index({ userId: 1, createdAt: -1 });

/**
 * phone + createdAt：后台按手机号查充值记录
 */
RechargeSchema.index({ phone: 1, createdAt: -1 });

export default mongoose.models.Recharge || mongoose.model("Recharge", RechargeSchema);
