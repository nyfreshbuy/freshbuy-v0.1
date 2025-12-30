// backend/src/routes/addresses.js
import express from "express";
import Address from "../models/Address.js";
import { requireLogin } from "../middlewares/auth.js";
import Zone from "../models/Zone.js";

const router = express.Router();
router.use(express.json());
console.log("✅ addresses.js LOADED:", import.meta.url);

router.get("/ping", (req, res) => {
  res.json({ ok: true, name: "addresses" });
});

/**
 * ===============
 * GET /api/addresses/my
 * - 返回我的地址列表 + defaultAddress（结算页直接用）
 * ===============
 */
router.get("/my", requireLogin, async (req, res) => {
  try {
    const userId = req.user.id;

    const list = await Address.find({ userId }).sort({
      isDefault: -1,
      updatedAt: -1,
      createdAt: -1,
    });

    const defaultAddress = list.find((a) => a.isDefault) || null;

    return res.json({
      success: true,
      addresses: list,
      defaultAddress, // ✅ 结算页拿默认地址
    });
  } catch (err) {
    console.error("GET /api/addresses/my error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Load addresses failed" });
  }
});

/**
 * ===============
 * POST /api/addresses/check-zip
 * body: { zip: "11365" }
 * - 校验 ZIP 是否属于可配送 Zone
 * ===============
 */
router.post("/check-zip", async (req, res) => {
  try {
    const zip = String(req.body?.zip || "").trim();
    if (!zip) {
      return res.status(400).json({ success: false, message: "zip required" });
    }

    const zone = await Zone.findOne({ enabled: true, zips: zip }).lean();

    if (!zone) {
      return res.json({
        success: true,
        supported: false,
        zip,
        message: `暂不支持 ZIP：${zip}（请换一个或先联系客服）`,
      });
    }

    return res.json({
      success: true,
      supported: true,
      zip,
      zone: {
        id: String(zone._id),
        slug: zone.slug,
        name: zone.name,
        zips: zone.zips || [],
        enabled: zone.enabled,
        groupDay: zone.groupDay,
        normal: zone.normal,
        friendGroup: zone.friendGroup,
      },
    });
  } catch (err) {
    console.error("POST /api/addresses/check-zip error:", err);
    return res.status(500).json({ success: false, message: "Check zip failed" });
  }
});

