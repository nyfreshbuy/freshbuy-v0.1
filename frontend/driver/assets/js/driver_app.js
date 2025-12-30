// frontend/driver/assets/js/driver_app.js
console.log("driver_app.js 已加载");

// ============================
// 1) 全局变量 & 起点配置
// ============================

// 统一的司机起点（配送表 + Google Maps 整条路线都用它）
// 默认就写死你的仓库地址
let currentOrigin = {
  address: "199-26 48th Ave, Fresh Meadows, NY 11365",
  lat: null, // 一开始不写死，后面通过 geocode 算出真实坐标
  lng: null,
};

let map;
let directionsService;
let directionsRenderer;
let geocoder; // 把地址转成经纬度

// 保留 driverOrigin，始终和 currentOrigin 一致
let driverOrigin = currentOrigin;

let driverOrders = [];     // 原始订单列表
let orderedIndices = [];   // 按路线优化后的索引顺序
let currentRouteUrl = "";  // 一键在 Google Maps 打开整条路线的 URL

// 自定义 Marker（起点 + 配送点）
let originMarker = null;
let orderMarkers = [];

// DOM：起点输入框
let driverOriginInputEl = null;


// ============================
// 2) 小工具函数
// ============================

function formatDateTime(str) {
  if (!str) return "-";
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${mm}`;
}

// ⭐ 防御：避免 o 为 undefined
function buildFullAddress(o) {
  if (!o || typeof o !== "object") return "";

  return (
    o.fullAddress ||
    o.address ||
    [o.street, o.city, o.state, o.zip].filter(Boolean).join(", ")
  );
}

// 统一拿订单 ID
function getOrderId(o) {
  return o?._id || o?.id || o?.orderId || o?.orderNo;
}


// ============================
// 3) 地图初始化
// ============================

function initMap() {
  console.log("✅ initMap 被调用");

  map = new google.maps.Map(document.getElementById("driverMap"), {
    center: { lat: 40.758, lng: -73.829 }, // 默认先放法拉盛
    zoom: 12,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    // 关闭默认 A/B/C marker，用我们自己的 0/1/2...
    suppressMarkers: true,
  });

  geocoder = new google.maps.Geocoder();

  const routeSummary = document.getElementById("routeSummary");
  if (routeSummary) {
    routeSummary.textContent = "地图初始化成功，正在加载今日配送任务...";
  }
}


// ============================
// 4) 起点 geocode（保证 0 号点用真实经纬度）
// ============================

// 确保 currentOrigin.lat / lng 有值，再执行回调 cb()
function ensureOriginLatLng(cb) {
  // 已经有经纬度了，直接回调
  if (
    currentOrigin &&
    typeof currentOrigin.lat === "number" &&
    typeof currentOrigin.lng === "number"
  ) {
    console.log("✅ 起点已有经纬度：", currentOrigin);
    if (typeof cb === "function") cb();
    return;
  }

  if (!geocoder) {
    console.warn("⚠ geocoder 未初始化，无法 geocode 起点");
    if (typeof cb === "function") cb();
    return;
  }

  if (!currentOrigin || !currentOrigin.address) {
    console.warn("⚠ currentOrigin.address 为空，无法 geocode 起点");
    if (typeof cb === "function") cb();
    return;
  }

  const addr = currentOrigin.address;
  console.log("🔍 正在根据地址 geocode 起点：", addr);

  geocoder.geocode({ address: addr }, (results, status) => {
    if (
      status === google.maps.GeocoderStatus.OK &&
      Array.isArray(results) &&
      results.length > 0
    ) {
      const loc = results[0].geometry.location;
      currentOrigin.lat = loc.lat();
      currentOrigin.lng = loc.lng();
      driverOrigin = currentOrigin;
      console.log("✅ geocode 完成的起点坐标：", currentOrigin);
    } else {
      console.warn(
        "⚠ geocode 起点失败，用地址 fallback：",
        status,
        results
      );
    }

    if (typeof cb === "function") cb();
  });
}


// ============================
// 5) 起点 marker / 订单 marker 绘制
// ============================

function clearRouteMarkers() {
  if (originMarker) {
    originMarker.setMap(null);
    originMarker = null;
  }
  if (orderMarkers.length) {
    orderMarkers.forEach((m) => m.setMap(null));
    orderMarkers = [];
  }
}

// indices: 按顺序的订单索引数组（例如 [3, 0, 2]）
function drawMarkersForOrderSequence(indices) {
  if (!map) return;

  clearRouteMarkers();

  // 起点 0 号 marker
  if (
    currentOrigin &&
    typeof currentOrigin.lat === "number" &&
    typeof currentOrigin.lng === "number"
  ) {
    originMarker = new google.maps.Marker({
      position: { lat: currentOrigin.lat, lng: currentOrigin.lng },
      map,
      label: "0",
      title: currentOrigin.address || "起点",
    });
  } else {
    console.warn("⚠ currentOrigin 还没有经纬度，0 号 marker 无法显示");
  }

  if (!indices || !indices.length) return;

  // 配送点：1,2,3...
  indices.forEach((idx, seqIndex) => {
    const o = driverOrders[idx];
    if (!o || typeof o.lat !== "number" || typeof o.lng !== "number") return;

    const marker = new google.maps.Marker({
      position: { lat: o.lat, lng: o.lng },
      map,
      label: String(seqIndex + 1),
      title:
        (o.customerName || o.user?.name || "配送点") +
        " · " +
        (buildFullAddress(o) || ""),
    });

    orderMarkers.push(marker);
  });
}


// ============================
// 6) 起点加载 / 保存
// ============================

// 不再从后端读，完全信任 currentOrigin
async function loadDriverOrigin() {
  driverOrigin = currentOrigin;

  if (driverOriginInputEl && currentOrigin.address) {
    driverOriginInputEl.value = currentOrigin.address;
  }

  console.log("⭐ 当前起点 currentOrigin:", currentOrigin);

  // 尝试把地址 geocode 成经纬度（异步）
  ensureOriginLatLng();
}

async function saveDriverOrigin() {
  if (!driverOriginInputEl) return;
  const addr = driverOriginInputEl.value.trim();
  if (!addr) {
    alert("起点地址不能为空");
    return;
  }

  if (!geocoder) {
    geocoder = new google.maps.Geocoder();
  }

  geocoder.geocode({ address: addr }, async (results, status) => {
    if (
      status !== google.maps.GeocoderStatus.OK ||
      !Array.isArray(results) ||
      !results.length
    ) {
      console.error("❌ geocode 解析失败:", status, results);
      alert("无法识别该地址，请确认后再试。");
      return;
    }

    const loc = results[0].geometry.location;
    const lat = loc.lat();
    const lng = loc.lng();

    // 无论后端是否成功，前端先更新 0 号起点
    currentOrigin = {
      address: addr,
      lat,
      lng,
    };
    driverOrigin = currentOrigin;
    console.log("⭐ 保存后的起点 currentOrigin:", currentOrigin);

    try {
      // 尝试通知后端（可以没有实现）
      await fetch("/api/driver/origin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, lat, lng }),
      });
    } catch (err) {
      console.warn("后端保存起点失败（忽略）：", err);
    }

    alert("起点已保存。系统会根据新的起点重新规划路线。");

    if (driverOrders.length) {
      drawOptimizedRoute();
    } else {
      loadDriverOrders();
    }
  });
}


// ============================
// 7) 拉取今日司机订单
// ============================

async function loadDriverOrders() {
  const summaryEl = document.getElementById("ordersSummary");
  const routeSummary = document.getElementById("routeSummary");
  if (summaryEl)
    summaryEl.textContent = "正在从 /api/driver/orders/today 拉取数据...";
  if (routeSummary) routeSummary.textContent = "正在获取今日配送点...";

  try {
    const res = await fetch("/api/driver/orders/today");
    const data = await res.json();
    console.log("📦 /api/driver/orders/today 返回：", data);

    // 起点仍然以 currentOrigin 为准
    driverOrigin = currentOrigin;

    if (driverOriginInputEl && currentOrigin.address) {
      driverOriginInputEl.value = currentOrigin.address;
    }

    driverOrders = Array.isArray(data.orders) ? data.orders : [];
    if (!driverOrders.length) {
      if (summaryEl) summaryEl.textContent = "今日暂无配送任务。";
      if (routeSummary) routeSummary.textContent = "没有配送点，不需要路线规划。";
      const listEl = document.getElementById("driverOrdersList");
      if (listEl) listEl.innerHTML = "";
      currentRouteUrl = "";
      clearRouteMarkers();
      return;
    }

    if (summaryEl)
      summaryEl.textContent = `今日共 ${driverOrders.length} 单配送任务`;

    // ⭐ 重点：先把起点 geocode 出经纬度，再画路线 + 0 号点
    ensureOriginLatLng(() => {
      console.log("🔍 geocode 完成，开始绘制路线");
      drawOptimizedRoute();
    });
  } catch (err) {
    console.error("❌ 获取司机订单失败:", err);
    if (summaryEl) summaryEl.textContent = "获取任务失败，请稍后重试。";
    if (routeSummary) routeSummary.textContent = "无法获取任务数据。";
    currentRouteUrl = "";
  }
}


// ============================
// 8) 绘制最优路线 + 打点
// ============================

function drawOptimizedRoute() {
  const routeSummary = document.getElementById("routeSummary");

  const points = driverOrders
    .map((o, idx) => {
      if (typeof o.lat === "number" && typeof o.lng === "number") {
        return { idx, order: o, location: { lat: o.lat, lng: o.lng } };
      }
      return null;
    })
    .filter(Boolean);

  // 没有经纬度：只生成外部 URL（起点仍然显示 0）
  if (!points.length) {
    if (routeSummary)
      routeSummary.textContent =
        "今日任务没有提供经纬度，只在列表中显示地址，但仍可在 Google Maps 打开整条路线。";

    drawMarkersForOrderSequence([]);
    renderOrdersList();
    buildRouteUrlFromOrders(driverOrders);
    return;
  }

  // 只有一个点
  if (points.length === 1) {
    const p = points[0];
    map.setCenter(p.location);
    map.setZoom(14);

    orderedIndices = [p.idx];

    drawMarkersForOrderSequence(orderedIndices);
    renderOrdersList(orderedIndices);
    buildRouteUrlFromOrders([p.order]);

    if (routeSummary) routeSummary.textContent = "只有一个配送点，已在地图上标记。";
    return;
  }

  // 多个点 → Directions API 优化顺序
  let origin;

  // 强制优先用经纬度，保证路线起点和 0 号 marker 一致
  if (
    currentOrigin &&
    typeof currentOrigin.lat === "number" &&
    typeof currentOrigin.lng === "number"
  ) {
    origin = new google.maps.LatLng(currentOrigin.lat, currentOrigin.lng);
  } else if (currentOrigin && currentOrigin.address) {
    origin = currentOrigin.address;
  } else {
    origin = points[0].location;
  }

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
    optimizeWaypoints: true,
  };

  directionsService.route(request, (result, status) => {
    if (status === google.maps.DirectionsStatus.OK) {
      console.log("✅ Directions 路线结果：", result);
      directionsRenderer.setDirections(result);

      const route = result.routes[0];
      const wpOrder = route.waypoint_order || [];

      orderedIndices = [];
      wpOrder.forEach((wpIdx) => {
        orderedIndices.push(points[wpIdx].idx);
      });
      orderedIndices.push(points[points.length - 1].idx);

      drawMarkersForOrderSequence(orderedIndices);
      renderOrdersList(orderedIndices);

      const orderedOrders = orderedIndices.map((i) => driverOrders[i]);
      buildRouteUrlFromOrders(orderedOrders);

      if (routeSummary)
        routeSummary.textContent = `已为 ${points.length} 个配送点绘制最优驾驶路线`;
    } else {
      console.warn("Directions 请求失败：", status);
      if (routeSummary) routeSummary.textContent = "无法请求路线规划，只在地图上打点。";

      orderedIndices = points.map((p) => p.idx);
      drawMarkersForOrderSequence(orderedIndices);

      renderOrdersList(orderedIndices);
      buildRouteUrlFromOrders(points.map((p) => p.order));
    }
  });
}


// ============================
// 9) 渲染订单列表（配送表）
// ============================

function renderOrdersList(indices) {
  const listEl = document.getElementById("driverOrdersList");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (!Array.isArray(driverOrders) || !driverOrders.length) return;

  const useIndices =
    Array.isArray(indices) && indices.length
      ? indices
      : driverOrders.map((_, i) => i);

  useIndices.forEach((idx, displayIndex) => {
    const o = driverOrders[idx];
    if (!o) {
      console.warn("renderOrdersList: 找不到订单，idx =", idx);
      return;
    }

    const card = document.createElement("div");
    card.className = "driver-order-card";

    const addr = buildFullAddress(o);

    const leftHtml = `
      <div class="driver-order-main">
        <div class="driver-order-top">
          <div class="driver-order-name">
            ${displayIndex + 1}. ${o.customerName || o.user?.name || "-"}
          </div>
          <div class="driver-order-tag">${o.orderNo || o._id}</div>
        </div>
        <div class="driver-order-sub">
          电话：${o.customerPhone || o.user?.phone || "-"}
        </div>
        <div class="driver-order-address">
          地址：${addr || "未提供地址"}
        </div>
        <div class="driver-order-sub">
          下单时间：${formatDateTime(o.createdAt)}
        </div>
        ${
          o.photoUrl
            ? '<div class="driver-order-sub" style="color:#22c55e;">已上传送达照片</div>'
            : ""
        }
      </div>
    `;

    const status = o.status || "assigned";
    const statusText =
      (status === "delivered" && "已送达") ||
      (status === "delivering" && "配送中") ||
      (status === "assigned" && "待配送") ||
      status;

    const rightDiv = document.createElement("div");
    rightDiv.className = "driver-order-actions";
    rightDiv.innerHTML = `
      <div class="driver-tag-status ${
        status === "delivered"
          ? "delivered"
          : status === "delivering"
          ? "delivering"
          : ""
      }">${statusText}</div>
      <button class="driver-btn driver-btn-ghost">🧭 导航</button>
      <button class="driver-btn driver-btn-ghost">📷 上传照片</button>
      <button class="driver-btn driver-btn-primary"${
        status === "delivered" ? " disabled" : ""
      }>✅ 完成</button>
    `;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    rightDiv.appendChild(fileInput);

    const [navBtn, photoBtn, completeBtn] = rightDiv.querySelectorAll("button");

    navBtn.addEventListener("click", () => {
      openSingleOrderInGoogleMaps(o);
    });

    photoBtn.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (file) {
        uploadDeliveryPhoto(o, file);
      }
    });

    completeBtn.addEventListener("click", () => {
      const id = getOrderId(o);
      if (!id) {
        alert("缺少订单 ID，无法标记送达");
        return;
      }
      if (completeBtn.disabled) return;
      markOrderDelivered(id);
    });

    card.innerHTML = leftHtml;
    card.appendChild(rightDiv);
    listEl.appendChild(card);
  });
}


// ============================
// 10) 一键开始配送（所有未完成订单）
// ============================

async function startAllDeliveries() {
  if (!driverOrders.length) {
    alert("当前没有配送任务。");
    return;
  }

  if (
    !confirm(
      "确认开始配送所有【尚未送达】的订单？\n\n确认后，这些订单状态会变为【配送中】。"
    )
  ) {
    return;
  }

  try {
    const res = await fetch("/api/driver/orders/start-all", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startedAt: new Date().toISOString() }),
    });
    const data = await res.json();

    if (!data.success) {
      alert("更新失败：" + (data.message || "未知错误"));
      return;
    }

    const updatedList = Array.isArray(data.driverOrders)
      ? data.driverOrders
      : [];

    // 用后端返回的 driverOrders 覆盖本地同 ID 的订单
    driverOrders = driverOrders.map((o) => {
      const id = getOrderId(o);
      const hit = updatedList.find((u) => getOrderId(u) === id);
      return hit || o;
    });

    // 重新渲染列表（路线顺序不变）
    renderOrdersList(orderedIndices);

    alert("所有未送达订单已标记为【配送中】");
  } catch (err) {
    console.error("❌ 一键开始配送失败:", err);
    alert("网络错误，请稍后重试。");
  }
}


// ============================
// 构建整条路线的 Google Maps 导航 URL（统一用 currentOrigin）
// ============================
function buildRouteUrlFromOrders(orders) {
  let list = [];
  if (orders && orders.length) {
    list = orders;
  } else if (orderedIndices && orderedIndices.length) {
    list = orderedIndices.map((i) => driverOrders[i]);
  } else {
    list = driverOrders;
  }

  if (!list || !list.length) {
    currentRouteUrl = "";
    console.warn("buildRouteUrlFromOrders：订单为空，无法生成路线 URL");
    return;
  }

  // ⭐ 这里优先用“订单里的地址字符串”，保证跟下面配送列表显示的一模一样
  const getLocationString = (o) => {
    const addr = buildFullAddress(o);   // fullAddress / address / street+city...
    if (addr) return addr;

    if (typeof o.lat === "number" && typeof o.lng === "number") {
      return `${o.lat},${o.lng}`;
    }
    return "";
  };

  // ⭐ 起点：优先用 currentOrigin.address，其次用起点的经纬度
  let originStr = "";
  if (currentOrigin && currentOrigin.address) {
    originStr = currentOrigin.address;
  } else if (
    currentOrigin &&
    typeof currentOrigin.lat === "number" &&
    typeof currentOrigin.lng === "number"
  ) {
    originStr = `${currentOrigin.lat},${currentOrigin.lng}`;
  }
  if (!originStr) {
    originStr = getLocationString(list[0]);
  }

  const destStr = getLocationString(list[list.length - 1]);
  const waypointStrs = list.slice(0, -1).map(getLocationString).filter(Boolean);

  if (!originStr || !destStr) {
    currentRouteUrl = "";
    console.warn("buildRouteUrlFromOrders：缺少起点或终点，无法生成 URL", {
      originStr,
      destStr,
      list,
    });
    return;
  }

  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
    originStr
  )}&destination=${encodeURIComponent(destStr)}`;

  if (waypointStrs.length) {
    const wp = waypointStrs.map((s) => encodeURIComponent(s)).join("|");
    url += `&waypoints=${wp}`;
  }

  url += "&travelmode=driving";

  currentRouteUrl = url;
  console.log("✅ 已生成路线 URL:", currentRouteUrl);
}

