// backend/src/memory/ordersStore.js
// ========================================
// 统一管理：司机端订单 + 后台订单（内存版）
// - 司机端：mockDriverOrders
// - 后台：mockAdminOrders
// - 公共工具方法：updateAdminOrderStatus / updateDriverOrderStatus
// ========================================

// 先算几个固定时间：两天前 / 一天前（确保都 < 今天 00:00）
const now = new Date();
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

// ========= 1) 后台订单（订单管理页面用）=========
// ⚠️ 关键点：_id 要和司机端保持一致（ORDER-1 / ORDER-2）
// deliveryStatus:
//   - "assigned"    → 已分配/待配送
//   - "delivering"  → 配送中
//   - "delivered"   → 配送完成
export let mockAdminOrders = [
  {
    _id: "ORDER-1",
    orderNo: "TEST-20251125-001",
    user: { name: "张三", phone: "9170000001" },
    customerName: "张三",
    customerPhone: "9170000001",
    leader: { name: "王团长" },
    pickupName: "Flushing 自提点 A",
    fullAddress: "136-20 38th Ave, Flushing, NY 11354",
    lat: 40.7601,
    lng: -73.8293,
    totalAmount: 58.5,
    deliveryMode: "door",      // 送货上门
    serviceMode: "normal",     // 次日配送
    areaGroupZone: "",
    items: [
      { productId: "apple", name: "苹果", qty: 2, price: 3.99, unit: "袋" },
      { productId: "milk", name: "牛奶", qty: 1, price: 5.5, unit: "瓶" },
    ],

    status: "paid",            // 业务状态：已支付（未开始配送）
    deliveryStatus: "assigned",// 配送状态：已分配
    createdAt: twoDaysAgo,     // ✅ 两天前创建（一定 < 今天 00:00）
    deliveredAt: null,
  },
  {
    _id: "ORDER-2",
    orderNo: "TEST-20251125-002",
    user: { name: "李四", phone: "9170000002" },
    customerName: "李四",
    customerPhone: "9170000002",
    leader: { name: "赵团长" },
    pickupName: "Fresh Meadows 自提点 B",
    fullAddress: "69-40 174th St, Fresh Meadows, NY 11365",
    lat: 40.738,
    lng: -73.793,
    totalAmount: 32,
    deliveryMode: "pickup",        // 自提
    serviceMode: "areaGroup",      // 区域团拼单
    areaGroupZone: "zone_freshmeadows",
    items: [
      { productId: "egg10", name: "十枚装鸡蛋", qty: 1, price: 4.5, unit: "盒" },
      { productId: "apple", name: "苹果", qty: 3, price: 3.99, unit: "袋" },
    ],

    status: "paid",                // 业务状态：已支付
    deliveryStatus: "assigned",    // 配送状态：已分配
    createdAt: yesterday,          // ✅ 昨天创建（也 < 今天 00:00）
    deliveredAt: null,
  },
];

// ========= 2) 司机端订单（司机 App / 小程序用）=========
// status:
//   - "assigned"   → 已分配，待配送
//   - "delivering" → 配送中
//   - "delivered"  → 已送达
export let mockDriverOrders = [
  {
    _id: "ORDER-1", // 跟 mockAdminOrders 对应
    orderNo: "TEST-20251125-001",
    customerName: "张三",
    customerPhone: "9170000001",
    fullAddress: "136-20 38th Ave, Flushing, NY 11354",
    lat: 40.7601,
    lng: -73.8293,

    status: "assigned",       // ✅ 初始：待配送
    createdAt: twoDaysAgo,    // 和后台保持一致
    deliveredAt: null,
    photoUrl: null,
    note: "",
  },
  {
    _id: "ORDER-2",
    orderNo: "TEST-20251125-002",
    customerName: "李四",
    customerPhone: "9170000002",
    fullAddress: "69-40 174th St, Fresh Meadows, NY 11365",
    lat: 40.738,
    lng: -73.793,

    status: "assigned",       // 初始：待配送
    createdAt: yesterday,
    deliveredAt: null,
    photoUrl: null,
    note: "",
  },
];

// ========= 3) 通用查询小工具 =========

export function getAdminOrderById(orderId) {
  return mockAdminOrders.find((o) => o._id === orderId) || null;
}

export function getDriverOrderById(orderId) {
  return mockDriverOrders.find((o) => o._id === orderId) || null;
}

// ========= 4) 工具函数：更新订单状态 =========

// 更新「后台订单」的配送状态 + 其他字段
// 使用方式：updateAdminOrderStatus("ORDER-1", "delivered", { deliveredAt: "..." })
export function updateAdminOrderStatus(orderId, deliveryStatus, extra = {}) {
  const order = getAdminOrderById(orderId);
  if (!order) return null;

  order.deliveryStatus = deliveryStatus;
  Object.assign(order, extra);
  return order;
}

// 更新「司机端订单」状态 + 其他字段
// 使用方式：updateDriverOrderStatus("ORDER-1", "delivered", { deliveredAt: "..." })
export function updateDriverOrderStatus(orderId, status, extra = {}) {
  const order = getDriverOrderById(orderId);
  if (!order) return null;

  order.status = status;
  Object.assign(order, extra);
  return order;
}

// ========= 5) 重置方法（给以后测试用） =========
export function resetOrders() {
  mockAdminOrders.forEach((o) => {
    o.deliveryStatus = "assigned";
    o.status = "paid";
    o.deliveredAt = null;
  });
  mockDriverOrders.forEach((o) => {
    o.status = "assigned";
    o.deliveredAt = null;
    o.photoUrl = null;
    o.note = "";
  });
}
