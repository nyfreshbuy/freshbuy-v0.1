// backend/src/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import * as url from "url";
import fs from "fs";
import multer from "multer";
import { connectDB } from "./db.js";
import { cleanupDeliveryPhotos } from "./jobs/cleanup_delivery_photos.js";
// =======================
// 路由导入
// =======================
import authMongoRouter from "./routes/auth_mongo.js";
import adminAuthRouter from "./routes/admin_auth.js";
import smsVerifyRouter from "./routes/sms_verify.js";
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
import stripeWebhookRouter from "./routes/stripe_webhook.js";
// ✅ 你现在真正用的 Stripe 支付路由（包含 /publishable-key /order-intent /webhook）
import stripePayRouter from "./routes/pay_stripe.js";
import walletRechargeRouter from "./routes/wallet_recharge.js";
import driverRouter from "./routes/driver.js";
import driverOrdersRouter from "./routes/driver_orders.js";
import adminInvoicesRouter from "./routes/admin_invoices.js";
import addressesRouter from "./routes/addresses.js";
import rechargeRouter from "./routes/recharge.js";
import couponsRouter from "./routes/coupons.js";
import { requireAdmin } from "./middlewares/admin.js";
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
import adminPicklistRouter from "./routes/admin_picklist.js";
import authVerifyRegisterRouter from "./routes/auth_verify_register.js";
import authVerifyResetPasswordRouter from "./routes/auth_verify_reset_password.js";
import driverDispatchRoutes from "./routes/driver_dispatch.js";
import resetPwdRouter from "./routes/auth_reset_password.js";
import zonesPublicListRouter from "./routes/zones_public_list.js";
import bannersRouter from "./routes/banners.js";
import adminBannersRouter from "./routes/admin_banners.js";
import adminLeadersRouter from "./routes/admin_leaders.js";
import leaderRouter from "./routes/leader.js";
import publicPickupPointsRouter from "./routes/public_pickup_points.js";
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

const userStaticDir = path.join(__dirname, "../../frontend/user");
app.use("/user", express.static(userStaticDir));
// ✅ 兜底：根路径 favicon（iOS/Chrome/收藏夹会默认请求）
app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(userStaticDir, "assets/icons/favicon.ico"));
});
// ✅ 兼容旧链接：不带 /user 的 newcomer 入口
app.get("/newcomer", (req, res) => {
  return res.redirect(302, "/user/newcomer.html");
});
app.get("/newcomer.html", (req, res) => {
  return res.redirect(302, "/user/newcomer.html");
});
// 然后才是这些
app.use("/api/orders", ordersRouter);
app.use("/api/products", productsRouter);
app.use("/api/wallet/recharge", walletRechargeRouter);
app.use("/api/stripe", stripeWebhookRouter);
app.use("/api/admin/invoices", adminInvoicesRouter);
/**
 * Stripe Webhook 必须 RAW BODY，且必须在 express.json() 之前
 *
 * 你当前有两套：
 * 1) 旧：/api/stripe  -> stripe_webhook.js（你原本就放在 json 之前，OK）
 * 2) 新：/api/pay/stripe/webhook -> pay_stripe.js 内部的 router.post("/webhook", express.raw(...))
 *
 * 说明：
 * - pay_stripe.js 内部已经对 /webhook 使用了 express.raw
 * - 这里只需要确保 /api/pay/stripe 在 express.json() 之前挂载
 */
app.use("/api/public/pickup-points", publicPickupPointsRouter);
// cors 放在这里是安全的（不影响 webhook raw）
app.use(cors());

// ✅ 你真正的 Stripe 支付路由
app.use("/api/pay/stripe", stripePayRouter);

// 其它 API 才用 json
app.use(express.json());
// ✅ DEBUG：确认新代码已部署（浏览器打开这个地址必须看到 ok:true）
app.get("/api/__debug_server_version", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), file: "backend/src/server.js" });
});

