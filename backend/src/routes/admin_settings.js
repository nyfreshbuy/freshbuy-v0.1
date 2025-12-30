import express from "express";

const router = express.Router();

// =============================================
// 内存中的系统设置（重启后恢复默认）
// =============================================
let settingsMemory = {
  // 站点 & 基础信息
  general: {
    siteName: "在鲜购拼好货",
    supportPhone: "",
    supportIM: "",
  },

  // 订单 & 运费相关
  order: {
    shippingBase: 4.99, // 基础运费
    freeShippingThreshold: 69, // 满额免运费
    minOrderAmount: 0, // 最低下单金额
  },

  // 活动 & 拼单相关
  promotion: {
    enableFriendGroup: true, // 是否开启好友拼单
    enableTierPrice: true, // 是否启用阶梯价
    tierRefundMode: "wallet", // 阶梯价差价退到哪里（wallet / original）
    friendShippingMode: "ladder", // 好友拼单运费模式 ladder: 阶梯
  },

  // 通知 & 消息推送
  notify: {
    smsOrderNotify: true,
    notifyLeaderNewOrder: true,
    notifyDriverTask: true,
    notifyPriority: ["sms", "wechat", "app"], // 优先顺序
  },

  // 角色 & 权限相关
  roles: {
    leaderVisibleModules: "订单管理, 团长收益, 团长充值, 帮客户下单",
    driverVisibleModules: "今日任务, 导航, 完成记录, 收入统计",
    csVisibleModules: "订单查询, 售后处理, 投诉记录",

    leaderPermissions: {
      canPlaceOrderForCustomer: true,
      canRecharge: true,
      canViewAllGroupOrders: true,
    },
    driverPermissions: {
      canSeeCustomerPhone: true,
      canModifyETA: true,
      requirePhotoProof: true,
    },
    csPermissions: {
      canEditOrderAddress: true,
      canProcessRefund: true,
      canCreateManualOrder: true,
    },
  },

  // 安全 & 风控
  security: {
    adminLoginRetryLimit: 5, // 后台登录错误次数限制
    manualReviewThreshold: 300, // 超过多少金额需要人工审核
    adminLogKeepDays: 180, // 后台日志保留天数
  },

  // ✅ 给前台 Footer/弹窗用的“配送配置”（结构化字段）
  delivery: {
    areaZh: "Fresh Meadows 及周边社区",
    areaEn: "Fresh Meadows and nearby neighborhoods",
    areaNoteZh: "（以可下单区域为准）",
    areaNoteEn: "(subject to available service areas)",
    frequencyZh: "每周固定配送 1 次",
    frequencyEn: "Scheduled delivery once per week",
    dayZh: "周五",
    dayEn: "Friday",
    timeWindowZh: "17:00 – 21:00（纽约时间）",
    timeWindowEn: "5:00 PM – 9:00 PM (NY time)",
  },

  // ✅ 配送方式说明（后台可编辑，前台可展示）
  deliveryInstructions: `
📦 配送方式说明（示例）

1️⃣ 次日配送：
· 下午 6 点前下单，默认次日 14:00 - 18:00 送达
· 如遇爆单或极端天气，可能顺延 1 天

2️⃣ 好友拼单：
· 多个好友使用同一地址下单，可平摊运费
· 系统自动计算每人应付运费金额

3️⃣ 区域团购：
· 每周固定区域免运费日，需满足最低消费金额
· 下单后统一时间集中配送

4️⃣ 爆品日 / 体验日：
· 指定日期，只卖爆品 / 体验商品
· 统一次日或指定时间段配送

（以上只是示例文案，可在后台随时修改）
  `.trim(),

  updatedAt: new Date().toLocaleString(),
};

// ✅ 共享给全局（site_config_memory.js 会读取这里）
global.__FB_SETTINGS_STORE__ = settingsMemory;

// =============================================
// 简单管理员鉴权（以后可换成你的真正 adminAuth）
// =============================================
function authAdmin(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "未登录（缺少 Token）",
    });
  }
  next();
}

// ⚠️ 注意：不要在这里做 /api/site-config
// 因为这个 router 在 server.js 被挂载到 /api/admin/settings
// 你要的 /api/site-config 请放在 site_config_memory.js 并在 server.js 用：
// app.use("/api/site-config", siteConfigRouter);

// =============================================
// 一、单独：配送方式说明接口
// =============================================

// 1) 前台 / 后台获取配送说明（不需要登录）
// GET /api/admin/settings/delivery-instructions
router.get("/delivery-instructions", (req, res) => {
  return res.json({
    success: true,
    content: settingsMemory.deliveryInstructions || "",
    updatedAt: settingsMemory.updatedAt,
  });
});

// 2) 后台更新配送说明（需要管理员登录）
// POST /api/admin/settings/delivery-instructions
router.post("/delivery-instructions", authAdmin, (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) {
    return res.json({
      success: false,
      message: "内容不能为空",
    });
  }

  settingsMemory.deliveryInstructions = content.trim();
  settingsMemory.updatedAt = new Date().toLocaleString();

  // ✅ 同步 global
  global.__FB_SETTINGS_STORE__ = settingsMemory;

  return res.json({
    success: true,
    message: "配送方式说明已更新",
    content: settingsMemory.deliveryInstructions,
    updatedAt: settingsMemory.updatedAt,
  });
});

// =============================================
// 二、总设置中心
// 统一处理 /api/admin/settings 下的 GET / POST / PUT / PATCH
// =============================================

// 这里所有操作都需要管理员登录
router.all("/", authAdmin, (req, res) => {
  console.log("[admin_settings] method:", req.method, "url:", req.originalUrl);

  // --- 读取全部设置 ---
  if (req.method === "GET") {
    return res.json({
      success: true,
      data: settingsMemory,
    });
  }

  // --- 更新（整体合并）---
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const body = req.body || {};

    // 简单浅合并
    settingsMemory = {
      ...settingsMemory,
      ...body,
      updatedAt: new Date().toLocaleString(),
    };

    // ✅ 同步 global
    global.__FB_SETTINGS_STORE__ = settingsMemory;

    return res.json({
      success: true,
      message: "设置已更新",
      data: settingsMemory,
    });
  }

  // --- 其他方法 ---
  return res.status(405).json({
    success: false,
    message: "不支持的请求方法：" + req.method,
  });
});

export default router;
