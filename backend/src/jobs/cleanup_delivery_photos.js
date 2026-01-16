import fs from "fs";
import path from "path";
import Order from "../models/order.js";

/**
 * 清理超过 N 天的送达照片
 * @param {number} keepDays 保留天数（比如 14）
 */
export async function cleanupDeliveryPhotos(keepDays = 14) {
  const before = new Date();
  before.setDate(before.getDate() - keepDays);

  console.log(
    `🧹 cleanupDeliveryPhotos: deleting proof photos before ${before.toISOString()}`
  );

  // 只找“有送达照片”的订单
  const orders = await Order.find({
    proofPhotos: { $exists: true, $ne: [] },
  });

  for (const o of orders) {
    const remain = [];
    const removed = [];

    for (const p of o.proofPhotos) {
      if (!p?.uploadedAt) {
        remain.push(p);
        continue;
      }

      if (new Date(p.uploadedAt) < before) {
        removed.push(p);
      } else {
        remain.push(p);
      }
    }

    // 没有要删的，跳过
    if (!removed.length) continue;

    // 1️⃣ 删除磁盘文件
    for (const p of removed) {
      try {
        if (p.url && p.url.startsWith("/uploads/")) {
          const filePath = path.resolve(p.url.replace(/^\//, ""));
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log("🗑️ deleted file:", filePath);
          }
        }
      } catch (err) {
        console.error("❌ delete file failed:", p.url, err.message);
      }
    }

    // 2️⃣ 更新数据库（移除记录）
    o.proofPhotos = remain;
    await o.save();

    console.log(
      `🧾 order ${o._id}: removed ${removed.length} expired proof photos`
    );
  }
}
