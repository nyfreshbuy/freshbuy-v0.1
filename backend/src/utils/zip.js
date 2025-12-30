// backend/src/utils/zip.js
export function normZip(zip) {
  const s = String(zip || "").trim();
  const m = s.match(/\d{5}/);
  return m ? m[0] : "";
}
