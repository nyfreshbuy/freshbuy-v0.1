// backend/src/server.js
// 在鲜购拼好货 · 本地测试版服务入口（不连 Mongo）
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
// 看看到底是哪个 server.js 在跑（防止跑错目录）
console.log(
  "🔥 当前运行的 server.js 来自 =====> ",
  url.fileURLToPath(import.meta.url)
);
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
import order from "./models/order.js";
import adminMarketingRouter from "./routes/admin_marketing.js";
import adminSettlementsRouter from "./routes/admin_settlements.js";
import adminWithdrawalsRouter from "./routes/admin_withdrawals_memory.js";
import adminLeaderSettlementsRouter from "./routes/admin_leader_settlements_memory.js";
import adminDriverSettlementsRouter from "./routes/admin_driver_settlements_memory.js";
import adminSettingsMemory from "./routes/admin_settings.js";
import adminDashboardrouter from "./routes/admin_dashboard.js";
import productsRouter from "./routes/products.js"; // 通用商品接口
import frontendProductsRouter from "./routes/frontendProducts.js"; // 前台首页专区接口
import categoriesRouter from "./routes/categories.js";
import driverRouter from "./routes/driver.js";
import driverOrdersRouter from "./routes/driver_orders.js";
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
// ✅ 注意：driver_orders.js 先不使用了，司机端逻辑统一写在 server.js 里
// ⭐ 引入统一的订单内存仓库（司机端 + 后台共用）
import {
  mockDriverOrders,
  updateDriverOrderStatus,
  updateAdminOrderStatus,
} from "./memory/ordersStore.js";
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
app.use("/api/driver/orders", driverOrdersRouter);
app.use("/api/admin/auth", adminAuthRouter);
console.log("✅ admin_auth 已挂载到 /api/admin/auth");
// =======================
// 司机端：内存任务 + 照片上传配置
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

// 配置 multer 存储司机送达照片
const deliveryPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, deliveryPhotosDir);
  },
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
// 前台首页商品专区接口：friday-deals / family-essential / best-sellers / new-arrivals
app.use("/api/frontend/products", frontendProductsRouter);
// 分类接口
app.use("/api/categories", categoriesRouter);
app.use("/api/admin/settlements", adminSettlementsRouter);
app.use("/api/admin/withdrawals", adminWithdrawalsRouter);
app.use("/api/admin/leader-settlements", adminLeaderSettlementsRouter);
app.use("/api/admin/driver-settlements", adminDriverSettlementsRouter);
app.use("/api/admin", adminDriversRouter);
// 系统设置
app.use("/api/admin/settings", adminSettingsMemory);
// 营销中心（营销规则配置）
app.use("/api/admin", adminMarketingRouter);
console.log("✅ admin_marketing 已挂载到 /api/admin");
// 用户下单相关（测试版）
app.use("/api/orders", ordersRouter);
// 后台订单管理
app.use("/api/admin/orders", adminOrdersRouter);
// 后台商品管理
app.use("/api/admin/products", adminProductsRouter);
// ✅ 用户管理：只用 MongoDB 真实数据
app.use("/api/admin/users", adminUsersMongoRouter);
// 后台通用 admin 功能
app.use("/api/admin", adminRouter);
// 结算相关
// 钱包 / 充值测试接口
app.use("/api/wallet", walletRouter);
console.log("✅ wallet 已挂载到 /api/wallet")
app.use("/api/admin/settlements", adminSettlementsRouter);

// =======================
// 2.1 司机端 API（重点）
// =======================

// 测试：GET /api/driver/test-ping
app.get("/api/driver/test-ping", (req, res) => {
  res.json({
    success: true,
    message: "server.js · /api/driver/test-ping OK",
  });
});

