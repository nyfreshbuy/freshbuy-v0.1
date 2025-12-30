import mongoose from "mongoose";

const driverProfileSchema = new mongoose.Schema(
  {
    driverUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },

    origin: {
      address: { type: String, default: "" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);

export default mongoose.model("DriverProfile", driverProfileSchema);
