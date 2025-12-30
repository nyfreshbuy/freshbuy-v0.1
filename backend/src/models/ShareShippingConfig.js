import mongoose from "mongoose";

const shareShippingConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "default" }, // 永远只有一条
    baseFee: { type: Number, default: 4.99 },
    expireMinutes: { type: Number, default: 15 },
    steps: {
      type: [
        {
          people: Number,
          price: Number,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model("ShareShippingConfig", shareShippingConfigSchema);