async function openFullRouteInGoogleMaps() {
  if (!driverOrders.length) {
    await loadDriverOrders();
  }

  if (!currentRouteUrl) {
    console.warn("当前没有生成路线 URL", { driverOrders, orderedIndices });
    alert(
      "当前还没有可用路线。\n\n可能原因：\n1）/api/driver/orders/today 没返回任务；\n2）任务里没有经纬度 lat/lng 且地址缺失；\n\n请先检查接口数据和 Console 日志。"
    );
    return;
  }

  window.open(currentRouteUrl, "_blank");
}

function openSingleOrderInGoogleMaps(order) {
  const addr = buildFullAddress(order);
  if (!addr && !(order.lat && order.lng)) {
    alert("该订单缺少地址信息，无法导航。");
    return;
  }

  let dest = "";
  if (order.lat && order.lng) {
    dest = `${order.lat},${order.lng}`;
  } else {
    dest = addr;
  }

  const url =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    encodeURIComponent(dest) +
    "&travelmode=driving";

  window.open(url, "_blank");
}


// ============================
// 11) 上传送达照片 & 标记送达
// ============================

async function uploadDeliveryPhoto(order, file) {
  const orderId = getOrderId(order);
  if (!orderId) {
    alert("缺少订单 ID，无法上传照片。");
    return;
  }

  const formData = new FormData();
  formData.append("photo", file);

  try {
    const res = await fetch(`/api/driver/orders/${orderId}/photo`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (!data.success) {
      alert("上传失败：" + (data.message || "未知错误"));
      return;
    }

    const idx = driverOrders.findIndex((o) => getOrderId(o) === orderId);
    if (idx !== -1) {
      driverOrders[idx].photoUrl = data.photoUrl;
    }

    alert("送达照片上传成功");
    renderOrdersList(orderedIndices);
  } catch (err) {
    console.error("❌ 上传送达照片失败:", err);
    alert("网络错误，上传失败，请稍后重试。");
  }
}

async function markOrderDelivered(orderId) {
  if (!orderId) return;
  if (!confirm("确认标记该订单为已送达？")) return;

  try {
    const res = await fetch(`/api/driver/orders/${orderId}/complete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();

    if (!data.success) {
      alert("更新失败：" + (data.message || "未知错误"));
      return;
    }

    // 后端返回的是 driverOrder
    const updated = data.driverOrder || data.order;

    const idx = driverOrders.findIndex((o) => getOrderId(o) === orderId);
    if (idx !== -1 && updated) {
      driverOrders[idx] = updated;
    }

    // 如果 orderedIndices 为空，就会在 renderOrdersList 里自动退回用全部订单
    renderOrdersList(orderedIndices);
  } catch (err) {
    console.error("❌ 标记送达失败:", err);
    alert("网络错误，请稍后重试。");
  }
}


// ============================
// 12) 页面加载入口
// ============================

window.addEventListener("load", () => {
  driverOriginInputEl = document.getElementById("driverOriginInput");

  const dateEl = document.getElementById("driverDateText");
  const now = new Date();
  if (dateEl) {
    dateEl.textContent = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}-${String(now.getDate()).padStart(
      2,
      "0"
    )} · 司机端`;
  }

  if (window.google && google.maps) {
    initMap();
    // 先根据地址计算起点经纬度，再加载订单
    loadDriverOrigin();
    loadDriverOrders();
  } else {
    console.error("❌ Google Maps JS 未加载成功");
    const routeSummary = document.getElementById("routeSummary");
    if (routeSummary) {
      routeSummary.textContent =
        "Google 地图脚本未加载，请检查 API Key。";
    }
  }

  const btnRefresh = document.getElementById("btnRefresh");
  if (btnRefresh) btnRefresh.addEventListener("click", () => loadDriverOrders());

  const btnOpenRoute = document.getElementById("btnOpenRouteInMaps");
  if (btnOpenRoute)
    btnOpenRoute.addEventListener("click", openFullRouteInGoogleMaps);

  const btnSaveOrigin = document.getElementById("btnSaveOrigin");
  if (btnSaveOrigin) btnSaveOrigin.addEventListener("click", saveDriverOrigin);

  // ⭐ 一键开始配送按钮
  const btnStartAll = document.getElementById("btnStartAllDeliveries");
  if (btnStartAll) {
    btnStartAll.addEventListener("click", startAllDeliveries);
  }
});
