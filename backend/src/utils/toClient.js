// backend/src/utils/toClient.js
// =======================================================
// 统一把 Mongoose 文档转成前端可用对象
// ✅ 保留业务 id（doc.id），同时保证 _id 一定存在
// ✅ 给前端补一个 clientId（兼容旧前端只认 id）
// =======================================================

export function toClient(doc) {
  if (!doc) return doc;

  // 兼容：Mongoose doc / 普通对象
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;

  // 确保 _id 是字符串（前端编辑/删除/进货接口通常用 _id）
  const _id = obj._id != null ? String(obj._id) : "";

  // ✅ 业务 id：优先用你数据库里的 id（例如 p_170xxx）
  // 如果没有业务 id，才回落用 _id
  const id = obj.id && String(obj.id).trim() ? String(obj.id).trim() : _id;

  return {
    ...obj,
    _id,        // ✅ 强制保证存在且为 string
    id,         // ✅ 兼容旧前端：若无业务id则用 _id
    clientId: _id, // ✅ 可选：给前端明确一个“Mongo主键”
  };
}

export function toClientList(list = []) {
  return Array.isArray(list) ? list.map(toClient) : [];
}