// POST /api/addresses/default
// 结算页专用：保存为默认地址（美国格式 + placeId 必须 + lat/lng 必须）
router.post("/default", requireLogin, async (req, res) => {
  try {
    const userId = req.user.id;
    const a = req.body?.address || {};

    const contactName = String(a.contactName || "").trim();
    const contactPhone = String(a.contactPhone || "").trim();
    const addressLine = String(a.addressLine || "").trim(); // "199-26 48th Ave, Apt 2F"
    const city = String(a.city || "").trim();
    const state = String(a.state || "").trim().toUpperCase();
    const zip = String(a.zip || "").trim();

    // ✅ 验证凭证（前端从 Places 选中后提供）
    const placeId = String(a.placeId || "").trim();
    const formattedAddress = String(a.formattedAddress || "").trim();

    // ✅ 坐标：防伪造 placeId（必须要有）
    const lat = typeof a.lat === "number" ? a.lat : null;
    const lng = typeof a.lng === "number" ? a.lng : null;

    // ---- 必填校验 ----
    if (!contactName || !contactPhone || !addressLine || !city || !state || !zip) {
      return res.status(400).json({
        success: false,
        message: "contactName/contactPhone/addressLine/city/state/zip required",
      });
    }

    if (!/^\d{5}(-\d{4})?$/.test(zip)) {
      return res.status(400).json({
        success: false,
        message: "ZIP 格式不正确（应为 11365 或 11365-1234）",
      });
    }

    if (!/^[A-Z]{2}$/.test(state)) {
      return res.status(400).json({
        success: false,
        message: "state 必须是两位州缩写（如 NY）",
      });
    }

    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: "placeId required (address must be verified by Places selection)",
      });
    }

    // ✅ 必须有坐标（强制只有“真正选过 Places 并取到坐标”的地址才允许设默认）
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({
        success: false,
        message: "lat/lng required (verified address only)",
      });
    }

    // ✅ 强制：只能保存已支持的 ZIP（结算页更合理）
    const zone = await Zone.findOne({ enabled: true, zips: zip }).lean();
    if (!zone) {
      return res.status(400).json({
        success: false,
        message: `暂不支持 ZIP：${zip}（请换一个或先联系客服）`,
      });
    }

    // contactName -> first/last（兼容 Address 模型）
    const parts = contactName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || "User";
    const lastName = parts.slice(1).join(" ") || "User";

    // addressLine -> street1 / apt（简单拆：逗号后当 apt）
    let street1 = addressLine;
    let apt = "";
    const commaIdx = addressLine.indexOf(",");
    if (commaIdx >= 0) {
      street1 = addressLine.slice(0, commaIdx).trim();
      apt = addressLine.slice(commaIdx + 1).trim();
    }

    // 先把旧默认全部清掉
    await Address.updateMany({ userId }, { $set: { isDefault: false } });

    // ✅ 去重优先：同 userId + placeId（更稳）
    // 如果你担心 placeId 为空（这里已强制不为空），所以直接用 placeId 查
    let doc = await Address.findOne({ userId, placeId });

    // fallback：老数据可能没 placeId，用地址字段再兜底
    if (!doc) {
      doc = await Address.findOne({
        userId,
        firstName,
        lastName,
        phone: contactPhone,
        street1,
        apt: apt || "",
        city,
        state,
        zip,
      });
    }

    if (doc) {
      // ✅ 已存在：更新字段 + 设为默认
      doc.firstName = firstName;
      doc.lastName = lastName;
      doc.phone = contactPhone;

      doc.street1 = street1;
      doc.apt = apt || "";
      doc.city = city;
      doc.state = state;
      doc.zip = zip;

      doc.placeId = placeId; // ✅ 落库
      if (formattedAddress) doc.formattedAddress = formattedAddress; // ✅ 落库

      doc.lat = lat;
      doc.lng = lng;

      doc.isDefault = true;

      await doc.save();

      return res.json({
        success: true,
        address: doc,
        defaultAddress: doc,
        updated: true,
        zone: { id: String(zone._id), slug: zone.slug, name: zone.name },
      });
    }

    // ✅ 不存在：新增（placeId / formattedAddress / lat / lng 全落库）
    doc = await Address.create({
      userId,
      firstName,
      lastName,
      phone: contactPhone,
      street1,
      apt: apt || "",
      city,
      state,
      zip,
      placeId, // ✅ 落库
      formattedAddress, // ✅ 落库
      lat,
      lng,
      isDefault: true,

      // note 留给“门禁/备注”用，不要再塞 formattedAddress
      note: String(a.note || "").trim(),
    });

    return res.json({
      success: true,
      address: doc,
      defaultAddress: doc,
      created: true,
      zone: { id: String(zone._id), slug: zone.slug, name: zone.name },
    });
  } catch (err) {
    console.error("POST /api/addresses/default error:", err);
    return res.status(500).json({ success: false, message: "Save default address failed" });
  }
});
/**
 * ===============
 * PUT /api/addresses/:id
 * - 更新某一条地址（不会新增）
 * ===============
 */
router.put("/:id", requireLogin, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const doc = await Address.findOne({ _id: id, userId });
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    const up = req.body || {};

    // 只更新传过来的字段
    if (up.firstName !== undefined) doc.firstName = String(up.firstName).trim();
    if (up.lastName !== undefined) doc.lastName = String(up.lastName).trim();
    if (up.phone !== undefined) doc.phone = String(up.phone).trim();
    if (up.street1 !== undefined) doc.street1 = String(up.street1).trim();
    if (up.apt !== undefined) doc.apt = String(up.apt).trim();
    if (up.city !== undefined) doc.city = String(up.city).trim();
    if (up.state !== undefined) doc.state = String(up.state).trim().toUpperCase();
    if (up.zip !== undefined) doc.zip = String(up.zip).trim();
    if (up.note !== undefined) doc.note = String(up.note).trim();
    if (typeof up.lat === "number") doc.lat = up.lat;
    if (typeof up.lng === "number") doc.lng = up.lng;
    if (up.placeId !== undefined) doc.placeId = String(up.placeId).trim();
    if (up.formattedAddress !== undefined)
      doc.formattedAddress = String(up.formattedAddress).trim();

    // 如果本次设置为默认地址
    if (up.isDefault) {
      await Address.updateMany({ userId }, { $set: { isDefault: false } });
      doc.isDefault = true;
    }

    await doc.save();

    return res.json({
      success: true,
      address: doc,
      updated: true,
    });
  } catch (err) {
    console.error("PUT /api/addresses/:id error:", err);
    return res.status(500).json({
      success: false,
      message: "Update address failed",
    });
  }
});
/**
 * ===============
 * POST /api/addresses
 * - 地址簿新增/去重保存（兼容旧字段）
 * ===============
 */
