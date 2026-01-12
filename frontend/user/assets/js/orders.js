console.log("📘 orders.js 已加载");

// =========================
// 工具
// =========================
function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

const TOKEN_KEYS = [
  "freshbuy_token",
  "freshbuy_user_token",
  "token",
  "jwt",
  "access_token",
  "auth_token",
];

function getToken() {
  for (const k of TOKEN_KEYS) {
    const v = localStorage.getItem(k);
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function toIdString(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  // ObjectId / { _id: ... } / 其他对象
  try {
    if (typeof v.toString === "function") return v.toString();
  } catch {}
  return String(v);
}

function normalizeOrder(o) {
  // ✅ 先用后端返回的 id（字符串），再兜底 _id
  const id = toIdString(o.id || o._id || o.orderId || "");

  const createdAt = o.createdAt || o.created_time || o.time || Date.now();

  // ✅ 金额字段：优先兼容 MongoDB 版
  const total =
    Number(
      o.totalAmount ??
        o.payment?.amountTotal ??
        o.pricing?.grand ??
        o.grand ??
        o.total ??
        o.amount ??
        0
    ) || 0;

  // ✅ items：兼容后端 /my 返回（不会带 items，只带 itemsCount）
  const items = Array.isArray(o.items)
    ? o.items.map((it) => ({
        name: it.name || it.productName || "",
        qty: Number(it.qty || it.quantity || 1),
      }))
    : [];

  const paymentMethod = o.payment?.method || o.paymentMethod || o.method || "";
  const status = o.status || o.payment?.status || "";

  return { id, createdAt, total, items, paymentMethod, status, raw: o };
}

// =========================
// 主流程：拉取我的订单
// =========================
async function loadUserOrders() {
  const listEl = document.getElementById("ordersList");
  if (!listEl) {
    console.error("❌ 找不到 #ordersList");
    return;
  }

  listEl.innerHTML = `<div class="no-orders">加载中…</div>`;

  // ✅ 1) 优先：从后端拉“我的订单”（带 Authorization）
  try {
    const token = getToken();
    if (!token) {
      console.warn("⚠️ 未找到 token，无法调用 /api/orders/my，改走本地兜底");
      throw new Error("no token");
    }

    const res = await fetch("/api/orders/my?days=all&limit=50", {
      credentials: "include",
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const data = await res.json().catch(() => ({}));
    console.log("📦 /api/orders/my =", res.status, data);

    if (res.ok && data && data.success && Array.isArray(data.orders)) {
      const orders = data.orders.map(normalizeOrder);

      if (!orders.length) {
        listEl.innerHTML = `<div class="no-orders">暂无订单</div>`;
        return;
      }

      renderOrders(listEl, orders);
      return;
    }

    console.warn("⚠️ 加载我的订单失败，尝试本地兜底：", data?.message || res.status);
  } catch (err) {
    console.warn("⚠️ 请求 /api/orders/my 异常，尝试本地兜底：", err);
  }

  // ✅ 2) 兜底：读本地（兼容旧 key）
  const local1 = safeParse(localStorage.getItem("fresh_orders_v1") || "[]", []);
  const local2 = safeParse(localStorage.getItem("freshbuy_orders") || "[]", []);
  const localOrders = [...local1, ...local2].map(normalizeOrder);

  if (!localOrders.length) {
    listEl.innerHTML = `<div class="no-orders">暂无订单</div>`;
    return;
  }

  renderOrders(listEl, localOrders);
}

// =========================
// 渲染
// =========================
function renderOrders(listEl, orders) {
  listEl.innerHTML = "";

  orders
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach((o) => {
      const card = document.createElement("div");
      card.className = "order-card";

      const timeStr = new Date(o.createdAt).toLocaleString();
      const itemsStr = (o.items || [])
        .map((it) => `${it.name} × ${it.qty}`)
        .join("<br>");

      const payText =
        o.paymentMethod === "stripe"
          ? "信用卡"
          : o.paymentMethod === "wallet"
          ? "钱包"
          : o.paymentMethod === "zelle"
          ? "Zelle"
          : o.paymentMethod
          ? String(o.paymentMethod)
          : "—";

      const statusText = o.status ? String(o.status) : "—";

      card.innerHTML = `
        <div class="order-header">
          <span>订单号：${o.id}</span>
          <span>${timeStr}</span>
        </div>

        <div class="order-items">${itemsStr || ""}</div>

        <div class="order-total">
          <div>总计：$${Number(o.total || 0).toFixed(2)}</div>
          <div style="margin-top:6px; font-size:12px; opacity:.85;">
            支付方式：${payText} ｜ 状态：${statusText}
          </div>
        </div>
      `;

      // ✅ 点击进入详情页（统一用 id 字符串）
      card.addEventListener("click", () => {
        window.location.href = "order_detail.html?orderId=" + encodeURIComponent(o.id);
      });

      listEl.appendChild(card);
    });
}

document.addEventListener("DOMContentLoaded", loadUserOrders);

// 方便你控制台手动刷新
window.__reloadUserOrders = loadUserOrders;
