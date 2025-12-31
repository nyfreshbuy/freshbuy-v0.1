// backend/src/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import * as url from "url";
import fs from "fs";
import multer from "multer";

import { connectDB } from "./db.js";
import authMongoRouter from "./routes/auth_mongo.js";

console.log("JWT_SECRET loaded?", !!process.env.JWT_SECRET);
console.log("ENV MONGODB_URI exists?", Boolean(process.env.MONGODB_URI));
console.log(
  "ENV MONGODB_URI host preview:",
  (process.env.MONGODB_URI || "").split("@")[1]?.split("/")[0]
);
console.log("🔥 当前运行的 server.js 来自 =====> ", url.fileURLToPath(import.meta.url));

import adminAuthRouter from "./routes/admin_auth.js";

// =======================
// 路由导入（非司机端部分）
// =======================
import publicZonesRouter from "./routes/public_zones.js";
import ordersRouter from "./routes/orders.js";
import adminRouter from "./routes/admin.js";
import walletRouter from "./routes/wallet.js";
import siteConfigRouter from "./routes/site_config.js";
import adminOrdersRouter from "./routes/admin_orders.js";
import adminProductsRouter from "./routes/admin_products.js";
import adminDriversRouter from "./routes/admin_drivers.js";
import adminUsersMongoRouter from "./routes/admin_users_mongo.js";
import order from "./models/order.js"; // 你原本就有（即使没用也不影响）
import adminMarketingRouter from "./routes/admin_marketing.js";
import adminSettlementsRouter from "./routes/admin_settlements.js";

import adminSettingsMemory from "./routes/admin_settings.js";
import adminDashboardrouter from "./routes/admin_dashboard.js";
import productsRouter from "./routes/products.js"; // 通用商品接口
import frontendProductsRouter from "./routes/frontendProducts.js"; // 前台首页专区接口
import categoriesRouter from "./routes/categories.js";

import driverRouter from "./routes/driver.js";
import driverOrdersRouter from "./routes/driver_orders.js"; // ✅ DB版司机订单路由

import addressesRouter from "./routes/addresses.js";
import rechargeRouter from "./routes/recharge.js";
import couponsRouter from "./routes/coupons.js";
import { requireAdmin } from "./middlewares/admin.js"; // 你原本就有（即使没用也不影响）
import adminZonesRouter from "./routes/admin_zones.js";
import authOtpRouter from "./routes/auth_otp.js";
import publicServiceRouter from "./routes/public_service.js";
import adminRechargeRouter from "./routes/admin_recharge.js";
import productsSimpleRouter from "./routes/products_simple.js";
import publicGeoRouter from "./routes/public_geo.js";
import geocodeRouter from "./routes/geocode.js";
import userMeRouter from "./routes/user_me.js";
import userProfileRouter from "./routes/user_profile.js";
import usersRouter from "./routes/users.js";
import paymentsRouter from "./routes/payments.js";
import zonesCheckRouter from "./routes/zones_check.js";
import adminDispatchRouter from "./routes/admin_dispatch.js";
import stripePayRouter from "./routes/pay_stripe.js";

// =======================
// ESM 环境下的 __dirname
// =======================
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🔥 admin_orders DB router loaded");

// =======================
// 创建 app
// =======================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =======================
// API 预挂载（你原本的顺序我尽量不动）
// =======================
app.use("/api/geocode", geocodeRouter);
console.log("✅ geocode 已挂载到 /api/geocode");

app.use("/api", productsSimpleRouter);
app.use("/api/zones", publicZonesRouter);
app.use("/api/public", publicGeoRouter);

app.use("/api/addresses", addressesRouter);
app.use("/api/recharge", rechargeRouter);
app.use("/api/coupons", couponsRouter);

app.use("/api/auth", authMongoRouter);
app.use("/api/auth-otp", authOtpRouter);

app.use("/api/public", publicServiceRouter);

app.use("/api/users", userProfileRouter);
app.use("/api/users", usersRouter);

app.use("/api/payments", paymentsRouter);
app.use("/api/pay/stripe", stripePayRouter);

app.use("/api/zones", zonesCheckRouter);
app.use("/api/user", userMeRouter);

// 通用中间件
app.use("/api/admin/dashboard", adminDashboardrouter);
app.use("/api/admin/zones", adminZonesRouter);
console.log("✅ admin_zones 已挂载到 /api/admin/zones");

// 司机基础信息路由（driver.js）
app.use("/api/driver", driverRouter);

// ✅ 司机订单（DB版）统一走这里
app.use("/api/driver/orders", driverOrdersRouter);

app.use("/api/admin/auth", adminAuthRouter);
console.log("✅ admin_auth 已挂载到 /api/admin/auth");

// =======================
// 司机端：照片上传配置（保留目录 + multer）
// =======================
app.use("/api/site-config", siteConfigRouter);

// 上传根目录：backend/uploads
const uploadsRoot = path.join(__dirname, "../uploads");
const deliveryPhotosDir = path.join(uploadsRoot, "delivery_photos");

app.use("/api/admin/dispatch", adminDispatchRouter);

// 确保目录存在
if (!fs.existsSync(deliveryPhotosDir)) {
  fs.mkdirSync(deliveryPhotosDir, { recursive: true });
  console.log("📁 已创建送达照片目录:", deliveryPhotosDir);
}

