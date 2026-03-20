import mongoose from "mongoose";

const pickupPointSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },

    // 基本信息
    name: { type: String, default: "" },          // 例如 Fresh Meadows 自提点
    code: { type: String, default: "" },          // 例如 FM01
    note: { type: String, default: "" },

    // 团长信息
    leaderName: { type: String, default: "" },
    leaderPhone: { type: String, default: "" },
    leaderUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // 真实地址（后台保存）
    addressLine1: { type: String, default: "" },  // 120-35 Union St
    addressLine2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "NY" },
    zip: { type: String, default: "" },

    // 前台展示地址
    displayArea: { type: String, default: "" },   // Fresh Meadows
    nearStreet: { type: String, default: "" },    // 58 Ave
    maskedAddress: { type: String, default: "" }, // Union St 120-**（近 58 Ave）

    // 坐标
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },

    // 规则
    serviceZips: { type: [String], default: [] },
    pickupTimeText: { type: String, default: "" },  // 周六 2PM-6PM
    minOrderAmount: { type: Number, default: 0 },
    pickupFee: { type: Number, default: 0 },

    // 是否下单后显示完整地址
    revealFullAddressAfterOrder: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("PickupPoint", pickupPointSchema);