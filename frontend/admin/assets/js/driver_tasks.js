// assets/js/driver_tasks.js
// =====================================
// 司机端：今日配送任务 + Google Maps 导航
// =====================================

console.log("driver_tasks.js 已加载");

let driverOrders = []; // 当前司机今日的所有配送订单

// 统一取出订单的配送地址（后端有 fullAddress 就直接用）
function getOrderAddress(order) {
  if (order.fullAddress) return order.fullAddress;

  const addr =
    order.address ||
    order.shippingAddress ||
    [
      order.street || "",
      order.city || "",
      order.state || "",
      order.zip || "",
    ]
      .filter(Boolean)
      .join(", ");

  return addr;
}

// 单个地址的 Google Maps 导航 URL
function buildSingleNavUrl(order) {
  const addr = getOrderAddress(order);
  if (order.lat && order.lng) {
    // 如果你后面在后端加了精确坐标，就会用到这条
    return `https://www.google.com/maps/dir/?api=1&destination=${order.lat},${order.lng}&travelmode=driving`;
  }
  const encoded = encodeURIComponent(addr);
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
}

// 多站点 Google Maps 路线 URL
// orders: 当前要送的一批订单
// originAddress: 出发地点（仓库/门店地址）
function buildMultiStopRouteUrl(orders, originAddress) {
  if (!orders || !orders.length) return "";

  const origin = encodeURIComponent(originAddress);

  const addresses = orders
    .map((o) => getOrderAddress(o))
    .filter((a) => !!a);

  if (!addresses.length) return "";

  // 终点 = 最后一个地址；中间都是途经点
  const destination = encodeURIComponent(addresses[addresses.length - 1]);
  const waypoints = addresses
    .slice(0, -1)
    .map((a) => encodeURIComponent(a))
    .join("|");

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  if (waypoints) {
    url += `&waypoints=${waypoints}`;
  }
  url += `&travelmode=driving`;

  return url;
}

// 渲染司机今日订单列表
function renderDriverOrders() {
  const tbody = document.getElementById("driverOrdersTbody");
  const summaryEl = document.getElementById("driverTasksSummary");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!driverOrders.length) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td colspan="4" style="text-align:center;">暂无配送任务</td>';
    tbody.appendChild(tr);
    if (summaryEl) summaryEl.textContent = "暂无任务";
    return;
  }

  let totalOrders = driverOrders.length;

  driverOrders.forEach((o) => {
    const tr = document.createElement("tr");

    const addr = getOrderAddress(o);
    const navUrl = buildSingleNavUrl(o);

    const customerName = o.customerName || o.user?.name || "-";
    const customerPhone = o.customerPhone || o.user?.phone || "";

    tr.innerHTML = `
      <td>${o.orderNo || o._id || o.id}</td>
      <td>
        ${customerName}<br/>
        <span style="font-size:11px;color:#9ca3af;">${customerPhone}</span>
      </td>
      <td class="driver-address">
        ${
          addr
            ? addr
            : "<span style='color:#f97316;'>无地址，请检查订单</span>"
        }
      </td>
      <td>
        <a
          href="${navUrl}"
          target="_blank"
          class="admin-btn admin-btn-ghost admin-btn-sm"
        >
          🚗 单笔导航
        </a>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (summaryEl) {
    summaryEl.textContent = `共 ${totalOrders} 单待配送`;
  }
}

// 从后端加载当前司机的任务列表
async function loadDriverOrders() {
  const tbody = document.getElementById("driverOrdersTbody");
  const summaryEl = document.getElementById("driverTasksSummary");

  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;">正在加载...</td></tr>';
  }
  if (summaryEl) {
    summaryEl.textContent = "正在加载配送任务...";
  }

  try {
    const token = localStorage.getItem("driverToken"); // 以后你司机登录时可以设置这个
    const res = await fetch("/api/driver/orders/today", {
      headers: token
        ? {
            Authorization: "Bearer " + token,
          }
        : {},
    });

    const data = await res.json();

    // 兼容几种返回格式
    if (Array.isArray(data)) {
      driverOrders = data;
    } else if (data.success && Array.isArray(data.orders)) {
      driverOrders = data.orders;
    } else if (Array.isArray(data.items)) {
      driverOrders = data.items;
    } else {
      console.warn("司机订单接口返回格式不符合预期:", data);
      driverOrders = [];
    }

    renderDriverOrders();
  } catch (err) {
    console.error("获取司机订单失败:", err);
    driverOrders = [];
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:#fca5a5;">加载失败，请稍后重试</td></tr>';
    }
    if (summaryEl) {
      summaryEl.textContent = "加载失败";
    }
  }
}

// 初始化一键路线按钮
function initMultiRouteButton() {
  const btn = document.getElementById("btnDriverRouteAll");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (!driverOrders.length) {
      alert("当前没有配送任务");
      return;
    }

    // ⭐ 这里改成你的出发地点：仓库/门店地址（中文或英文都可以）
    const originAddress = "Freshbuy, Flushing, NY"; // TODO: 替换成你的真实地址

    const url = buildMultiStopRouteUrl(driverOrders, originAddress);
    if (!url) {
      alert("无法生成路线，请检查订单地址是否完整");
      return;
    }

    window.open(url, "_blank");
  });
}

// 入口
window.addEventListener("DOMContentLoaded", () => {
  loadDriverOrders();

  const btnRefresh = document.getElementById("btnRefreshDriverOrders");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", loadDriverOrders);
  }

  initMultiRouteButton();
});
