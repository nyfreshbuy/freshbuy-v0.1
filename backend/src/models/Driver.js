import mongoose from "mongoose";

const driverSchema = new mongoose.Schema(
  {
    // 绑定登录用户（你的 User 表，role=driver）
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // =========================
    // ✅ 新增：司机密码（bcrypt hash）
    // - 不存明文
    // - 可用于 driver 直接登录
    // - 默认不返回（防止泄露）
    // =========================
    password: {
      type: String,
      select: false,
    },

    // 展示信息（可从 User 同步，也可独立维护）
    name: { type: String, trim: true },
    phone: { type: String, trim: true },

    // 状态
    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
      index: true,
    },

    // 司机在线/接单状态（派单时常用）
    workingState: {
      type: String,
      enum: ["offline", "online", "busy"],
      default: "offline",
      index: true,
    },

    // 分配的配送区域
    zones: [
      {
        zoneId: { type: String, trim: true },
        zoneName: { type: String, trim: true },
      },
    ],

    // 每日容量
    dailyCapacity: { type: Number, default: 60 },
    todayAssignedCount: { type: Number, default: 0 },
    todayDate: { type: String },

    // 当前位置
    lastLocation: {
      lat: Number,
      lng: Number,
      address: { type: String, trim: true },
      updatedAt: Date,
    },

    // 车辆信息
    vehicle: {
      type: { type: String, trim: true },
      plate: { type: String, trim: true },
    },

    // 统计
    stats: {
      totalDelivered: { type: Number, default: 0 },
      totalCanceled: { type: Number, default: 0 },
      ratingAvg: { type: Number, default: 5.0 },
      ratingCount: { type: Number, default: 0 },
    },

    note: { type: String, trim: true },
  },
  { timestamps: true }
);

// 索引
driverSchema.index({ status: 1, workingState: 1 });
driverSchema.index({ "zones.zoneId": 1 });

// ✅ 强制使用 drivers 集合（你已经写对）
export default mongoose.models.Driver ||
  mongoose.model("Driver", driverSchema, "drivers");
