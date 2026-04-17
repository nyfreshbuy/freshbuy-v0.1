import mongoose from "mongoose";

const leaderPickupChangeRequestSchema = new mongoose.Schema(
  {
    leaderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    requestType: {
      type: String,
      enum: ["add", "edit"],
      default: "add",
      required: true
    },

    pickupPointId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PickupPoint",
      default: null,
      index: true
    },

    submittedData: {
      name: { type: String, default: "" },
      contactName: { type: String, default: "" },
      contactPhone: { type: String, default: "" },

      addressLine1: { type: String, default: "" },
      addressLine2: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "NY" },
      zip: { type: String, default: "" },
      fullAddress: { type: String, default: "" },

      displayArea: { type: String, default: "" },
      nearStreet: { type: String, default: "" },
      maskedAddress: { type: String, default: "" },

      lat: { type: Number, default: null },
      lng: { type: Number, default: null },

      pickupTimeText: { type: String, default: "" },
      businessHours: [
        {
          day: { type: Number, default: 0 },
          open: { type: String, default: "" },
          close: { type: String, default: "" },
          closed: { type: Boolean, default: false }
        }
      ]
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },

    leaderRemark: { type: String, default: "" },
    adminRemark: { type: String, default: "" },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

export default mongoose.model(
  "LeaderPickupChangeRequest",
  leaderPickupChangeRequestSchema
);