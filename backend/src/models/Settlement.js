import mongoose from "mongoose";

const settlementSchema = new mongoose.Schema(
  {
    // 结算类型
    type: {
      type: String,
      enum: ["driver", "leader", "platform"],
      required: true,
    },

    // 关联对象
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    leaderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // 结算周期
    periodStart: Date,
    periodEnd: Date,

    // 订单汇总
    orderCount: { type: Number, default: 0 },
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],

    // 金额
    income: Number,     // 应收
    cost: Number,       // 成本
    payout: Number,     // 实付（司机 / 团长）
    platformProfit: Number,

    // 状态
    status: {
      type: String,
      enum: ["pending", "confirmed", "paid"],
      default: "pending",
    },

    // 审计
    note: String,
    generatedBy: String, // admin email / system
  },
  { timestamps: true }
);

export default mongoose.model("Settlement", settlementSchema);
