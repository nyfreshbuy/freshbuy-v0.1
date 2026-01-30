// frontend/admin/assets/js/admin_zones.js
// ZIP-only 版本：不使用地图
// ✅ 新增支持：配送星期 deliveryDays + 截单时间 cutoffTime

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
  // DOM
  // =========================
  const elZoneId = document.getElementById("zoneId");
  const elZoneName = document.getElementById("zoneName");
  const elZoneZips = document.getElementById("zoneZips");
  const elZoneNote = document.getElementById("zoneNote");

  // ✅ 新增字段（HTML 里必须已存在）
  const elDeliveryDay = document.getElementById("zoneDeliveryDay");
  const elCutoffTime = document.getElementById("zoneCutoffTime");
    // ✅ 新增：成团展示字段（HTML 里必须已存在）
  const elFakeJoinedOrders = document.getElementById("fakeJoinedOrders");
const elNeedOrders = document.getElementById("needOrders");
  const elList = document.getElementById("zonesList");
  const btnSave = document.getElementById("btnSave");
  const btnNew = document.getElementById("btnNew");

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

  // 1) 正常情况：按分隔符切
  let parts = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 2) ✅ 兜底：如果用户输入成一串纯数字（比如 11362113601136111364）
  //    就按每 5 位切分
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
  function getZoneId(zone) {
    return zone?.id || zone?._id || "";
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
    elZoneId.value = zone?.zoneId || zone?.id || "";
    elZoneName.value = zone?.name || "";
    elZoneZips.value = (getZoneZipList(zone) || []).join(",");
    elZoneNote.value = zone?.note || "";

    // ✅ 回填配送字段
    if (elDeliveryDay) elDeliveryDay.value = getFirstDeliveryDay(zone);
    if (elCutoffTime) elCutoffTime.value = zone?.cutoffTime || "";
        // ✅ 回填成团展示字段
    if (elFakeJoinedOrders) elFakeJoinedOrders.value = String(zone?.fakeJoinedOrders ?? "");
    if (elNeedOrders) elNeedOrders.value = String(zone?.needOrders ?? "");
    btnSave.textContent = "保存 / 更新（编辑中）";
  }

  // =========================
  // Render List
  // =========================
  function renderList(zones) {
    elList.innerHTML = "";

    zones.forEach((z) => {
      const id = getZoneId(z);
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
        <div class="sub">_id: <b>${escapeHtml(id)}</b></div>
        <div class="sub">${info.join(" · ") || "未设置配送日"}</div>
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
        const r = await apiDeleteZone(id);
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
    const name = elZoneName.value.trim();
    const zipWhitelist = parseZips();
    const note = elZoneNote.value || "";
    const zoneId = elZoneId.value || "";

    if (!name) return toast("Zone 名称不能为空");
    if (!zipWhitelist.length) return toast("请至少填写 1 个 ZIP");

    const deliveryDayRaw = elDeliveryDay?.value || "";
    const cutoffTime = elCutoffTime?.value || "";

    const body = {
      name,
      note,
      zipWhitelist,
      zips: zipWhitelist,
      zoneId,
      polygon: null,

      // ✅ 新增：配送配置
      deliveryDays: deliveryDayRaw !== "" ? [Number(deliveryDayRaw)] : [],
      cutoffTime: cutoffTime,
      deliveryModes: ["groupDay"],
            // ✅ 新增：成团展示字段
      fakeJoinedOrders: Number(elFakeJoinedOrders?.value || 0) || 0,
      needOrders: Number(elNeedOrders?.value || 50) || 50,
    };

    let r;
    if (editingZone) {
      r = await apiUpdateZone(getZoneId(editingZone), body);
    } else {
      r = await apiCreateZone(body);
    }

    if (!(r.success || r.ok)) return toast("保存失败");
    toast("保存成功");
    resetForm();
    await reload();
  }

  // =========================
  // Boot
  // =========================
  btnSave.onclick = onSave;
  btnNew.onclick = resetForm;
  reload();
})();
