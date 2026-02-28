// backend/src/utils/leaderCode.js
export function genLeaderCode(len = 6) {
  // 去掉易混淆字符：I O 1 0
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}