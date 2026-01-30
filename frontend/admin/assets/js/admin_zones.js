// frontend/admin/assets/js/admin_zones.js
// ZIP-only 版本：不使用地图，不依赖 google.maps
// 功能：Zone 列表 / 编辑回填 / 保存更新 / 删除

// ✅ 兼容读取 admin token（避免 Render 域名下 key 不一致导致 401）
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

  const elZoneId = document.getElementById("zoneId"); // 可选
  const elZoneName = document.getElementById("zoneName");
  const elZoneZips = document.getElementById("zoneZips");
  const elZoneNote = document.getElementById("zoneNote");
  const elList = document.getElementById("zonesList");

  const btnSave = document.getElementById("btnSave");
  const btnNew = document.getElementById("btnNew");
  const btnBack = document.getElementById("btnBack"); // 可选（你 html 里有）

  // 当前正在编辑的 zone（已有 zone）
  let editingZone = null;

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

  // ✅ 统一 zip 解析：支持换行/空格/逗号/分号；去重；只保留 5 位
  function parseZips() {
    const raw = String(elZoneZips?.value || "");
    const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

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
      return {
        ok: false,
        success: false,
        message: "Non-JSON response",
        _raw: text.slice(0, 300),
      };
    }
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
    data._http = { ok: res.ok, status: res.status, statusText: res.statusText };
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
    data._http = { ok: res.ok, status: res.status, statusText: res.statusText };
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
    data._http = { ok: res.ok, status: res.status, statusText: res.statusText };
    return data;
  }

  async function apiDeleteZone(id) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "DELETE",
      headers: buildAuthHeaders({ Accept: "application/json" }),
    });
    const data = await safeReadJson(res);
    data._http = { ok: res.ok, status: res.status, statusText: res.statusText };
    return data;
  }

  // =========================
  // Helpers
  // =========================
  function getZoneId(zone) {
    return zone?.id || zone?._id || "";
  }

  function getZoneZipList(zone) {
    // ✅ 兼容：新字段 zipWhitelist / 旧字段 zips / 其它兼容字段
    return (
      zone?.zipWhitelist ||
      zone?.zips ||
      zone?.zipWhiteList ||
      zone?.zipWhitelist ||
      zone?.zipList ||
      []
    );
  }

  function resetForm() {
    editingZone = null;
    if (elZoneId) elZoneId.value = "";
    if (elZoneName) elZoneName.value = "";
    if (elZoneZips) elZoneZips.value = "";
    if (elZoneNote) elZoneNote.value = "";
  }

  function startEditZone(zone) {
    editingZone = zone;

    if (elZoneId) elZoneId.value = zone?.zoneId || "";
    if (elZoneName) elZoneName.value = zone?.name || "";
    if (elZoneZips) elZoneZips.value = (getZoneZipList(zone) || []).join("\n");
    if (elZoneNote) elZoneNote.value = zone?.note || "";
  }

  // =========================
  // Render List
  // =========================
  function renderList(zones) {
    if (!elList) return;
    elList.innerHTML = "";

    zones.forEach((z) => {
      const div = document.createElement("div");
      div.className = "zone-card"; // ✅ 适配你 zones.html 里的样式（有 zone-card）
      // 如果你的 CSS 还是用 card/title/sub/badge，也能正常显示

      const id = getZoneId(z);
      const zips = getZoneZipList(z);
      const points = (z?.polygon?.coordinates?.[0] || []).length; // 仍显示但不依赖地图

      div.innerHTML = `
        <div class="title">${escapeHtml(z?.name || "(未命名)")}</div>
        ${z?.zoneId ? `<div class="sub">zoneId: <b>${escapeHtml(z.zoneId)}</b></div>` : ""}
        <div class="sub">_id: <b>${escapeHtml(id)}</b></div>
        <div class="mini">
          <span class="zone-badge">zips: ${(zips || []).length}</span>
          <span class="zone-badge">points: ${points}</span>
          ${z?.slug ? `<span class="zone-badge">slug: ${escapeHtml(z.slug)}</span>` : ""}
        </div>
        <div class="btns" style="margin-top:10px;">
          <button class="zone-btn ghost" data-act="edit">编辑</button>
          <button class="zone-btn ghost" data-act="copy">复制ZIP</button>
          <button class="zone-btn" style="border-color: rgba(239,68,68,.35); background: rgba(239,68,68,.12);" data-act="del">删除</button>
        </div>
      `;

      div.querySelector('[data-act="edit"]').onclick = () => startEditZone(z);

      div.querySelector('[data-act="copy"]').onclick = async () => {
        try {
          await navigator.clipboard.writeText((zips || []).join(","));
          toast("已复制 ZIP");
        } catch {
          toast("复制失败（浏览器权限限制）");
        }
      };

      div.querySelector('[data-act="del"]').onclick = async () => {
        if (!id) return toast("缺少 zone id");
        if (!confirm(`确定删除 Zone：${z?.name || ""} ?`)) return;

        const r = await apiDeleteZone(id);
        if (!(r.success || r.ok)) {
  const http = r?._http ? `HTTP ${r._http.status} ${r._http.statusText || ""}`.trim() : "HTTP ?";
  const msg = r?.message || r?.error || "unknown";
  const detail = r?.detail ? `\n${r.detail}` : "";
  const raw = r?._raw ? `\n\n返回片段：\n${r._raw}` : "";
  return toast(`删除失败：${http}\n${msg}${detail}${raw}`);
}
        await reload();
      };

      elList.appendChild(div);
    });
  }

  async function reload() {
    let r;
    try {
      r = await apiGetZones();
    } catch (e) {
      return toast("加载失败：fetch 异常\n" + (e?.message || e));
    }

    const ok = (r && (r.success || r.ok)) === true;

    if (!ok) {
      const http = r?._http;
      const httpInfo = http ? `HTTP ${http.status} ${http.statusText}` : "HTTP ?";
      const msg = r?.message || r?.error || r?.reason || "未知错误";
      const raw = r?._raw ? `\n\n返回内容片段：\n${r._raw}` : "";
      return toast(`加载失败：${httpInfo}\n${msg}${raw}`);
    }

    const zones = r.zones || r.data || r.items || r.list || [];
    renderList(zones);
  }

  // =========================
  // Save logic（✅ ZIP 白名单为硬规则；polygon 可选但 ZIP-only 这里不传 polygon）
  // =========================
  async function onSave() {
    const zoneId = String(elZoneId?.value || "").trim(); // 可选
    const name = String(elZoneName?.value || "").trim();
    const zipWhitelist = parseZips();
    const note = String(elZoneNote?.value || "");

    if (!name) return toast("name 不能为空");
    if (!zipWhitelist.length) return toast("请至少填写 1 个 5 位 ZIP（白名单）");

    const body = {
      name,
      zipWhitelist, // ✅ 新字段
      note,
      polygon: null, // ✅ ZIP-only：不使用地图就不保存 polygon
      // 兼容旧字段（后端若仍接收也不影响）
      zoneId,
      zips: zipWhitelist,
    };

    const id = editingZone ? getZoneId(editingZone) : "";
    let r;

    if (id) r = await apiUpdateZone(id, body);
    else r = await apiCreateZone(body);

    if (!(r.success || r.ok)) {
  const http = r?._http ? `HTTP ${r._http.status} ${r._http.statusText || ""}`.trim() : "HTTP ?";
  const msg = r?.message || r?.error || "unknown";
  const detail = r?.detail ? `\n${r.detail}` : "";
  const raw = r?._raw ? `\n\n返回片段：\n${r._raw}` : "";
  return toast(`保存失败：${http}\n${msg}${detail}${raw}`);
}

    toast("保存成功");
    resetForm();
    await reload();
  }

  // =========================
  // Bind UI & Boot
  // =========================
  function bindUI() {
    if (btnSave) btnSave.onclick = onSave;
    if (btnNew) btnNew.onclick = () => resetForm();

    // ZIP-only：如果页面里还残留 btnClearPoly，我们不需要它
    const btnClearPoly = document.getElementById("btnClearPoly");
    if (btnClearPoly) btnClearPoly.style.display = "none";

    if (btnBack) {
      // 你 zones.html 已经有自己的 back 逻辑，这里不抢
      // 留空即可
    }
  }

  // ✅ 启动：不等地图，直接绑定 + 拉列表
  bindUI();
  reload();
})();
