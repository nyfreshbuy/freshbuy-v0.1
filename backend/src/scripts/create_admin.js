// backend/src/scripts/create_admin.js
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import { connectDB } from "../db.js";

async function run() {
  await connectDB();

  const phone = "7184195531";
  const password = "1234567";

  const exists = await User.findOne({ phone });
  if (exists) {
    console.log("❗ admin 已存在：", phone);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);

  const admin = await User.create({
    name: "Admin",
    phone,
    role: "admin",
    status: "active",
    isActive: true,
    password: hash,
  });

  console.log("✅ admin 创建成功");
  console.log({
    phone,
    password,
    id: admin._id.toString(),
  });

  process.exit(0);
}

run().catch(err => {
  console.error("❌ 创建 admin 失败:", err);
  process.exit(1);
});
