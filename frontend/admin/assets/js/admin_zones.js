// frontend/admin/assets/js/admin_zones.js
// ZIP-only 版本：不使用地图
// ✅ 支持：配送星期 deliveryDays + 截单时间 cutoffTime
// ✅ 支持：fakeJoinedOrders + needOrders
// ✅ 修复：保存没反应（DOM 未 ready / 元素 id 不存在）
// ✅ 修复：旧 zone 编辑时 zoneId 回填错误（不要用 _id 覆盖 zoneId）

// =========================
// Token
// =========================
function getAdminToken() {
  return (
    localStorage.getItem("freshbuy_token") ||
    localStorage.getItem("freshbuy_admin_token") ||
    localStorage.getItem("admin_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    ""
  );
}

(function () {
  const API_BASE = "/api/admin/zones";

  // =========================
  // DOM（✅ 延迟到 DOMContentLoaded 再取）
  // =========================
  function mustGet(id) {
    const el = document.getElementById(id);
    if (!el) {
      console.error("❌ zones.html missing element id:", id);
      alert(`zones.html 缺少元素 id="${id}"（所以保存/编辑没反应）`);
      throw new Error("Missing element: " + id);
    }
    return el;
  }

  let elZoneId,
    elZoneName,
    elZoneZips,
    elZoneNote,
    elDeliveryDay,
    elCutoffTime,
    elFakeJoinedOrders,
    elNeedOrders,
    elList,
    btnSave,
    btnNew;

  let editingZone = null;

  // =========================
  // Utils
  // =========================
  function toast(msg) {
    alert(msg);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildAuthHeaders(extra = {}) {
    const token = getAdminToken();
    return {
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function safeReadJson(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, message: "Non-JSON response", _raw: text };
    }
  }

  // =========================
  // ZIP 解析
  // =========================
  function parseZips() {
    const raw = String(elZoneZips?.value || "").trim();
    if (!raw) return [];

    // 1) 正常情况：按分隔符切（支持：逗号/空格/换行/分号）
    let parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // 2) 兜底：如果用户输入成一串纯数字（例如 11362113601136111364）按每 5 位切
    if (parts.length === 1 && /^\d{10,}$/.test(parts[0])) {
      const digits = parts[0];
      parts = [];
      for (let i = 0; i + 5 <= digits.length; i += 5) {
        parts.push(digits.slice(i, i + 5));
      }
    }

    const seen = new Set();
    const out = [];
    for (const z of parts) {
      if (!/^\d{5}$/.test(z)) continue;
      if (seen.has(z)) continue;
      seen.add(z);
      out.push(z);
    }
    return out;
  }

  // =========================
  // API
  // =========================
  async function apiGetZones() {
    const res = await fetch(API_BASE, {
      method: "GET",
      headers: buildAuthHeaders({ Accept: "application/json" }),
    });
    const data = await safeReadJson(res);
    data._http = { ok: res.ok, status: res.status };
    return data;
  }

  async function apiCreateZone(body) {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: buildAuthHeaders({
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(body),
    });
    const data = await safeReadJson(res);
    data._http = { ok: res.ok, status: res.status };
    return data;
  }

  async function apiUpdateZone(id, body) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "PATCH",
      headers: buildAuthHeaders({
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(body),
    });
    const data = await safeReadJson(res);
    data._http = { ok: res.ok, status: res.status };
    return data;
  }

  async function apiDeleteZone(id) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "DELETE",
      headers: buildAuthHeaders({ Accept: "application/json" }),
    });
    const data = await safeReadJson(res);
    data._http = { ok: res.ok, status: res.status };
    return data;
  }

  // =========================
  // Helpers
  // =========================
  function getZoneMongoId(zone) {
    // ✅ 用于 PATCH/DELETE 的真正 id（Mongo _id）
    return zone?._id || zone?.id || "";
  }

  function getZoneZipList(zone) {
    return (
      zone?.zipWhitelist ||
      zone?.zips ||
      zone?.zipWhiteList ||
      zone?.zipList ||
      []
    );
  }

  function getFirstDeliveryDay(zone) {
    if (Array.isArray(zone?.deliveryDays) && zone.deliveryDays.length) {
      const d = Number(zone.deliveryDays[0]);
      if (Number.isFinite(d)) return String(d);
    }
    return "";
  }

  function resetForm() {
    editingZone = null;
    elZoneId.value = "";
    elZoneName.value = "";
    elZoneZips.value = "";
    elZoneNote.value = "";
    if (elDeliveryDay) elDeliveryDay.value = "";
    if (elCutoffTime) elCutoffTime.value = "";
    if (elFakeJoinedOrders) elFakeJoinedOrders.value = "";
    if (elNeedOrders) elNeedOrders.value = "";
    btnSave.textContent = "保存 / 更新";
  }

  function startEditZone(zone) {
    editingZone = zone;

    // ✅ 重要：Zone ID 输入框应该是你自定义的 zoneId，不要把 Mongo _id 塞进去
    elZoneId.value = zone?.zoneId || "";

    elZoneName.value = zone?.name || "";
    // ✅ 回填 ZIP：用换行，适配你现在的多行输入
    elZoneZips.value = (getZoneZipList(zone) || []).join("\n");
    elZoneNote.value = zone?.note || "";

    if (elDeliveryDay) elDeliveryDay.value = getFirstDeliveryDay(zone);
    if (elCutoffTime) elCutoffTime.value = zone?.cutoffTime || "";

    if (elFakeJoinedOrders)
      elFakeJoinedOrders.value = String(zone?.fakeJoinedOrders ?? "");
    if (elNeedOrders) elNeedOrders.value = String(zone?.needOrders ?? "");

    btnSave.textContent = "保存 / 更新（编辑中）";
  }

  // =========================
  // Render List
  // =========================
  function renderList(zones) {
    elList.innerHTML = "";

    zones.forEach((z) => {
      const mongoId = getZoneMongoId(z);
      const zips = getZoneZipList(z);
      const day = getFirstDeliveryDay(z);
      const cutoff = z?.cutoffTime || "";
      const fakeJoined = Number(z?.fakeJoinedOrders || 0);
      const need = Number(z?.needOrders || 50);

      const info = [];
      if (day !== "") info.push(`周${"日一二三四五六"[Number(day)]}配送`);
      if (cutoff) info.push(`截单 ${cutoff}`);
      info.push(`成团：目标 ${need} · 虚假加成 +${fakeJoined}`);

      const div = document.createElement("div");
      div.className = "zone-card";

      div.innerHTML = `
        <div class="title">${escapeHtml(z?.name || "(未命名)")}</div>
        <div class="sub">_id: <b>${escapeHtml(mongoId)}</b></div>
        <div class="sub">${info.join(" · ")}</div>
        <div class="mini">
          <span class="zone-badge">ZIP: ${(zips || []).length}</span>
        </div>
        <div class="btns" style="margin-top:10px;">
          <button class="zone-btn ghost" data-act="edit">编辑</button>
          <button class="zone-btn" style="border-color: rgba(239,68,68,.35); background: rgba(239,68,68,.12);" data-act="del">删除</button>
        </div>
      `;

      div.querySelector('[data-act="edit"]').onclick = () => startEditZone(z);
      div.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`确定删除 Zone：${z?.name || ""} ?`)) return;
        const r = await apiDeleteZone(mongoId);
        if (!(r.success || r.ok)) return toast("删除失败");
        await reload();
      };

      elList.appendChild(div);
    });
  }

  async function reload() {
    const r = await apiGetZones();
    if (!(r.success || r.ok)) return toast("加载 Zone 失败");
    renderList(r.zones || []);
  }

  // =========================
  // Save
  // =========================
  async function onSave() {
    try {
      const name = elZoneName.value.trim();
      const zipWhitelist = parseZips();
      const note = elZoneNote.value || "";
      const zoneId = String(elZoneId.value || "").trim();

      if (!name) return toast("Zone 名称不能为空");
      if (!zipWhitelist.length) return toast("请至少填写 1 个 ZIP");

      const deliveryDayRaw = elDeliveryDay?.value ?? "";
      const cutoffTime = (elCutoffTime?.value || "").trim();

      const fakeJoinedOrders = Number(elFakeJoinedOrders?.value || 0) || 0;
      const needOrders = Number(elNeedOrders?.value || 50) || 50;

      const body = {
        name,
        note,

        // ✅ ZIP（主字段 + 兼容字段一起写）
        zipWhitelist,
        zips: zipWhitelist,

        // ✅ 你的自定义 zoneId
        zoneId,

        polygon: null,

        // ✅ 配送配置
        deliveryDays: deliveryDayRaw !== "" ? [Number(deliveryDayRaw)] : [],
        cutoffTime,
        deliveryModes: ["groupDay"],

        // ✅ 成团展示字段
        fakeJoinedOrders,
        needOrders,
      };

      let r;
      if (editingZone) {
        const mongoId = getZoneMongoId(editingZone);
        if (!mongoId) return toast("编辑中的 Zone 缺少 _id，无法更新");
        r = await apiUpdateZone(mongoId, body);
      } else {
        r = await apiCreateZone(body);
      }

      if (!(r.success || r.ok)) {
        console.error("❌ save failed:", r);
        return toast("保存失败");
      }

      toast("保存成功");
      resetForm();
      await reload();
    } catch (e) {
      console.error("❌ onSave crash:", e);
      toast("保存时 JS 报错了，打开控制台看错误（我也已 console.error）");
    }
  }

  // =========================
  // Boot（✅ 等 DOM ready 再绑定按钮）
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    // 必填
    elZoneId = mustGet("zoneId");
    elZoneName = mustGet("zoneName");
    elZoneZips = mustGet("zoneZips");
    elZoneNote = mustGet("zoneNote");
    elList = mustGet("zonesList");
    btnSave = mustGet("btnSave");
    btnNew = mustGet("btnNew");

    // 可选（zones.html 有就接，没有也不炸）
    elDeliveryDay = document.getElementById("zoneDeliveryDay");
    elCutoffTime = document.getElementById("zoneCutoffTime");

    // ✅ 兼容两种命名
    elFakeJoinedOrders =
      document.getElementById("fakeJoinedOrders") ||
      document.getElementById("zoneFakeJoinedOrders");
    elNeedOrders =
      document.getElementById("needOrders") ||
      document.getElementById("zoneNeedOrders");

    btnSave.addEventListener("click", onSave);
    btnNew.addEventListener("click", resetForm);

    reload();
  });
})();
