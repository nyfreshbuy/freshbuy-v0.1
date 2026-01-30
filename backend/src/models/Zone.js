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

    // =========================
    // ✅ 配送配置（给 admin_zones.js 用）
    // - deliveryDays: [0..6] 0=周日 ... 6=周六
    // - cutoffTime:  "23:59" 这种字符串
    // - deliveryModes: ["groupDay","normal"] 之类（可选）
    // =========================
    deliveryModes: { type: [String], default: [] },
    cutoffTime: { type: String, default: "" },
    deliveryDays: { type: [Number], default: [] },

    // =========================
    // ✅ 旧字段兼容（你 admin_zones.js 里 select 了）
    // =========================
    zoneId: { type: String, default: "" },
    slug: { type: String, default: "" },

    // =========================
    // 配送配置（区域团 / groupDay）
    // =========================
    groupDay: {
      enabled: { type: Boolean, default: false },
      // 0=周日 1=周一 ... 6=周六
      shipWeekday: { type: Number, default: null },
      // 预计送达时间
      etaStart: { type: String, default: "18:00" },
      etaEnd: { type: String, default: "22:00" },
      // 截单 = 配送日前 N 天（通常 1 天）
      cutoffOffsetDays: { type: Number, default: 1 },
    },

    // =========================
    // ✅ 成团展示（前台“已拼/还差”）
    // - fakeJoinedOrders: 虚假加成（存库）
    // - needOrders: 成团目标（存库）
    // =========================
    fakeJoinedOrders: { type: Number, default: 0 },
    needOrders: { type: Number, default: 50 },
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

  // ✅ 数字字段兜底（防止被字符串污染）
  this.fakeJoinedOrders = Number.isFinite(Number(this.fakeJoinedOrders))
    ? Number(this.fakeJoinedOrders)
    : 0;
  this.needOrders = Number.isFinite(Number(this.needOrders)) ? Number(this.needOrders) : 50;
});

const Zone = mongoose.models.Zone || mongoose.model("Zone", zoneSchema);
export default Zone;
