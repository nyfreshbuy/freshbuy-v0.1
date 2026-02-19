// backend/src/utils/phone.js
export function normalizeUSPhone(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";

  // 全角＋ -> 半角+
  s = s.replace(/＋/g, "+");

  // 去掉所有空白
  s = s.replace(/\s+/g, "");

  // 只保留 + 和数字
  s = s.replace(/[^\d+]/g, "");

  // 如果有多个 +，只保留开头那个
  if (s.includes("+")) s = "+" + s.replace(/\+/g, "");

  // 10位：补 +1
  if (/^\d{10}$/.test(s)) return "+1" + s;

  // 11位且以1开头：补 +
  if (/^1\d{10}$/.test(s)) return "+" + s;

  // 已经是 + 开头：必须是 +1XXXXXXXXXX（只接受美国）
  if (/^\+1\d{10}$/.test(s)) return s;

  // 其它一律拒绝（例如 +646...）
  return "";
}
