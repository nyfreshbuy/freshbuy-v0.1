// backend/src/utils/geocoding.js
import "dotenv/config";

// Node 18+ 自带 fetch
// 如果你不是 Node 18：
// import fetch from "node-fetch";

const GEOCODE_BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * 地址 → 经纬度 + zip
 * @param {string} address
 * @returns {Promise<{ lat:number, lng:number, zip:string, formattedAddress:string } | null>}
 */
export async function geocodeAddress(address) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    console.warn("⚠️ 未配置 GOOGLE_MAPS_SERVER_KEY 环境变量");
    return null;
  }

  if (!address) return null;

  const url =
    GEOCODE_BASE_URL +
    `?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.length) {
      console.warn("❌ Geocoding 失败：", data.status, data.error_message);
      return null;
    }

    const r = data.results[0];
    const loc = r.geometry.location;

    // ✅ 提取 zip（postal_code）
    let zip = "";
    for (const c of r.address_components || []) {
      if (c.types.includes("postal_code")) {
        zip = c.long_name;
        break;
      }
    }

    return {
      lat: loc.lat,
      lng: loc.lng,
      zip,
      formattedAddress: r.formatted_address,
    };
  } catch (err) {
    console.error("❌ 调用 Geocoding API 出错:", err);
    return null;
  }
}
