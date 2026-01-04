// backend/src/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import * as url from "url";
import fs from "fs";
import multer from "multer";

import { connectDB } from "./db.js";

// =======================
// 路由导入
// =======================
import authMongoRouter from "./routes/auth_mongo.js";
import adminAuthRouter from "./routes/admin_auth.js";

// 你项目里现有路由（按你原本导入保留）
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
import productsRouter from "./routes/products.js";
import frontendProductsRouter from "./routes/frontendProducts.js";
import categoriesRouter from "./routes/categories.js";

import driverRouter from "./routes/driver.js";
import driverOrdersRouter from "./routes/driver_orders.js";

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

// =======================
// 启动日志（保留你原来的）
// =======================
console.log("JWT_SECRET loaded?", !!process.env.JWT_SECRET);
console.log("ENV MONGODB_URI exists?", Boolean(process.env.MONGODB_URI));
console.log(
  "ENV MONGODB_URI host preview:",
  (process.env.MONGODB_URI || "").split("@")[1]?.split("/")[0]
);
console.log("🔥 当前运行的 server.js 来自 =====> ", url.fileURLToPath(import.meta.url));

// =======================
// 创建 app
// =======================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =======================
// API 路由挂载（先挂具体的，再挂“/api”大网兜）
// =======================

// ---- 基础工具 / 公共 ----
app.use("/api/geocode", geocodeRouter);
console.log("✅ geocode 已挂载到 /api/geocode");

// ✅ Public zones（你要的真实入口）
// 访问：/api/public/zones 以及 /api/public/zones/ping
app.use("/api/public/zones", publicZonesRouter);
app.use("/api/zones", publicZonesRouter); // ✅ 兼容 /api/zones/by-zip
console.log("✅ public_zones 已挂载到 /api/public/zones");

// ✅ ZIP 检测（避免跟 zones 列表冲突）
// 访问：/api/zones/check?zip=xxxxx 以及 /api/zones/check/ping
app.use("/api/zones/check", zonesCheckRouter);
console.log("✅ zones_check 已挂载到 /api/zones/check");

// 你原来的 public 路由（保留）
app.use("/api/public", publicGeoRouter);
app.use("/api/public", publicServiceRouter);

// ---- 地址 / 充值 / 优惠券 ----
app.use("/api/addresses", addressesRouter);
app.use("/api/recharge", rechargeRouter);
app.use("/api/coupons", couponsRouter);

console.log("✅ addresses 已挂载到 /api/addresses");
console.log("✅ recharge 已挂载到 /api/recharge");
console.log("✅ coupons 已挂载到 /api/coupons");

// ---- 登录 / OTP ----
app.use("/api/auth", authMongoRouter);
console.log("✅ auth_mongo 已挂载到 /api/auth");

app.use("/api/auth-otp", authOtpRouter);

// ---- 用户 ----
app.use("/api/users", userProfileRouter);
app.use("/api/users", usersRouter);
app.use("/api/user", userMeRouter);

// ---- 支付 ----
app.use("/api/payments", paymentsRouter);
app.use("/api/pay/stripe", stripePayRouter);

// ---- 司机 ----
app.use("/api/driver", driverRouter);
app.use("/api/driver/orders", driverOrdersRouter);

// ---- 后台 ----
app.use("/api/admin/dashboard", adminDashboardrouter);
app.use("/api/admin/zones", adminZonesRouter);
console.log("✅ admin_zones 已挂载到 /api/admin/zones");

app.use("/api/admin/auth", adminAuthRouter);
console.log("✅ admin_auth 已挂载到 /api/admin/auth");

app.use("/api/admin/dispatch", adminDispatchRouter);

app.use("/api/site-config", siteConfigRouter);

// 后台：管理员充值
app.use("/api/admin", adminRechargeRouter);
console.log("✅ admin_recharge 已挂载到 /api/admin");

// 营销中心
app.use("/api/admin", adminMarketingRouter);
console.log("✅ admin_marketing 已挂载到 /api/admin");

// 后台订单管理
app.use("/api/admin/orders", adminOrdersRouter);

// 后台商品管理
app.use("/api/admin/products", adminProductsRouter);

// 司机管理
app.use("/api/admin", adminDriversRouter);

