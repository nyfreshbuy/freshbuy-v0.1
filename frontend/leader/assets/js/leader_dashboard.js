function safeMoney(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function safeText(v, fallback = "-") {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

function renderEmptyRow(tbody, text, colSpan = 4) {
  tbody.innerHTML = `
    <tr>
      <td colspan="${colSpan}" style="color:#999;text-align:center;padding:16px;">
        ${text}
      </td>
    </tr>
  `;
}

async function loadStats() {
  const data = await api("/api/leader/dashboard/stats");

  if (!data || !data.ok) return;

  const stats = data.stats || {};

  const todayOrdersEl = document.getElementById("todayOrders");
  const pendingPickupEl = document.getElementById("pendingPickup");
  const weekCommissionEl = document.getElementById("weekCommission");
  const totalCustomersEl = document.getElementById("totalCustomers");

  if (todayOrdersEl) {
    todayOrdersEl.innerText = Number(stats.todayOrders || 0);
  }

  if (pendingPickupEl) {
    pendingPickupEl.innerText = Number(stats.pendingPickupOrders || 0);
  }

  if (weekCommissionEl) {
    weekCommissionEl.innerText = "$" + safeMoney(stats.weekCommission);
  }

  if (totalCustomersEl) {
    totalCustomersEl.innerText = Number(stats.totalCustomers || 0);
  }
}

async function loadOrders() {
  const data = await api("/api/leader/orders?status=pending");

  const tbody = document.getElementById("orderList");
  if (!tbody) return;

  if (!data || !data.ok) {
    renderEmptyRow(tbody, "订单加载失败");
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    renderEmptyRow(tbody, "暂无待处理订单");
    return;
  }

  tbody.innerHTML = "";

  items.forEach((o) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${safeText(o.orderNo)}</td>
      <td>${safeText(o.customerName)}</td>
      <td>$${safeMoney(o.total)}</td>
      <td>${safeText(o.statusText || o.status, "待处理")}</td>
    `;

    tbody.appendChild(tr);
  });
}

async function loadPickups() {
  const data = await api("/api/leader/pickups/today");

  const tbody = document.getElementById("pickupList");
  if (!tbody) return;

  if (!data || !data.ok) {
    renderEmptyRow(tbody, "今日自提加载失败");
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    renderEmptyRow(tbody, "今天暂无自提订单");
    return;
  }

  tbody.innerHTML = "";

  items.forEach((o) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${safeText(o.orderNo)}</td>
      <td>${safeText(o.customerName)}</td>
      <td>${safeText(o.pickupCode, "-")}</td>
      <td>${safeText(o.statusText || o.status, "待处理")}</td>
    `;

    tbody.appendChild(tr);
  });
}

async function init() {
  await loadStats();
  await loadOrders();
  await loadPickups();
}

init();