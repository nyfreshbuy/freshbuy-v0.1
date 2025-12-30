// assets/js/driver_map.js
// =======================================
// 司机端地图导航：多点 + 自动排路线
// =======================================

console.log("driver_map.js 已加载");

let map;
let directionsService;
let directionsRenderer;
let driverOrders = [];
let currentRouteUrl = "";

// 出发点（仓库 / 超市地址）—— 你可以改成自己的
const ORIGIN_ADDRESS = "Freshbuy, Flushing, NY";

// 初始化地图（由 Google Maps 脚本 callback 调用）
window.initMap = function () {
  // 默认初始化到法拉盛附近
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 40.758, lng: -73.829 },
    zoom: 12,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false, // 依然绘制 marker
  });

  // 地图准备好之后再拉订单
  loadDriverOrders();
};

// 从后端拿今日司机订单
async function loadDriverOrders() {
  const tbody = document.getElementById("driverRouteTbody");
  const summaryEl = document.getElementById("routeSummary");

  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align:center;">正在加载...</td></tr>';
  }
  if (summaryEl) {
    summaryEl.textContent = "正在加载任务...";
  }

  try {
    const token = localStorage.getItem("driverToken");

    const res = await fetch("/api/driver/orders/today", {
      headers: token
        ? {
            Authorization: "Bearer " + token,
          }
        : {},
    });

    const data = await res.json();

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

    renderOrderList();
    drawRouteOnMap();
  } catch (err) {
    console.error("获取司机订单失败:", err);
    driverOrders = [];
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="3" style="text-align:center;color:#fca5a5;">加载失败</td></tr>';
    }
    if (summaryEl) {
      summaryEl.textContent = "加载失败";
    }
  }
}

// 渲染右侧列表（按 Google 优化后的顺序，会后面更新）
function renderOrderList(orderedIndices) {
  const tbody = document.getElementById("driverRouteTbody");
  const orders = driverOrders || [];

  if (!tbody) return;

  tbody.innerHTML = "";

  if (!orders.length) {
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align:center;">暂无配送任务</td></tr>';
    return;
  }

  const indices =
    orderedIndices && orderedIndices.length
      ? orderedIndices
      : orders.map((_, idx) => idx);

  indices.forEach((idx, displayIndex) => {
    const o = orders[idx];
    const tr = document.createElement("tr");

    const addr =
      o.fullAddress ||
      o.address ||
      [
        o.street || "",
        o.city || "",
        o.state || "",
        o.zip || "",
      ]
        .filter(Boolean)
        .join(", ");

    tr.innerHTML = `
      <td>${displayIndex + 1}</td>
      <td>
        ${o.customerName || o.user?.name || "-"}<br/>
        <span style="font-size:11px;color:#9ca3af;">${
          o.customerPhone || o.user?.phone || ""
        }</span>
      </td>
      <td class="driver-address">${addr}</td>
    `;

    tbody.appendChild(tr);
  });
}

// 在地图上画路线 + 自动排顺序
function drawRouteOnMap() {
  const orders = driverOrders || [];
  const summaryEl = document.getElementById("routeSummary");

  // 筛出有经纬度的订单
  const points = orders
    .map((o) => {
      if (typeof o.lat === "number" && typeof o.lng === "number") {
        return {
          order: o,
          location: { lat: o.lat, lng: o.lng },
        };
      }
      return null;
    })
    .filter(Boolean);

  if (!points.length) {
    if (summaryEl) {
      summaryEl.textContent = "没有经纬度数据，无法在地图上画出路线。";
    }
    return;
  }

  // 如果只有 1 个点，就直接作为终点
  if (points.length === 1) {
    const p = points[0];
    map.setCenter(p.location);
    map.setZoom(14);
    new google.maps.Marker({
      position: p.location,
      map: map,
      title: p.order.customerName || "配送点",
    });
    if (summaryEl) {
      summaryEl.textContent = "只有一个配送点，已在地图上标记。";
    }
    buildOpenInMapsUrl([p.order]);
    renderOrderList();
    return;
  }

  // >1 个点：调用 Directions API
  const origin = ORIGIN_ADDRESS; // 出发点用地址也可以
  const destination = points[points.length - 1].location;
  const waypoints = points.slice(0, -1).map((p) => ({
    location: p.location,
    stopover: true,
  }));

  const request = {
    origin,
    destination,
    waypoints,
    travelMode: google.maps.TravelMode.DRIVING,
    optimizeWaypoints: true, // ⭐ 关键：让 Google 自动排顺序
  };

  directionsService.route(request, (result, status) => {
    if (status === google.maps.DirectionsStatus.OK) {
      directionsRenderer.setDirections(result);

      const route = result.routes[0];

      // waypoint_order 给出优化后的顺序（对应 waypoints 数组的下标）
      const orderIndices = [];
      const waypointOrder = route.waypoint_order || [];

      // 起点不是订单，waypoints 对应 points[0..n-2]，destination 对应 points[n-1]
      waypointOrder.forEach((wpIdx) => {
        orderIndices.push(wpIdx); // 对应 points[wpIdx]
      });
      // 最后一个目的地
      orderIndices.push(points.length - 1);

      // 把每个 point 对应回 driverOrders 的索引
      const orderedDriverOrderIndices = orderIndices.map((pi) => {
        const o = points[pi].order;
        return orders.indexOf(o);
      });

      renderOrderList(orderedDriverOrderIndices);
      buildOpenInMapsUrl(points.map((p) => p.order));

      if (summaryEl) {
        summaryEl.textContent = `已为 ${points.length} 个配送点绘制最优路线`;
      }
    } else {
      console.warn("Directions 请求失败:", status);
      if (summaryEl) {
        summaryEl.textContent = "无法获取路线，请稍后再试。";
      }
    }
  });
}

// 构建一个「在 Google Maps 中打开路线」的 URL
function buildOpenInMapsUrl(orderList) {
  const orders = orderList && orderList.length ? orderList : driverOrders;
  if (!orders || !orders.length) {
    currentRouteUrl = "";
    return;
  }

  const addrs = orders
    .map((o) => {
      return (
        o.fullAddress ||
        o.address ||
        [
          o.street || "",
          o.city || "",
          o.state || "",
          o.zip || "",
        ]
          .filter(Boolean)
          .join(", ")
      );
    })
    .filter(Boolean);

  if (!addrs.length) {
    currentRouteUrl = "";
    return;
  }

  const origin = encodeURIComponent(ORIGIN_ADDRESS);
  const destination = encodeURIComponent(addrs[addrs.length - 1]);
  const waypoints = addrs
    .slice(0, -1)
    .map((a) => encodeURIComponent(a))
    .join("|");

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  if (waypoints) {
    url += `&waypoints=${waypoints}`;
  }
  url += "&travelmode=driving";

  currentRouteUrl = url;
}

// 打开 Google Maps 原生页面导航（司机可以直接用手机跟着走）
function openInGoogleMaps() {
  if (!currentRouteUrl) {
    alert("当前没有可用路线，请先加载任务。");
    return;
  }
  window.open(currentRouteUrl, "_blank");
}

// 事件绑定
window.addEventListener("DOMContentLoaded", () => {
  const btnRefresh = document.getElementById("btnRefreshRoute");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      loadDriverOrders();
    });
  }

  const btnOpenMaps = document.getElementById("btnOpenInGoogleMaps");
  if (btnOpenMaps) {
    btnOpenMaps.addEventListener("click", openInGoogleMaps);
  }
});
