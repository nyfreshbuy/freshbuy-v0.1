// backend/src/models/user.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ROLE_ENUM = ["customer", "leader", "driver", "admin"];

const phoneNormalize = (v) => (v || "").replace(/[^\d]/g, "");

// ✅ 统一把文档转 JSON 时去掉 password（防止 select:false 被意外覆盖时泄露）
function removeSensitive(doc, ret) {
  delete ret.password;
  return ret;
}

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },

    contactName: { type: String, default: "" },
    contactPhone: { type: String, default: "", set: phoneNormalize },

    // 你原来只有 addressLine，这里建议继续保留
    addressLine: { type: String, default: "" },

    // ✅ 新增：州（美国必需）
    state: { type: String, default: "" },

    city: { type: String, default: "" },
    zip: { type: String, default: "" },

    // ✅ 新增：地址验证后的标准化地址/PlaceId（可选）
    formattedAddress: { type: String, default: "" },
    placeId: { type: String, default: "" },

    // ✅ 新增：坐标（后台路线排序要用）
    lat: { type: Number },
    lng: { type: Number },

    isDefault: { type: Boolean, default: false },
  },
  {
    // ✅ 关键：不要 _id:false（否则无法精确更新某条地址）
    // 旧数据不会受影响；新写入会自动带 _id
    _id: true,
    timestamps: true,
  }
);

// ✅ 账号设置（Account Settings）
const accountSettingsSchema = new mongoose.Schema(
  {
    // 用户展示用昵称（不影响登录）
    displayName: { type: String, trim: true, default: "" },

    // 头像（url）
    avatar: { type: String, default: "" },

    // 默认配送方式偏好（给你后面：上门/区域团/自提 做入口）
    defaultDeliveryMode: {
      type: String,
      enum: ["home", "group", "pickup"],
      default: "home",
    },

    // 默认地址：建议存 addresses 里的索引/标识（不重复存地址文本）
    // 你现有 addresses 用 isDefault 标记也行；这里是给前端“偏好选择”一个稳定指针
    defaultAddressIndex: { type: Number, default: -1 }, // -1 表示未指定

    // 通知偏好（后面接 Twilio / Email 时直接用）
    notifications: {
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
    },

    // 语言
    language: { type: String, enum: ["zh", "en"], default: "zh" },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 30,
    },

    // ✅ 只能手机号注册/登录
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      set: phoneNormalize,
      validate: {
        validator: (v) => /^\d{10,15}$/.test(v),
        message: "Invalid phone number",
      },
      index: true,
    },

    // ✅ 存储哈希后的密码（字段名仍叫 password，兼容你当前代码）
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false, // 默认查询不返回
    },

    role: {
      type: String,
      enum: ROLE_ENUM,
      default: "customer",
      index: true,
    },

    // =========================
    // ✅ 账号设置（接 DB 就放这里）
    // =========================
    accountSettings: {
      type: accountSettingsSchema,
      default: () => ({}),
    },

    // =========================
    // 🚚 司机资料（仅 role=driver 使用）
    // =========================
    driverProfile: {
      carType: { type: String, default: "" }, // 轿车 / SUV / 面包车
      plate: { type: String, default: "" }, // 车牌
      zone: { type: String, default: "" }, // 负责区域
      status: { type: String, default: "offline" }, // online / offline / suspended
      todayOrders: { type: Number, default: 0 },
      totalOrders: { type: Number, default: 0 },
      rating: { type: Number, default: 0 },
    },

    walletBalance: { type: Number, default: 0, min: 0 },
    totalRecharge: { type: Number, default: 0, min: 0 },

    // ✅ 账号可用状态
    isActive: { type: Boolean, default: true, index: true },

    // ✅ 地址簿
    addresses: { type: [addressSchema], default: [] },
  },
  {
    timestamps: true,

    // ✅ 关键：开启 virtuals（这样 JSON 里会出现 defaultAddress）
    toJSON: { transform: removeSensitive, virtuals: true },
    toObject: { transform: removeSensitive, virtuals: true },
  }
);

/**
 * ✅ 计算默认地址（不重复存一份）
 * 优先级：
 * 1) addresses 里 isDefault=true 的那条
 * 2) accountSettings.defaultAddressIndex 指向的那条
 * 3) 没有则 null
 */
userSchema.virtual("defaultAddress").get(function () {
  const list = Array.isArray(this.addresses) ? this.addresses : [];

  const byFlag = list.find((a) => a && a.isDefault);
  if (byFlag) return byFlag;

  const idx = this.accountSettings?.defaultAddressIndex;
  if (typeof idx === "number" && idx >= 0 && idx < list.length) return list[idx];

  return null;
});

// =====================================================
// 密码加密工具：避免重复 hash
// - bcrypt hash 通常以 $2a$ / $2b$ / $2y$ 开头，长度约 60
// =====================================================
function looksLikeBcryptHash(s) {
  return typeof s === "string" && s.startsWith("$2") && s.length >= 55;
}

// ✅ 保存时加密（create/save 会触发）
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  // 避免重复 hash（比如你手动写入了已加密密码）
  if (looksLikeBcryptHash(this.password)) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(String(this.password), salt);
});

// ✅ 更新类操作也要加密：findOneAndUpdate / updateOne / updateMany
// ⚠️ 这里用 async middleware：不要 next()，不要参数 next
async function hashPasswordInQueryUpdate() {
  const update = this.getUpdate() || {};

  // 兼容：{ password } / { $set: { password } }
  const pwd = update.password || (update.$set && update.$set.password);

  if (!pwd) return;

  // 避免重复 hash（比如路由里已经 bcrypt.hash 过）
  if (looksLikeBcryptHash(pwd)) return;

  const hashed = await bcrypt.hash(String(pwd), 10);

  if (update.password) update.password = hashed;
  if (update.$set && update.$set.password) update.$set.password = hashed;

  this.setUpdate(update);
}

userSchema.pre("findOneAndUpdate", hashPasswordInQueryUpdate);
userSchema.pre("updateOne", hashPasswordInQueryUpdate);
userSchema.pre("updateMany", hashPasswordInQueryUpdate);

// ✅ 密码对比：登录时用（注意登录查询要 .select('+password')）
userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(String(plain), this.password);
};

export default mongoose.models.User || mongoose.model("User", userSchema);
