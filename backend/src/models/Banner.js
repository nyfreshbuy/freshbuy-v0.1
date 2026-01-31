// backend/src/models/Banner.js
import mongoose from "mongoose";

// =========================
// 按钮（兼容你现在后台的 buttons JSON 数组）
// =========================
const bannerButtonSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    link: { type: String, default: "" }, // 可填：#锚点 /user/xxx.html / https://xxx
  },
  { _id: false }
);

// =========================
// ✅ 单张轮播图（slides）
// - 前台轮播用这个
// - 后台可以编辑多张
// =========================
const bannerSlideSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },

    // 图片 URL（建议用绝对/站内相对都行）
    // 例：/user/assets/images/banners/banner1.jpg
    // 例：https://xxx.com/banner.jpg
    imageUrl: { type: String, default: "" },

    // 点击跳转链接
    // 例：/user/newcomer.html
    // 例：https://nyfreshbuy.com/user/recharge.html
    link: { type: String, default: "" },

    // 可选：每张图可以有自己的文案（你要不用也没事）
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },

    // 可选：当图片为空时，用纯色兜底
    bgColor: { type: String, default: "" },
  },
  { _id: false }
);

// =========================
// Banner 主 Schema
// =========================
const bannerSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // 例如：homepage_main
    enabled: { type: Boolean, default: true },

    // ====== 单横幅（你现在后台正在编辑的这些字段） ======
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },

    // 纯色背景（你截图里的绿色就是这个）
    bgColor: { type: String, default: "#22c55e" },

    // 可选：背景图（如果填了，就优先显示图）
    imageUrl: { type: String, default: "" },

    // 按钮（最多建议 4~6 个）
    buttons: { type: [bannerButtonSchema], default: [] },

    // ====== ✅ 多张轮播（新增） ======
    // 前台轮播读取这里
    slides: { type: [bannerSlideSchema], default: [] },

    // 可选：排序/版本
    sort: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.Banner || mongoose.model("Banner", bannerSchema);
