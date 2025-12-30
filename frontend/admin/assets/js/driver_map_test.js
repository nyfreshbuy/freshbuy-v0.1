// assets/js/driver_map_test.js
// 超简版 - 只做：初始化地图 + 拉司机订单 + 打点

console.log("driver_map_test.js 已加载");

let map;

// 真正初始化地图的函数
function initMap() {
  console.log("✅ initMap 被调用了");

  // 先把地图中心放在法拉盛附近
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 40.758, lng: -73.829 }, // Flushing
    zoom: 12,
  });

  const statusEl = document.getElementById("statusText");
  if (statusEl) {
    statusEl.textContent = "地图初始化成功，点击按钮加载司机订单。";
  }
}

// 拉取 /api/driver/orders/today 并打点
async function fetchDriverOrdersAndMark() {
  const statusEl = document.getElementById("statusText");
  if (statusEl) {
    statusEl.textContent = "正在请求 /api/driver/orders/today ...";
  }

  try {
    const res = await fetch("/api/driver/orders/today");
    const data = await res.json();
    console.log("📦 /api/driver/orders/today 返回：", data);

    let orders = [];

    if (Array.isArray(data)) {
      orders = data;
    } else if (data.success && Array.isArray(data.orders)) {
      orders = data.orders;
    } else if (Array.isArray(data.items)) {
      orders = data.items;
    } else {
      console.warn("返回结构不符合预期");
    }

    if (!orders.length) {
      if (statusEl) {
        statusEl.textContent = "接口返回为空，没有任何司机订单。";
      }
      return;
    }

    let hasPoint = false;

    orders.forEach((o, idx) => {
      const lat = typeof o.lat === "number" ? o.lat : null;
      const lng = typeof o.lng === "number" ? o.lng : null;

      console.log(`订单${idx + 1}:`, o);

      if (lat && lng && map) {
        hasPoint = true;
        const pos = { lat, lng };
        new google.maps.Marker({
          position: pos,
          map,
          title: o.customerName || o.user?.name || "配送点",
        });
      }
    });

    if (hasPoint) {
      if (statusEl) {
        statusEl.textContent = "已在地图上为有经纬度的订单打点（详情看控制台）。";
      }
    } else {
      if (statusEl) {
        statusEl.textContent =
          "接口有数据，但没有 lat/lng 字段，无法打点。请检查后端返回。";
      }
    }
  } catch (err) {
    console.error("❌ 请求 /api/driver/orders/today 出错:", err);
    if (statusEl) {
      statusEl.textContent = "请求失败，详情看浏览器控制台。";
    }
  }
}

// 等页面和 Google Maps JS 都加载完，再手动调用 initMap + 绑定按钮
window.addEventListener("load", () => {
  if (window.google && google.maps) {
    console.log("✅ Google Maps JS 已就绪，准备初始化地图");
    initMap();
  } else {
    console.error("❌ Google Maps JS 未加载成功");
  }

  const btn = document.getElementById("btnLoadOrders");
  if (btn) {
    btn.addEventListener("click", fetchDriverOrdersAndMark);
  }
});
