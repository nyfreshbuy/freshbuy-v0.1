// backend/src/routes/admin_picklist.js
import express from "express";
import Order from "../models/order.js";
import { requireLogin } from "../middlewares/auth.js";

const router = express.Router();
router.use(express.json());

console.log("🚀 admin_picklist.js 已加载（/api/admin/picklist/summary）");

// ---------- 工具 ----------
function isISO(s) {
  if (!s) return false;
  const d = new Date(String(s));
  return !Number.isNaN(d.getTime());
}

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// deliverTypes 兼容映射（前端可能传 zone_group / next_day / friend_group）
function expandDeliverTypes(deliverTypes) {
  const input = asArray(deliverTypes).map(String).map((s) => s.trim()).filter(Boolean);
  const out = new Set();

  for (const t of input) {
    if (t === "zone_group" || t === "zoneGroup" || t === "groupDay") {
      ["zone_group", "zoneGroup", "groupDay"].forEach((x) => out.add(x));
      continue;
    }
    if (t === "next_day" || t === "nextDay") {
      ["next_day", "nextDay", "next-day", "nextDayDelivery"].forEach((x) => out.add(x));
      continue;
    }
    if (t === "friend_group" || t === "friendGroup") {
      ["friend_group", "friendGroup"].forEach((x) => out.add(x));
      continue;
    }
    out.add(t);
  }

  return Array.from(out);
}

function buildDeliverMatch(deliverTypes) {
  const expanded = expandDeliverTypes(deliverTypes);
  if (!expanded.length) return null;

  // 兼容你订单里可能的字段名
  return {
    $or: [
      { deliverType: { $in: expanded } },
      { deliveryType: { $in: expanded } },
      { deliveryMode: { $in: expanded } },
      { mode: { $in: expanded } },
    ],
  };
}

function buildZoneMatch(zone) {
  const z = String(zone || "").trim();
  if (!z || z === "all") return null;

  return {
    $or: [
      { zone: z },
      { zoneKey: z },
      { zoneId: z },
      { zoneName: z },
      { resolvedZoneKey: z },
    ],
  };
}

// scope 只是补充过滤（不强行限制，避免空）
// 你如果知道 scope 的固定值，我也可以按你的枚举精确过滤
function buildScopeMatch(scope) {
  const s = String(scope || "").trim();
  if (!s) return null;

  // 常见：只看区域团/拼单
  if (s.includes("zone") || s.includes("group")) {
    return {
      $or: [
        { deliveryMode: "groupDay" },
        { deliverType: "zone_group" },
        { deliveryType: "zone_group" },
      ],
    };
  }
  return null;
}

// ---------- ✅ 正确接口：/api/admin/picklist/summary ----------
router.get("/summary", requireLogin, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, success: false, message: "forbidden" });
    }

    const scope = req.query.scope || "";
    const zone = req.query.zone || "all";
    const deliverTypes = asArray(req.query.deliverTypes);

    const from = req.query.from;
    const to = req.query.to;

    // ---- 组 match ----
    const match = {};

    // 时间范围：默认用 createdAt（如果你项目用 paidAt/placedAt，把这里改掉）
    if (isISO(from) || isISO(to)) {
      match.createdAt = {};
      if (isISO(from)) match.createdAt.$gte = new Date(from);
      if (isISO(to)) match.createdAt.$lte = new Date(to);
    }

    const zoneMatch = buildZoneMatch(zone);
    if (zoneMatch) Object.assign(match, zoneMatch);

    const scopeMatch = buildScopeMatch(scope);
    if (scopeMatch) Object.assign(match, scopeMatch);

    const deliverMatch = buildDeliverMatch(deliverTypes);
    if (deliverMatch) Object.assign(match, deliverMatch);

    // ---- items 字段兼容：items / cartItems / lineItems ----
    const itemsFieldCandidates = ["items", "cartItems", "lineItems"];
    let itemsField = "items";
    try {
      const one = await Order.findOne(match).select("items cartItems lineItems").lean();
      if (one) {
        for (const f of itemsFieldCandidates) {
          if (Array.isArray(one[f]) && one[f].length) {
            itemsField = f;
            break;
          }
        }
      }
    } catch (_) {}

    // ---- 聚合：按 sku+name+spec+unit 汇总 qty/amount ----
    const pipeline = [
      { $match: match },
      { $unwind: `$${itemsField}` },
      {
        $project: {
          sku: { $ifNull: [`$${itemsField}.sku`, ""] },
          name: { $ifNull: [`$${itemsField}.name`, ""] },
          spec: { $ifNull: [`$${itemsField}.spec`, ""] },
          unit: { $ifNull: [`$${itemsField}.unit`, ""] },

          qty: {
            $toDouble: {
              $ifNull: [`$${itemsField}.qty`, `$${itemsField}.quantity`],
            },
          },

          // amount 优先 total/amount，不存在就 qty*price
          amount: {
            $toDouble: {
              $ifNull: [
                `$${itemsField}.totalAmount`,
                `$${itemsField}.amount`,
                `$${itemsField}.total`,
              ],
            },
          },
          price: {
            $toDouble: {
              $ifNull: [`$${itemsField}.price`, `$${itemsField}.unitPrice`],
            },
          },
        },
      },
      {
        $addFields: {
          qty: { $ifNull: ["$qty", 0] },
          amount: {
            $cond: [
              { $gt: ["$amount", 0] },
              "$amount",
              { $multiply: [{ $ifNull: ["$qty", 0] }, { $ifNull: ["$price", 0] }] },
            ],
          },
        },
      },
      {
        $group: {
          _id: { sku: "$sku", name: "$name", spec: "$spec", unit: "$unit" },
          qty: { $sum: "$qty" },
          amount: { $sum: "$amount" },
        },
      },
      {
        $project: {
          _id: 0,
          sku: "$_id.sku",
          name: "$_id.name",
          spec: "$_id.spec",
          unit: "$_id.unit",
          qty: { $round: ["$qty", 3] },
          amount: { $round: ["$amount", 2] },
        },
      },
      { $sort: { name: 1 } },
      { $limit: 5000 },
    ];

    const rows = await Order.aggregate(pipeline).allowDiskUse(true);

    return res.json({
      ok: true,
      success: true,
      items: rows || [],
      meta: {
        scope: String(scope || ""),
        zone: String(zone || ""),
        deliverTypes: expandDeliverTypes(deliverTypes),
        from: String(from || ""),
        to: String(to || ""),
        itemsField,
      },
    });
  } catch (err) {
    console.error("❌ GET /api/admin/picklist/summary error:", err);
    return res.status(500).json({
      ok: false,
      success: false,
      message: "server error",
      detail: err?.message || String(err),
    });
  }
});

export default router;