// ✅ DEBUG：确认 /api/admin/products 请求是否进入 server.js 这层
app.use("/api/admin/products", (req, res, next) => {
  console.log("🧭 ENTER /api/admin/products:", req.method, req.originalUrl);
  return next();
});
app.use(express.urlencoded({ extended: true }));
// ✅ DEBUG：确认 /api/admin/products 请求是否真的进入 products router
app.use("/api/admin/products", (req, res, next) => {
  console.log("🧭 ENTER /api/admin/products:", req.method, req.originalUrl);
  return next();
});
app.use("/api/zones", zonesPublicListRouter);

// =======================
// 其他路由（保持你的顺序，但修正重复挂载）
// =======================
app.use("/api/sms", smsVerifyRouter);

// ✅✅✅ 先挂最具体的（避免被 /api/admin 吃掉）
// （只挂一次！）
app.use("/api/admin/orders", adminOrdersRouter);

// ✅✅✅ 先挂最具体的（避免被 /api/driver 吃掉）
// （只挂一次！driver_orders.js 只负责 /api/driver/orders/...）
app.use("/api/driver/orders", driverOrdersRouter);
app.use("/api/admin/products", adminProductsRouter); // ✅ 放这里（关键）
app.use("/api/admin/users", adminUsersMongoRouter);  // ✅ 建议也放这里（同理）
app.use("/api/admin/zones", adminZonesRouter);
console.log("✅ admin_zones 已挂载到 /api/admin/zones");
// 你原来挂的 picklist（保持）
app.use("/api/admin/picklist", adminPicklistRouter);
// 司机派单/路线（保持在 /api/driver 下）
// ⚠️ 注意：这里不要再挂 driverOrdersRouter 到 /api/driver
app.use("/api/driver", driverDispatchRoutes);

// ---- 基础工具 / 公共 ----
app.use("/api/geocode", geocodeRouter);
console.log("✅ geocode 已挂载到 /api/geocode");

// ✅ Public zones
app.use("/api/public/zones", publicZonesRouter);
app.use("/api/zones", publicZonesRouter);
console.log("✅ public_zones 已挂载到 /api/public/zones");

// ✅ ZIP 检测
app.use("/api/zones/check", zonesCheckRouter);
console.log("✅ zones_check 已挂载到 /api/zones/check");

// public
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
app.use("/api/auth", authVerifyRegisterRouter);
// ---- 用户 ----
app.use("/api/users", userProfileRouter);
app.use("/api/users", usersRouter);
app.use("/api/user", userMeRouter);
// ✅ 团长（团长端/客户绑定/邀请码等）
app.use("/api/leader", leaderRouter);

// ---- 支付 ----
app.use("/api/payments", paymentsRouter);

// ---- 司机 ----
app.use("/api/driver", driverRouter);

// ---- 后台 ----
app.use("/api/admin/dashboard", adminDashboardrouter);


app.use("/api/admin/auth", adminAuthRouter);
console.log("✅ admin_auth 已挂载到 /api/admin/auth");

app.use("/api/admin/dispatch", adminDispatchRouter);

app.use("/api/site-config", siteConfigRouter);

// 后台：管理员充值
app.use("/api/admin/recharge", adminRechargeRouter);
console.log("✅ admin_recharge 已挂载到 /api/admin/recharge");
app.use("/api/banners", bannersRouter);
app.use("/api/admin/banners", adminBannersRouter);
// 营销中心
app.use("/api/admin", adminMarketingRouter);
console.log("✅ admin_marketing 已挂载到 /api/admin");

// ✅ DEBUG: 确认 adminOrdersRouter 是否真的挂载生效
app.get("/api/admin/orders/__mounted", (req, res) => {
  res.json({ ok: true, where: "server.js", mounted: "/api/admin/orders" });
});

// ✅ DEBUG: 直接测试 status 路由是否存在（不进 admin_orders.js 也能确认路径）
app.patch("/api/admin/orders/__ping-status", (req, res) => {
  res.json({ ok: true, hit: "/api/admin/orders/__ping-status" });
});
// 司机管理
app.use("/api/admin", adminDriversRouter);