// 配置 multer 存储司机送达照片（注意：真正的 photo API 建议写在 routes/driver_orders.js 内）
const deliveryPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, deliveryPhotosDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `driver-${unique}${ext}`);
  },
});
const uploadDeliveryPhoto = multer({ storage: deliveryPhotoStorage });

// =======================
// 1) 静态文件：前端页面 + assets + 上传图片
// =======================

// 前端根目录：backend/src → ../../frontend
const frontendPath = path.join(__dirname, "../../frontend");
console.log("静态前端目录:", frontendPath);

// A. 整个 frontend 暴露出来（支持 /user /admin /driver 等）
app.use(express.static(frontendPath));

console.log("✅ addresses 已挂载到 /api/addresses");
console.log("✅ recharge 已挂载到 /api/recharge");
console.log("✅ coupons 已挂载到 /api/coupons");

// B. /assets → 用户端静态资源目录（CSS/JS/图片）
app.use("/assets", express.static(path.join(frontendPath, "user/assets")));

console.log("✅ admin_recharge 已挂载到 /api/admin");
// 后台：管理员充值
app.use("/api/admin", adminRechargeRouter);

// C. /uploads → 后台上传商品图片 + 司机送达照片（backend/uploads/...）
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/whoami-server", (req, res) => {
  res.json({
    ok: true,
    file: url.fileURLToPath(import.meta.url),
    cwd: process.cwd(),
    time: new Date().toISOString(),
  });
});
console.log("✅ auth_mongo 已挂载到 /api/auth");

// =======================
// 2) 各种 API 路由挂载（一定要在 /api 404 之前）
// =======================

// 通用商品接口（如 /api/products、/api/products/:id）
app.use("/api/products", productsRouter);

// 前台首页商品专区接口
app.use("/api/frontend/products", frontendProductsRouter);

// 分类接口
app.use("/api/categories", categoriesRouter);

app.use("/api/admin/settlements", adminSettlementsRouter);
app.use("/api/admin", adminDriversRouter);

// 系统设置
app.use("/api/admin/settings", adminSettingsMemory);

// 营销中心（营销规则配置）
app.use("/api/admin", adminMarketingRouter);
console.log("✅ admin_marketing 已挂载到 /api/admin");

// 用户下单相关
app.use("/api/orders", ordersRouter);

// 后台订单管理
app.use("/api/admin/orders", adminOrdersRouter);

// 后台商品管理
app.use("/api/admin/products", adminProductsRouter);

// ✅ 用户管理：只用 MongoDB 真实数据
app.use("/api/admin/users", adminUsersMongoRouter);

// 后台通用 admin 功能
app.use("/api/admin", adminRouter);

// 钱包
app.use("/api/wallet", walletRouter);
console.log("✅ wallet 已挂载到 /api/wallet");

//（你原本重复挂了一次 settlements，这里保留不改）
app.use("/api/admin/settlements", adminSettlementsRouter);

// =======================
// 2.1 司机端 API（保留 test-ping，其余内存版已删除）
// =======================

// 测试：GET /api/driver/test-ping
app.get("/api/driver/test-ping", (req, res) => {
  res.json({
    success: true,
    message: "server.js · /api/driver/test-ping OK",
  });
});

/**
 * ✅ 重要说明：
 * 以前 server.js 里的这些“内存司机订单接口”已删除：
 * - GET  /api/driver/orders/today
 * - PATCH /api/driver/orders/start-all
 * - PATCH /api/driver/orders/:id/start
 * - PATCH /api/driver/orders/:id/complete
 * - POST /api/driver/orders/:id/photo（内存版）
 *
 * 现在统一由 routes/driver_orders.js（MongoDB版）提供。
 *
 * 如果你需要“上传照片”接口：
 * ✅ 建议加到 routes/driver_orders.js 里，并复用本文件的 uploads 目录规则：
 *   - 保存文件后把 relPath 写到 Order.deliveryPhotoUrl
 *   - relPath 形如：/uploads/delivery_photos/xxx.jpg
 */

// =======================
// 3) 一些通用测试接口
// =======================
app.get("/api/debug-settings", (req, res) => {
  res.json({ success: true, msg: "来自 server.js 的 debug-settings 测试接口" });
});

// =======================
// 4) 页面路由：用户首页 + 后台首页
// =======================

// 用户端首页
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "user/index.html"));
});

// 后台首页（仪表盘）
app.get("/admin", (req, res) => {
  res.sendFile(path.join(frontendPath, "admin/login.html"));
});

// /admin 下面其他 html，如 products.html、drivers.html 等
app.get("/admin/:page", (req, res) => {
  const file = req.params.page;
  res.sendFile(path.join(frontendPath, "admin", file));
});

// =======================
// 5) 未匹配的 API 路由，统一返回 404 JSON
// =======================
app.use("/api", (req, res) => {
  console.log("❌ API 404 捕获:", req.originalUrl);
  res.status(404).json({
    success: false,
    message: "API 路由未找到：" + req.originalUrl,
  });
});

// =======================
// 6) 启动服务（先连 Mongo 再启动）
// =======================
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectDB();

    app.listen(PORT, "0.0.0.0", () => {
      console.log("✅ Freshbuy server listening on port", PORT);
      console.log("   Render 环境下请用服务域名访问（不是 localhost）");
    });
  } catch (err) {
    console.error("❌ Server start failed (Mongo connect error):", err);
    process.exit(1);
  }
}

start();
