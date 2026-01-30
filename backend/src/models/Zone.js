// backend/src/models/Zone.js
import mongoose from "mongoose";

const zoneSchema = new mongoose.Schema(
  {
    // 是否启用
    enabled: { type: Boolean, default: true },

    // 名称
    name: { type: String, default: "" },
    zoneName: { type: String, default: "" }, // 兼容旧字段

    // 备注
    note: { type: String, default: "" },
    zoneNote: { type: String, default: "" }, // 兼容旧字段

    // =========================
    // ZIP 白名单（主字段）
    // =========================
    zipWhitelist: { type: [String], default: [] },

    // =========================
    // 兼容旧字段（全部同步）
    // =========================
    zips: { type: [String], default: [] },
    zipWhiteList: { type: [String], default: [] },
    zipList: { type: [String], default: [] },

    // =========================
    // 可选：多边形（ZIP-only 模式下允许为 null）
    // =========================
    polygon: { type: Array, default: null },
    polygonPaths: { type: Array, default: null },
  },
  {
    timestamps: true,
  }
);

// =========================
// 工具：ZIP 规范化（只保留 5 位）
// =========================
function normalizeZip(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{5})/);
  return m ? m[1] : "";
}

// =========================
// ✅ 关键修复点：
// - 不使用 next()
// - 不使用 async
// - 使用 function() 保证 this 正确
// =========================
zoneSchema.pre("save", function () {
  const merged = []
    .concat(this.zipWhitelist || [])
    .concat(this.zips || [])
    .concat(this.zipWhiteList || [])
    .concat(this.zipList || []);

  const cleaned = merged.map(normalizeZip).filter(Boolean);
  const uniq = Array.from(new Set(cleaned));

  // 统一写回（主字段 + 兼容字段）
  this.zipWhitelist = uniq;
  this.zips = uniq;
  this.zipWhiteList = uniq;
  this.zipList = uniq;

  // 名称顺手 trim（安全）
  if (this.name) this.name = String(this.name).trim();
  if (this.zoneName) this.zoneName = String(this.zoneName).trim();
});

const Zone = mongoose.models.Zone || mongoose.model("Zone", zoneSchema);
export default Zone;