// 后台结算
app.use("/api/admin/settlements", adminSettlementsRouter);
// ✅ 团长（后台管理）
app.use("/api/admin/leaders", adminLeadersRouter);
// 后台通用 admin 功能
app.use("/api/admin", adminRouter);

// 钱包
app.use("/api/wallet", walletRouter);
console.log("✅ wallet 已挂载到 /api/wallet");

// ---- 下单 ----
app.use("/api/orders", ordersRouter);
app.use("/api/auth", resetPwdRouter);

// ---- 通用商品 / 分类 ----
app.use("/api/products", productsRouter);
app.use("/api/frontend/products", frontendProductsRouter);
app.use("/api/categories", categoriesRouter);

// ---- 系统设置 ----
app.use("/api/admin/settings", adminSettingsMemory);

// ✅ 最后再挂 /api 大网兜
app.use("/api", productsSimpleRouter);

// =======================
// 司机端：照片上传配置（保留目录 + multer）
// =======================

// 上传根目录：backend/uploads
const uploadsRoot = path.join(__dirname, "../uploads");
const deliveryPhotosDir = path.join(uploadsRoot, "delivery_photos");

if (!fs.existsSync(deliveryPhotosDir)) {
  fs.mkdirSync(deliveryPhotosDir, { recursive: true });
  console.log("📁 已创建送达照片目录:", deliveryPhotosDir);
}

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
const frontendCandidates = [
  path.join(__dirname, "../../frontend"),
  path.join(__dirname, "../frontend"),
  path.join(process.cwd(), "frontend"),
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

app.use(express.static(frontendPath));
app.use("/assets", express.static(path.join(frontendPath, "user/assets")));
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

app.get("/api/driver/test-ping", (req, res) => {
  res.json({
    success: true,
    message: "server.js · /api/driver/test-ping OK",
  });
});

app.get("/api/debug-settings", (req, res) => {
  res.json({ success: true, msg: "来自 server.js 的 debug-settings 测试接口" });
});

// =======================
// 页面路由：用户首页 + 后台首页
// =======================
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "user/index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(frontendPath, "admin/login.html"));
});
app.get("/category.html", (req, res) => {
  res.sendFile(path.join(frontendPath, "user/category.html"));
});

app.get("/admin/:page", (req, res) => {
  const file = req.params.page;
  res.sendFile(path.join(frontendPath, "admin", file));
});

// =======================
// 页面路由：司机端
// =======================
app.get("/driver", (req, res) => {
  res.sendFile(path.join(frontendPath, "driver/login.html"));
});

app.get("/driver/login.html", (req, res) => {
  res.sendFile(path.join(frontendPath, "driver/login.html"));
});

app.get("/driver/:page", (req, res) => {
  const file = req.params.page;
  res.sendFile(path.join(frontendPath, "driver", file));
});

// =======================
// 未匹配的 API 路由，统一返回 404 JSON（必须最后）
// =======================
// =======================
// 未匹配的 API 路由：404（放在最后）
// =======================
app.use("/api", (req, res) => {
  console.log("❌ API 404 捕获:", req.originalUrl);
  res.status(404).json({
    success: false,
    message: "API 路由未找到：" + req.originalUrl,
  });
});

// =======================
// 全局错误捕捉：必须是顶层中间件（放在 404 后也行）
// =======================
app.use((err, req, res, next) => {
  console.error("🔥 GLOBAL ERROR:", req.method, req.originalUrl);
  console.error(err?.stack || err);
  res.status(500).json({
    success: false,
    message: err?.message || String(err) || "Server Error",
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

// ===============================
// 🧹 定时清理送达照片（每天凌晨 3 点跑一次）
// ===============================
const KEEP_DAYS = Number(process.env.PROOF_PHOTO_KEEP_DAYS || 14);

// 立即跑一次（重启时）
cleanupDeliveryPhotos(KEEP_DAYS).catch(console.error);

// 每 24 小时跑一次
setInterval(() => {
  cleanupDeliveryPhotos(KEEP_DAYS).catch(console.error);
}, 24 * 60 * 60 * 1000);
