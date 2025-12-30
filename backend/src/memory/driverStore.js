// backend/src/memory/driverStore.js
// ======================================
// 司机相关的内存数据（起点信息等）
// 提供：getDriverOrigin / updateDriverOrigin
// ======================================

// 方便确认这个文件真的被加载了
console.log("✅ driverStore.js 已加载");

// 默认起点：Freshbuy 仓库 / 你的仓库地址
let driverOrigin = {
  address: "199-26 48th Ave, Fresh Meadows, NY 11365",
  lat: 40.7392,
  lng: -73.791, // 大致坐标
};

// 获取当前起点
export function getDriverOrigin() {
  return driverOrigin;
}

// 更新起点
// data 可以包含：address / lat / lng
export function updateDriverOrigin(data = {}) {
  const { address, lat, lng } = data;

  if (typeof address === "string" && address.trim()) {
    driverOrigin.address = address.trim();
  }

  if (typeof lat === "number" && typeof lng === "number") {
    driverOrigin.lat = lat;
    driverOrigin.lng = lng;
  }

  return driverOrigin;
}

// （可选）重置起点，方便以后测试用
export function resetDriverOrigin() {
  driverOrigin = {
    address: "199-26 48th Ave, Fresh Meadows, NY 11365",
    lat: 40.7392,
    lng: -73.791,
  };
  return driverOrigin;
}

// 可选：顺手导出一个默认对象（即使用不到也没关系）
export default {
  getDriverOrigin,
  updateDriverOrigin,
  resetDriverOrigin,
};
