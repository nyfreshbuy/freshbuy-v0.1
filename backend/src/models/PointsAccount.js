import mongoose from "mongoose";

const pointsAccountSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    points: { type: Number, default: 0 },
    logs: {
      type: [
        {
          amount: Number,
          type: { type: String, enum: ["earn", "use"] },
          remark: String,
          time: String,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model("PointsAccount", pointsAccountSchema);