router.post("/", requireLogin, async (req, res) => {
  try {
    const userId = req.user.id;

    // ✅ 新字段（你现在的前端应该发这些）
    let {
      firstName,
      lastName,
      phone,
      street1,
      apt,
      city,
      state,
      zip,
      isDefault = false,
      lat,
      lng,
      note,
      placeId, // 允许传，但模型里没定义也没关系（严格模式下会忽略）
    } = req.body || {};

    // ✅ 兼容旧字段（老页面可能还在发：name/community/detail）
    const { name, community, detail } = req.body || {};
    if ((!firstName || !lastName) && name) {
      const parts = String(name).trim().split(/\s+/);
      firstName = firstName || parts[0] || "";
      lastName = lastName || parts.slice(1).join(" ") || "User";
    }
    if (!street1 && detail) street1 = String(detail).trim();
    if (!city && community) city = String(community).trim();

    // 统一 trim
    firstName = String(firstName || "").trim();
    lastName = String(lastName || "").trim();
    phone = String(phone || "").trim();
    street1 = String(street1 || "").trim();
    apt = String(apt || "").trim();
    city = String(city || "").trim();
    state = String(state || "").trim().toUpperCase();
    zip = String(zip || "").trim();
    note = String(note || "").trim();

    // ✅ 按 Address 模型必填字段校验
    if (!firstName || !lastName || !street1 || !city || !state || !zip) {
      return res.status(400).json({
        success: false,
        message: "firstName/lastName/street1/city/state/zip required",
      });
    }

    // ZIP 格式校验（和 Address.js 一致）
    if (!/^\d{5}(-\d{4})?$/.test(zip)) {
      return res.status(400).json({
        success: false,
        message: "ZIP 格式不正确（应为 11365 或 11365-1234）",
      });
    }

    // ✅（可选）强制：只能保存已支持的 ZIP
    // 如果你希望“超出配送范围不能保存地址”，就把下面这段解开注释：
    /*
    const zone = await Zone.findOne({ enabled: true, zips: zip }).lean();
    if (!zone) {
      return res.status(400).json({
        success: false,
        message: `暂不支持 ZIP：${zip}（请换一个或先联系客服）`,
      });
    }
    */

    // ✅ 同地址去重：同一个用户 + 同一套地址字段 -> 更新，不重复新增
    const where = {
      userId,
      firstName,
      lastName,
      phone,
      street1,
      apt: apt || "",
      city,
      state,
      zip,
    };

    let doc = await Address.findOne(where);

    if (doc) {
      // 已存在：更新默认/坐标/备注
      if (isDefault) {
        await Address.updateMany({ userId }, { $set: { isDefault: false } });
        doc.isDefault = true;
      }
      if (typeof lat === "number") doc.lat = lat;
      if (typeof lng === "number") doc.lng = lng;
      if (note) doc.note = note;

      await doc.save();
      return res.json({ success: true, address: doc, updated: true });
    }

    // 不存在：新增
    if (isDefault) {
      await Address.updateMany({ userId }, { $set: { isDefault: false } });
    }

    doc = await Address.create({
      userId,
      firstName,
      lastName,
      phone,
      street1,
      apt,
      city,
      state,
      zip,
      isDefault: !!isDefault,
      lat,
      lng,
      note,
    });

    return res.json({ success: true, address: doc, created: true });
  } catch (err) {
    console.error("POST /api/addresses error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Create address failed" });
  }
});

/**
 * ===============
 * PATCH /api/addresses/:id/default
 * - 将某条地址设为默认
 * ===============
 */
router.patch("/:id/default", requireLogin, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const addr = await Address.findOne({ _id: id, userId });
    if (!addr) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }

    await Address.updateMany({ userId }, { $set: { isDefault: false } });
    addr.isDefault = true;
    await addr.save();

    return res.json({ success: true, address: addr, defaultAddress: addr });
  } catch (err) {
    console.error("PATCH /api/addresses/:id/default error:", err);
    return res.status(500).json({ success: false, message: "Set default failed" });
  }
});

/**
 * ===============
 * DELETE /api/addresses/:id
 * - 删除地址（如果删的是默认，默认会变为空；你也可以改成自动选最新的设默认）
 * ===============
 */
router.delete("/:id", requireLogin, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const doc = await Address.findOneAndDelete({ _id: id, userId });
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }

    // 可选：如果删的是默认地址，自动把最新的一条设为默认
    if (doc.isDefault) {
      const latest = await Address.findOne({ userId }).sort({
        updatedAt: -1,
        createdAt: -1,
      });
      if (latest) {
        await Address.updateMany({ userId }, { $set: { isDefault: false } });
        latest.isDefault = true;
        await latest.save();
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/addresses/:id error:", err);
    return res.status(500).json({ success: false, message: "Delete failed" });
  }
});

export default router;
