// backend/src/models/Zone.js
import mongoose from "mongoose";

const zoneSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    // 名称
    name: { type: String, default: "" },
    zoneName: { type: String, default: "" }, // 兼容旧字段

    // 备注
    note: { type: String, default: "" },
    zoneNote: { type: String, default: "" }, // 兼容旧字段

    // ZIP 白名单（主字段）
    zips: { type: [String], default: [] },

    // 兼容旧字段（如果你之前用过）
    zipWhitelist: { type: [String], default: [] },
    zipWhiteList: { type: [String], default: [] },
    zipList: { type: [String], default: [] },

    // 可选：polygon（如果你 admin_zones 画过）
    polygon: { type: Array, default: null }, // [[{lat,lng},...], ...] 或任意结构
    polygonPaths: { type: Array, default: null },
  },
  { timestamps: true }
);

// 让 zip 去重 + 规范化（只保留 5 位）
function normZip(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{5})/);
  return m ? m[1] : "";
}

zoneSchema.pre("save", function (next) {
  const merge = []
    .concat(this.zips || [])
    .concat(this.zipWhitelist || [])
    .concat(this.zipWhiteList || [])
    .concat(this.zipList || []);

  const cleaned = merge.map(normZip).filter(Boolean);
  const uniq = Array.from(new Set(cleaned));

  this.zips = uniq;
  // 兼容字段也同步（可选）
  this.zipWhitelist = uniq;
  this.zipWhiteList = uniq;
  this.zipList = uniq;

  next();
});

const Zone = mongoose.models.Zone || mongoose.model("Zone", zoneSchema);
export default Zone;
