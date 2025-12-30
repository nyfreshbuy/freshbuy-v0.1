import Zone from "../models/Zone.js";
import { distanceKm } from "./distance.js";

export async function matchZoneByLatLng(lat, lng) {
  const zones = await Zone.find({}).lean();

  let matched = null;
  let minDist = Infinity;

  for (const z of zones) {
    if (!z.center?.lat) continue;

    const d = distanceKm(lat, lng, z.center.lat, z.center.lng);
    if (d <= (z.radiusKm || 5) && d < minDist) {
      minDist = d;
      matched = z;
    }
  }

  return matched; // null 或 zone
}