// 今日任务：GET /api/driver/orders/today
app.get("/api/driver/orders/today", (req, res) => {
  res.json({
    success: true,
    origin: {
      lat: 40.758531,
      lng: -73.829252,
      address: "Freshbuy 仓库",
    },
    orders: mockDriverOrders, // ⭐ 统一来自 ordersStore.js
  });
});
// 一键开始配送：PATCH /api/driver/orders/start-all
// 规则：只把「今天之前创建」且「未送达」的订单，设为配送中
app.patch("/api/driver/orders/start-all", (req, res) => {
  console.log("👉 收到一键开始配送请求 /api/driver/orders/start-all");

  const now = new Date();

  // 今天 00:00
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  );
  const cutoffTs = startOfToday.getTime();

  const startedAt =
    (req.body && req.body.startedAt) || now.toISOString();

  const updatedDriverOrders = [];

  mockDriverOrders.forEach((o) => {
    if (!o) return;

    // 已送达的不处理
    if (o.status === "delivered") return;

    // createdAt 判断
    let createdTs = null;
    if (o.createdAt) {
      const d = new Date(o.createdAt);
      const t = d.getTime();
      if (!Number.isNaN(t)) createdTs = t;
    }

    // 今天之后创建的订单跳过
    if (createdTs !== null && createdTs >= cutoffTs) {
      console.log("⏭ 跳过今天之后创建的订单：", o._id, o.createdAt);
      return;
    }

    const id = o._id || o.id || o.orderId || o.orderNo;
    if (!id) return;

    // 更新司机端：delivering
    const driverOrder = updateDriverOrderStatus(id, "delivering", {
      startedAt,
    });

    if (driverOrder) {
      updatedDriverOrders.push(driverOrder);

      // 同步后台：状态 shipping、deliveryStatus delivering
      const adminOrder = updateAdminOrderStatus(id, "delivering", {
        startedAt,
        status: "shipping",
      });

      if (!adminOrder) {
        console.warn(`[WARN] 未找到后台订单: ${id}`);
      } else {
        console.log(
          `✅ 一键开始配送：${id} status=${adminOrder.status}, deliveryStatus=${adminOrder.deliveryStatus}`
        );
      }
    }
  });

  res.json({
    success: true,
    message: "已将【今天之前创建】且未送达的订单标记为配送中",
    driverOrders: updatedDriverOrders,
    cutoff: startOfToday.toISOString(),
  });
});
// PATCH /api/driver/orders/:id/start
app.patch("/api/driver/orders/:id/start", (req, res) => {
  const orderId = req.params.id;
  console.log("👉 收到司机【开始配送】请求，orderId =", orderId);

  const startedAt =
    (req.body && req.body.startedAt) || new Date().toISOString();
  const note = (req.body && req.body.note) || "";

  // 1) 更新司机端订单状态 → delivering
  const driverOrder = updateDriverOrderStatus(orderId, "delivering", {
    startedAt,
    note,
  });

  if (!driverOrder) {
    console.warn("❌ updateDriverOrderStatus 找不到订单：", orderId);
    return res.status(404).json({
      success: false,
      message: "未找到配送订单：" + orderId,
    });
  }

  // 2) 同步更新后台订单：deliveryStatus = delivering, status = shipping
  const adminOrder = updateAdminOrderStatus(orderId, "delivering", {
    startedAt,
    status: "shipping",
  });

  if (!adminOrder) {
    console.warn(
      `[WARN] 开始配送：未在后台订单中找到对应订单 ${orderId}`
    );
  } else {
    console.log(
      `✅ 后台订单已更新（开始配送）：${orderId} status = ${adminOrder.status}, deliveryStatus = ${adminOrder.deliveryStatus}`
    );
  }

  res.json({
    success: true,
    message: "订单已设为配送中",
    driverOrder,
    adminOrder,
  });
});

// 标记送达：PATCH /api/driver/orders/:id/complete
// 司机点“完成配送”时调用
// 同时更新：司机端订单 + 后台订单
app.patch("/api/driver/orders/:id/complete", (req, res) => {
  const orderId = req.params.id;
  console.log("👉 收到司机【完成配送】请求，orderId =", orderId);

  const finishedAt =
    (req.body && req.body.finishedAt) || new Date().toISOString();
  const note = (req.body && req.body.note) || "";

  // 1) 更新司机端订单状态 → delivered
  const driverOrder = updateDriverOrderStatus(orderId, "delivered", {
    deliveredAt: finishedAt,
    note,
  });

  if (!driverOrder) {
    console.warn("❌ updateDriverOrderStatus 找不到订单：", orderId);
    return res.status(404).json({
      success: false,
      message: "未找到配送订单：" + orderId,
    });
  }

  // 2) 同步更新后台订单：deliveryStatus + status
  const adminOrder = updateAdminOrderStatus(orderId, "delivered", {
    deliveredAt: finishedAt,
    status: "completed",
  });

  if (!adminOrder) {
    console.warn(
      `[WARN] 完成配送：未在后台订单中找到对应订单 ${orderId}`
    );
  } else {
    console.log(
      `✅ 后台订单已更新（已送达）：${orderId} status = ${adminOrder.status}, deliveryStatus = ${adminOrder.deliveryStatus}`
    );
  }

  res.json({
    success: true,
    message: "订单已标记为送达",
    driverOrder,
    adminOrder,
  });
});

// 上传送达照片：POST /api/driver/orders/:id/photo  (form-data: photo)
app.post(
  "/api/driver/orders/:id/photo",
  uploadDeliveryPhoto.single("photo"),
  (req, res) => {
    try {
      const orderId = req.params.id;
      const driverOrder = mockDriverOrders.find((o) => o._id === orderId);

      if (!driverOrder) {
        return res.status(404).json({
          success: false,
          message: "未找到配送订单：" + orderId,
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "没有收到照片文件",
        });
      }

      const relPath = "/uploads/delivery_photos/" + req.file.filename;
      driverOrder.photoUrl = relPath;

      res.json({
        success: true,
        message: "送达照片上传成功",
        photoUrl: relPath,
        order: driverOrder,
      });
    } catch (err) {
      console.error("❌ 上传送达照片出错:", err);
      res.status(500).json({
        success: false,
        message: "服务器内部错误：" + err.message,
      });
    }
  }
);

// =======================
// 3) 一些通用测试接口
// =======================

// ⭐ 简单测试接口：确认服务 OK
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

// 如果你有司机前端页面（可选）：frontend/driver/index.html
// app.get("/driver/:page?", (req, res) => {
//   const file = req.params.page || "index.html";
//   res.sendFile(path.join(frontendPath, "driver", file));
// });

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