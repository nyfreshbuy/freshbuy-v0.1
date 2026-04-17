import mongoose from "mongoose";

const pickupPointSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },

    // 基本信息
    name: { type: String, default: "" },
    code: { type: String, default: "" },
    note: { type: String, default: "" },

    // 团长信息
    leaderName: { type: String, default: "" },
    leaderPhone: { type: String, default: "" },
    leaderUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

    // 新增：状态
    status: {
      type: String,
      enum: ["active", "disabled", "pending"],
      default: "active",
      index: true
    },

    // 新增：联系人（和团长名字分开）
    contactName: { type: String, default: "" },
    contactPhone: { type: String, default: "" },

    // 真实地址（后台保存）
    addressLine1: { type: String, default: "" },
    addressLine2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "NY" },
    zip: { type: String, default: "" },

    // 新增：完整地址
    fullAddress: { type: String, default: "" },

    // 前台展示地址
    displayArea: { type: String, default: "" },
    nearStreet: { type: String, default: "" },
    maskedAddress: { type: String, default: "" },

    // 坐标
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },

    // 规则
    serviceZips: { type: [String], default: [] },
    pickupTimeText: { type: String, default: "" },
    minOrderAmount: { type: Number, default: 0 },
    pickupFee: { type: Number, default: 0 },

    // 新增：营业时间
    businessHours: [
      {
        day: { type: Number, default: 0 }, // 0-6
        open: { type: String, default: "" },
        close: { type: String, default: "" },
        closed: { type: Boolean, default: false }
      }
    ],

    // 是否下单后显示完整地址
    revealFullAddressAfterOrder: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("PickupPoint", pickupPointSchema);