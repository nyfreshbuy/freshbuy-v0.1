console.log("📘 orders.js 已加载（ULTIMATE）");

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
  try {
    if (typeof v.toString === "function") return v.toString();
  } catch {}
  return String(v);
}

// =========================
// 订单容器（自动找 / 自动建）
// 支持 user_center tab 异步渲染：可重试等待
// =========================
function resolveOrdersListElOnce() {
  const ids = [
    "ordersList",
    "orderList",
    "myOrdersList",
    "userOrdersList",
    "orders",
    "ordersContainer",
  ];

  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }

  // 也兼容 class
  const byClass =
    document.querySelector(".ordersList") ||
    document.querySelector(".orderList") ||
    document.querySelector(".orders-list");

  if (byClass) return byClass;

  return null;
}

function createOrdersListEl() {
  // 🎯 优先插入“用户中心的订单区域 / tab 内容区”
  const host =
    document.querySelector("#tab-orders") ||
    document.querySelector(".tab-orders") ||
    document.querySelector(".tab-content") ||
    document.querySelector(".user-center-content") ||
    document.querySelector("#userCenterContent") ||
    document.getElementById("main") ||
    document.querySelector(".main") ||
    document.querySelector(".container") ||
    document.querySelector("main") ||
    document.body;

  const wrap = document.createElement("div");
  wrap.id = "ordersList";
  wrap.style.cssText = `
    margin-top:12px;
    display:grid;
    gap:12px;
    position:relative;
    z-index:1;
  `;

  host.appendChild(wrap);

  console.warn("⚠️ 页面未找到订单容器，已在可见区域创建 #ordersList", host);
  return wrap;
}
async function resolveOrdersListElWithRetry(retry = 10, intervalMs = 300) {
  for (let i = 0; i < retry; i++) {
    const el = resolveOrdersListElOnce();
    if (el) return el;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // 最后兜底：创建
  return createOrdersListEl();
}

// =========================
// 订单数据归一化
// =========================
function normalizeOrder(o) {
  const id = toIdString(o.id || o._id || o.orderId || "");

  const createdAt = o.createdAt || o.created_time || o.time || Date.now();

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

  const items = Array.isArray(o.items)
    ? o.items.map((it) => ({
        name: it.name || it.productName || "",
        qty: Number(it.qty || it.quantity || 1),
      }))
    : [];

  const paymentMethod = o.payment?.method || o.method || "";
  const status = o.status || o.payment?.status || "";

  return { id, createdAt, total, items, paymentMethod, status, raw: o };
}

// =========================
// 渲染
// =========================
function renderOrders(listEl, orders) {
  listEl.style.display = "grid";
listEl.style.visibility = "visible";
listEl.style.opacity = "1";
  listEl.innerHTML = "";

  orders
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach((o) => {
      const card = document.createElement("div");
      card.className = "order-card";
      card.style.cssText =
        "border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff;cursor:pointer";

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
          : o.paymentMethod || "—";

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span>订单号：${o.id}</span>
          <span>${timeStr}</span>
        </div>

        <div style="margin:8px 0;font-size:13px;color:#374151;">
          ${itemsStr || ""}
        </div>

        <div style="font-size:14px;font-weight:600;">
          总计：$${Number(o.total || 0).toFixed(2)}
        </div>

        <div style="margin-top:6px;font-size:12px;color:#6b7280;">
          支付方式：${payText} ｜ 状态：${o.status || "—"}
        </div>
      `;

      card.addEventListener("click", () => {
        window.location.href =
          "order_detail.html?orderId=" + encodeURIComponent(o.id);
      });

      listEl.appendChild(card);
    });
}

// =========================
// 主流程
// =========================
async function loadUserOrders() {
  const listEl = await resolveOrdersListElWithRetry(10, 300);
  listEl.innerHTML = `<div class="no-orders">加载中…</div>`;

  // ---------- 1) 后端 /api/orders/my ----------
  try {
    const token = getToken();
    if (!token) throw new Error("no token");

    const res = await fetch("/api/orders/my?days=all&limit=50", {
      credentials: "include",
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const data = await res.json().catch(() => ({}));
    console.log("📦 /api/orders/my =", res.status, data);

    if (res.ok && data?.success && Array.isArray(data.orders)) {
      const orders = data.orders.map(normalizeOrder);

      if (!orders.length) {
        listEl.innerHTML = `<div class="no-orders">暂无订单</div>`;
        return;
      }

      renderOrders(listEl, orders);
      return;
    }

    console.warn("⚠️ /api/orders/my 返回失败：", data?.message || res.status);
  } catch (err) {
    console.warn("⚠️ 拉取 /api/orders/my 失败，尝试本地兜底", err);
  }

  // ---------- 2) 本地兜底 ----------
  const local1 = safeParse(localStorage.getItem("fresh_orders_v1") || "[]", []);
  const local2 = safeParse(localStorage.getItem("freshbuy_orders") || "[]", []);
  const orders = [...local1, ...local2].map(normalizeOrder);

  if (!orders.length) {
    listEl.innerHTML = `<div class="no-orders">暂无订单</div>`;
    return;
  }

  renderOrders(listEl, orders);
}

// =========================
// 启动 & 调试
// =========================
function boot() {
  loadUserOrders();

  // ✅ 如果用户中心是 tab 切换：点击后再刷新一次（不依赖你页面结构）
  document.addEventListener("click", (e) => {
    const t = e.target;
    const text = (t?.innerText || "").trim();
    const id = String(t?.id || "");
    const cls = String(t?.className || "");

    // 命中“订单”相关 tab/button 就刷新
    if (
      text.includes("订单") ||
      text.toLowerCase().includes("order") ||
      id.toLowerCase().includes("order") ||
      cls.toLowerCase().includes("order")
    ) {
      setTimeout(loadUserOrders, 200);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

window.__reloadUserOrders = loadUserOrders;
