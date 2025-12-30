import mongoose from "mongoose";

const driverSchema = new mongoose.Schema(
  {
    // 绑定登录用户（你的 User 表，role=driver）
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

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

    // 分配的配送区域（你可以用 zoneId 或 zoneKey）
    zones: [
      {
        zoneId: { type: String, trim: true }, // 例如 "zone_freshmeadows"
        zoneName: { type: String, trim: true },
      },
    ],

    // 每日容量（限制最多可派多少单/多少路线）
    dailyCapacity: { type: Number, default: 60 },
    todayAssignedCount: { type: Number, default: 0 },
    // 今日统计对应的日期(用于自动重置 todayAssignedCount)
    todayDate: {
     type: String, // 例如 "2025-01-13"
    },
    // 当前位置（可选：司机端上报）
    lastLocation: {
      lat: { type: Number },
      lng: { type: Number },
      address: { type: String, trim: true },
      updatedAt: { type: Date },
    },

    // 车辆信息（可选）
    vehicle: {
      type: { type: String, trim: true }, // sedan/suv/van
      plate: { type: String, trim: true },
    },

    // 统计（可选）
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

driverSchema.index({ status: 1, workingState: 1 });
driverSchema.index({ "zones.zoneId": 1 });

export default mongoose.model("Driver", driverSchema);
