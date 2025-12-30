console.log("📘 orders.js 已加载");

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function normalizeOrder(o) {
  // 兼容 DB 版 / 本地版 各种字段名
  const id = o._id || o.id || o.orderId || "";
  const createdAt = o.createdAt || o.created_time || o.time || Date.now();

  // 金额字段兼容
  const total =
    Number(o.pricing?.grand ?? o.grand ?? o.total ?? o.amount ?? 0) || 0;

  // items 字段兼容
  const items = Array.isArray(o.items)
    ? o.items.map((it) => ({
        name: it.name || it.productName || "",
        qty: Number(it.qty || it.quantity || 1),
      }))
    : [];

  return { id, createdAt, total, items, raw: o };
}

async function loadUserOrders() {
  const listEl = document.getElementById("ordersList");
  if (!listEl) {
    console.error("❌ 找不到 #ordersList");
    return;
  }

  listEl.innerHTML = `<div class="no-orders">加载中…</div>`;

  // 1) 优先：从后端拉“我的订单”
  try {
    const res = await fetch("/api/orders/my", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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

    // 如果后端返回未登录/失败，继续走兜底
    console.warn("⚠️ 加载我的订单失败，尝试本地兜底：", data?.message || res.status);
  } catch (err) {
    console.warn("⚠️ 请求 /api/orders/my 异常，尝试本地兜底：", err);
  }

  // 2) 兜底：读本地（兼容你旧 key）
  const local1 = safeParse(localStorage.getItem("fresh_orders_v1") || "[]", []);
  const local2 = safeParse(localStorage.getItem("freshbuy_orders") || "[]", []);
  const localOrders = [...local1, ...local2].map(normalizeOrder);

  if (!localOrders.length) {
    listEl.innerHTML = `<div class="no-orders">暂无订单</div>`;
    return;
  }

  renderOrders(listEl, localOrders);
}

function renderOrders(listEl, orders) {
  listEl.innerHTML = "";

  orders
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach((o) => {
      const card = document.createElement("div");
      card.className = "order-card";

      const timeStr = new Date(o.createdAt).toLocaleString();
      const itemsStr = (o.items || [])
        .map((it) => `${it.name} × ${it.qty}`)
        .join("<br>");

      card.innerHTML = `
        <div class="order-header">
          <span>订单号：${o.id}</span>
          <span>${timeStr}</span>
        </div>

        <div class="order-items">${itemsStr || ""}</div>

        <div class="order-total">总计：$${Number(o.total || 0).toFixed(2)}</div>
      `;

      // 点击进入详情页（参数改成通用 id）
      card.addEventListener("click", () => {
        window.location.href =
          "order_detail.html?orderId=" + encodeURIComponent(o.id);
      });

      listEl.appendChild(card);
    });
}

document.addEventListener("DOMContentLoaded", loadUserOrders);
