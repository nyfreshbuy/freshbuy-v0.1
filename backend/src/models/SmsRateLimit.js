// backend/src/models/SmsRateLimit.js
import mongoose from "mongoose";

const SmsRateLimitSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },

    // 当天窗口开始时间（当天 00:00）
    dayStart: { type: Date, required: true, index: true },

    // 当天已发送次数
    count: { type: Number, default: 0 },

    // TTL 过期时间（到次日 00:00 自动清理）
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },

    // 最后一次发送时间（用于 60 秒冷却，跨实例也有效）
    lastSendAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// 同一个号码 + 同一天 唯一
SmsRateLimitSchema.index({ phone: 1, dayStart: 1 }, { unique: true });

export default mongoose.model("SmsRateLimit", SmsRateLimitSchema);
