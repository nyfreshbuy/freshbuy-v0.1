// backend/src/models/user.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ROLE_ENUM = ["customer", "leader", "driver", "admin"];

const phoneNormalize = (v) => (v || "").replace(/[^\d]/g, "");

// ✅ 统一把文档转 JSON 时去掉敏感字段
function removeSensitive(doc, ret) {
  delete ret.password; // select:false 之外再兜底
  return ret;
}

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },

    contactName: { type: String, default: "" },
    contactPhone: { type: String, default: "", set: phoneNormalize },

    addressLine: { type: String, default: "" },

    // ✅ 新增：州（美国必需）
    state: { type: String, default: "" },

    city: { type: String, default: "" },
    zip: { type: String, default: "" },

    formattedAddress: { type: String, default: "" },
    placeId: { type: String, default: "" },

    lat: { type: Number },
    lng: { type: Number },

    isDefault: { type: Boolean, default: false },
  },
  {
    _id: true,
    timestamps: true,
  }
);

// ✅ 账号设置（Account Settings）
const accountSettingsSchema = new mongoose.Schema(
  {
    displayName: { type: String, trim: true, default: "" },
    avatar: { type: String, default: "" },

    defaultDeliveryMode: {
      type: String,
      enum: ["home", "group", "pickup"],
      default: "home",
    },

    defaultAddressIndex: { type: Number, default: -1 },

    notifications: {
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
    },

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

    /**
     * ✅ 存储哈希后的密码（字段名仍叫 password，兼容你当前代码）
     * ✅ 改动点：不再 required:true，允许短信登录用户初始没有密码
     * - 默认空字符串
     * - minlength 不再强制（否则空字符串会报错），改为自定义 validator：有值才校验长度
     */
    password: {
      type: String,
      default: "",
      select: false,
      validate: {
        validator: (v) => {
          // 允许空（未设置密码）
          if (v === undefined || v === null) return true;
          const s = String(v);
          if (!s.length) return true;
          // 有值时才要求 >= 6（注意：这里是明文阶段的校验；哈希保存后长度更长也没问题）
          return s.length >= 6 || (s.startsWith("$2") && s.length >= 55); // bcrypt hash 放行
        },
        message: "Password must be at least 6 characters",
      },
    },

    role: {
      type: String,
      enum: ROLE_ENUM,
      default: "customer",
      index: true,
    },

    // =========================
    // ✅ 账号设置
    // =========================
    accountSettings: {
      type: accountSettingsSchema,
      default: () => ({}),
    },

    // =========================
    // 🚚 司机资料
    // =========================
    driverProfile: {
      carType: { type: String, default: "" },
      plate: { type: String, default: "" },
      zone: { type: String, default: "" },
      status: { type: String, default: "offline" },
      todayOrders: { type: Number, default: 0 },
      totalOrders: { type: Number, default: 0 },
      rating: { type: Number, default: 0 },
    },

    walletBalance: { type: Number, default: 0, min: 0 },
    totalRecharge: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true, index: true },

    addresses: { type: [addressSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: { transform: removeSensitive, virtuals: true },
    toObject: { transform: removeSensitive, virtuals: true },
  }
);

/**
 * ✅ 计算默认地址（不重复存一份）
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
// =====================================================
function looksLikeBcryptHash(s) {
  return typeof s === "string" && s.startsWith("$2") && s.length >= 55;
}

// ✅ 保存时加密（create/save 会触发）
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  // ✅ 允许未设置密码（空字符串）直接保存，不做 hash
  if (!this.password) return;

  // 避免重复 hash
  if (looksLikeBcryptHash(this.password)) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(String(this.password), salt);
});

// ✅ 更新类操作也要加密：findOneAndUpdate / updateOne / updateMany
async function hashPasswordInQueryUpdate() {
  const update = this.getUpdate() || {};

  const pwd = update.password || (update.$set && update.$set.password);
  if (pwd === undefined) return;

  // ✅ 允许把密码设置为空（例如你未来做“清除密码/只短信登录”），直接写空不 hash
  if (!pwd) return;

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
  // ✅ 没设置过密码
  if (!this.password) return false;
  return bcrypt.compare(String(plain), this.password);
};

export default mongoose.models.User || mongoose.model("User", userSchema);
