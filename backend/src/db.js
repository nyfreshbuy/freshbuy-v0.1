import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("❌ Missing MONGODB_URI in .env");

  console.log("⏳ Connecting MongoDB...");

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
    });

    console.log("✅ MongoDB connected");
    console.log("🔎 Mongo host :", mongoose.connection.host);
    console.log("🔎 Mongo db   :", mongoose.connection.name);

    const safeUri = uri.includes("@") ? uri.split("@")[1] : uri;
    console.log("🔎 Mongo uri  :", safeUri);
  } catch (err) {
    console.error("❌ MongoDB connect failed:", err?.message || err);
    throw err;
  }
}
