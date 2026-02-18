// backend/src/utils/phone.js
export function normalizePhoneToE164(raw) {
  const s = String(raw ?? "").trim();

  // 去掉所有空白（包含不可见空白）
  const noWs = s.replace(/\s+/g, "");

  // 只保留 + 和数字
  const cleaned = noWs.replace(/[^\d+]/g, "");

  let e164 = cleaned;

  // ✅ 如果用户只填了 10 位美国手机号，补 +1
  if (/^\d{10}$/.test(e164)) e164 = "+1" + e164;

  // ✅ 如果是 11 位且以 1 开头，也补 +
  if (/^1\d{10}$/.test(e164)) e164 = "+" + e164;

  // E.164 基本格式校验
  if (!/^\+[1-9]\d{1,14}$/.test(e164)) return "";

  return e164;
}