// ✅ 用户管理：MongoDB
app.use("/api/admin/users", adminUsersMongoRouter);

// 后台结算
app.use("/api/admin/settlements", adminSettlementsRouter);
//（你原本重复挂了一次 settlements，这里我不重复挂第二次，避免潜在副作用）

// 后台通用 admin 功能
app.use("/api/admin", adminRouter);

// 钱包
app.use("/api/wallet", walletRouter);
console.log("✅ wallet 已挂载到 /api/wallet");

// ---- 下单 ----
app.use("/api/orders", ordersRouter);

// ---- 通用商品 / 分类 ----
app.use("/api/products", productsRouter);
app.use("/api/frontend/products", frontendProductsRouter);
app.use("/api/categories", categoriesRouter);

// ---- 系统设置 ----
app.use("/api/admin/settings", adminSettingsMemory);

// ✅ 最后再挂 /api 大网兜（避免拦截上面所有更具体的接口）
app.use("/api", productsSimpleRouter);

// =======================
// 司机端：照片上传配置（保留目录 + multer）
// =======================

// 上传根目录：backend/uploads
const uploadsRoot = path.join(__dirname, "../uploads");
const deliveryPhotosDir = path.join(uploadsRoot, "delivery_photos");

// 确保目录存在
if (!fs.existsSync(deliveryPhotosDir)) {
  fs.mkdirSync(deliveryPhotosDir, { recursive: true });
  console.log("📁 已创建送达照片目录:", deliveryPhotosDir);
}

// 配置 multer 存储司机送达照片
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
// 静态文件：前端页面 + assets + 上传图片
// =======================

// 前端目录：在本地你是 repo 根目录下的 /frontend
// 但 Render 很可能只部署了 backend（Root Directory=backend），导致 ../../frontend 不存在
const frontendCandidates = [
  path.join(__dirname, "../../frontend"), // repo 根目录模式（推荐）
  path.join(__dirname, "../frontend"),    // Render Root=backend 时的兜底（有些人会这么放）
  path.join(process.cwd(), "frontend"),   // 再兜底
];

let frontendPath = frontendCandidates[0];
for (const p of frontendCandidates) {
  if (fs.existsSync(p)) {
    frontendPath = p;
    break;
  }
}

console.log("静态前端目录(最终使用):", frontendPath);
console.log("静态前端目录是否存在:", fs.existsSync(frontendPath));
// A. 整个 frontend 暴露出来（支持 /user /admin /driver 等）
app.use(express.static(frontendPath));

// B. /assets → 用户端静态资源目录（CSS/JS/图片）
app.use("/assets", express.static(path.join(frontendPath, "user/assets")));

// C. /uploads → 后台上传商品图片 + 司机送达照片
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// =======================
// 测试接口
// =======================
app.get("/api/whoami-server", (req, res) => {
  res.json({
    ok: true,
    file: url.fileURLToPath(import.meta.url),
    cwd: process.cwd(),
    time: new Date().toISOString(),
  });
});

// 司机端 test ping
app.get("/api/driver/test-ping", (req, res) => {
  res.json({
    success: true,
    message: "server.js · /api/driver/test-ping OK",
  });
});

// 通用 debug
app.get("/api/debug-settings", (req, res) => {
  res.json({ success: true, msg: "来自 server.js 的 debug-settings 测试接口" });
});

// =======================
// 页面路由：用户首页 + 后台首页
// =======================

// 用户端首页
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "user/index.html"));
});

// 后台首页（仪表盘）
app.get("/admin", (req, res) => {
  res.sendFile(path.join(frontendPath, "admin/login.html"));
});
app.get("/category.html", (req, res) => {
  res.sendFile(path.join(frontendPath, "user/category.html"));
});
// /admin 下面其他 html，如 products.html、drivers.html 等
app.get("/admin/:page", (req, res) => {
  const file = req.params.page;
  res.sendFile(path.join(frontendPath, "admin", file));
});

// =======================
// 未匹配的 API 路由，统一返回 404 JSON（必须最后）
// =======================
app.use("/api", (req, res) => {
  console.log("❌ API 404 捕获:", req.originalUrl);
  res.status(404).json({
    success: false,
    message: "API 路由未找到：" + req.originalUrl,
  });
});

// =======================
// 启动服务（先连 Mongo 再启动）
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
