// backend/src/models/Zone.js
import mongoose from "mongoose";

const zoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // ✅ 关键：Zip 白名单（字符串数组，统一存 5 位）
    zipWhitelist: { type: [String], default: [] },

    // 你后续配送规则可继续往这里扩展（可选）
    deliveryModes: { type: [String], default: [] }, // ["groupDay","normal"]
    cutoffTime: { type: String, default: "" }, // "22:00"
    deliveryDays: { type: [String], default: [] }, // ["Thu","Sun"]
    note: { type: String, default: "" },

    // 可选：polygon（后期再用）
    polygon: { type: Object, default: null },
  },
  { timestamps: true }
);

// ✅ 索引：按 zip 查 zone（加速 by-zip）
zoneSchema.index({ zipWhitelist: 1 });

export default mongoose.model("Zone", zoneSchema);
