export function toClient(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...obj, id: obj.id || String(obj._id || "") };
}
export function toClientList(list = []) {
  return Array.isArray(list) ? list.map(toClient) : [];
}
