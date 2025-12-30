// backend/src/mock/mockUsers.js

// ⭐ 内存里的假用户列表（重启后会重置）
// id 用简单字符串，方便在前端输入
export let mockUsers = [
  {
    id: "U-1",
    name: "测试用户A",
    phone: "9170000001",
    walletBalance: 0,
    totalRecharge: 0,
  },
  {
    id: "U-2",
    name: "测试用户B",
    phone: "9170000002",
    walletBalance: 10,
    totalRecharge: 10,
  },
];

// 按 id 查用户
export function getUserById(id) {
  return mockUsers.find((u) => u.id === id);
}

// 按手机号查用户
export function getUserByPhone(phone) {
  return mockUsers.find((u) => u.phone === phone);
}

// 给用户充值（正数加钱，负数扣钱）
export function rechargeUser(user, amount) {
  const money = Number(amount);
  if (Number.isNaN(money)) return;

  user.walletBalance = (user.walletBalance || 0) + money;
  user.totalRecharge = (user.totalRecharge || 0) + (money > 0 ? money : 0);
}
