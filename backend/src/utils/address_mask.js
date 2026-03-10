export function maskPickupAddress(addressLine1 = "", nearStreet = "") {
  const raw = String(addressLine1 || "").trim();
  if (!raw) return "";

  // Queens 常见格式：120-35 Union St
  const m = raw.match(/^(\d+)-(\d+)\s+(.+)$/);
  if (!m) return raw;

  const block = m[1];   // 120
  const street = m[3];  // Union St

  let result = `${street} ${block}-**`;
  if (nearStreet) result += `（近 ${nearStreet}）`;

  return result;
}