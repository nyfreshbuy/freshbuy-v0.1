// backend/src/models/Banner.js
import mongoose from "mongoose";

const bannerButtonSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    link: { type: String, default: "" },
  },
  { _id: false }
);

const bannerSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // 例如：homepage_main
    enabled: { type: Boolean, default: true },

    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },

    // 纯色背景（你截图里的绿色就是这个）
    bgColor: { type: String, default: "#22c55e" },

    // 可选：背景图（如果填了，就优先显示图）
    imageUrl: { type: String, default: "" },

    // 按钮（最多建议 4~6 个）
    buttons: { type: [bannerButtonSchema], default: [] },

    // 可选：排序/版本
    sort: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.Banner || mongoose.model("Banner", bannerSchema);
