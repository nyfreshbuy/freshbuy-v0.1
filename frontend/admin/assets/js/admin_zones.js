// frontend/admin/assets/js/admin_zones.js

// ✅ 从 localStorage 读取 admin token（你项目里就是 freshbuy_token）
function getAdminToken() {
  return localStorage.getItem("freshbuy_token") || "";
}

(function () {
  const API_BASE = "/api/admin/zones";

  const elZoneId = document.getElementById("zoneId"); // 兼容旧 UI，可不填
  const elZoneName = document.getElementById("zoneName");
  const elZoneZips = document.getElementById("zoneZips");
  const elZoneNote = document.getElementById("zoneNote");
  const elList = document.getElementById("zonesList");

  const btnSave = document.getElementById("btnSave");
  const btnNew = document.getElementById("btnNew");
  const btnClearPoly = document.getElementById("btnClearPoly");
  const btnBack = document.getElementById("btnBack"); // 可选

  let map;
  let drawingManager;
  let activePolygon = null;

  // 当前正在编辑的 zone（已有 zone）
  let editingZone = null;

  // 地图上“只读展示”的 zone polygon（来自数据库）
  const rendered = new Map(); // id -> polygon

  // zip 输入防抖
  let zipDebounceTimer = null;
  // 防止 geocode 乱序覆盖（只认最后一次请求）
  let zipReqSeq = 0;

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

  // =========================
  // GeoJSON helpers
  // =========================
  function polygonToGeoJSON(poly) {
    const path = poly.getPath().getArray();
    if (!path.length) return null;

    // GeoJSON 需要闭合：最后一个点=第一个点
    const coords = path.map((p) => [p.lng(), p.lat()]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (!last || last[0] !== first[0] || last[1] !== first[1]) coords.push(first);

    return { type: "Polygon", coordinates: [coords] };
  }

  function geoJSONToPath(geo) {
    const ring = geo?.coordinates?.[0] || [];
    const pts = ring.slice(0, Math.max(0, ring.length - 1)); // 去掉闭合点
    return pts.map(([lng, lat]) => ({ lat, lng }));
  }

  // =========================
  // API helpers
  // =========================
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
  // Polygon state
  // =========================
  function setActivePolygon(poly) {
    if (activePolygon) activePolygon.setEditable(false);
    activePolygon = poly;
    if (activePolygon) activePolygon.setEditable(true);
  }

  function clearActivePolygon() {
    if (activePolygon) {
      activePolygon.setMap(null);
      activePolygon = null;
    }
  }

  function clearRendered() {
    for (const [, poly] of rendered.entries()) {
      try {
        poly.setMap(null);
      } catch {}
    }
    rendered.clear();
  }

  function resetForm() {
    editingZone = null;
    if (elZoneId) elZoneId.value = "";
    if (elZoneName) elZoneName.value = "";
    if (elZoneZips) elZoneZips.value = "";
    if (elZoneNote) elZoneNote.value = "";
    clearActivePolygon();
  }

  function fitBounds(bounds) {
    if (!bounds) return;
    map.fitBounds(bounds);
  }

  function focusZone(zone) {
    const geo = zone?.polygon;
    const path = geoJSONToPath(geo);
    if (!path.length) return;

    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    fitBounds(bounds);
  }

  function getZoneId(zone) {
    return zone?.id || zone?._id || "";
  }

  function getZoneZipList(zone) {
    // ✅ 兼容：新字段 zipWhitelist / 旧字段 zips
    return zone?.zipWhitelist || zone?.zips || [];
  }

  function renderZoneOnMap(zone) {
    const id = getZoneId(zone);
    if (!id) return;

    const old = rendered.get(id);
    if (old) old.setMap(null);

    const path = geoJSONToPath(zone?.polygon);
    if (!path.length) return;

    const poly = new google.maps.Polygon({
      paths: path,
      map,
      clickable: true,
      editable: false,
    });

    poly.addListener("click", () => startEditZone(zone));
    rendered.set(id, poly);
  }

  function startEditZone(zone) {
    editingZone = zone;

    if (elZoneId) elZoneId.value = zone?.zoneId || "";
    if (elZoneName) elZoneName.value = zone?.name || "";
    if (elZoneZips) elZoneZips.value = (getZoneZipList(zone) || []).join("\n");
    if (elZoneNote) elZoneNote.value = zone?.note || "";

    clearActivePolygon();

    const path = geoJSONToPath(zone?.polygon);
    if (path.length) {
      const poly = new google.maps.Polygon({
        paths: path,
        map,
        editable: true,
        clickable: true,
      });
      setActivePolygon(poly);
      focusZone(zone);
    }
  }

  function renderList(zones) {
    if (!elList) return;
    elList.innerHTML = "";

    zones.forEach((z) => {
      const div = document.createElement("div");
      div.className = "card";

      const id = getZoneId(z);
      const zips = getZoneZipList(z);
      const points = (z?.polygon?.coordinates?.[0] || []).length;

      div.innerHTML = `
        <div class="title">${escapeHtml(z?.name || "(未命名)")}</div>
        ${z?.zoneId ? `<div class="sub">zoneId: <b>${escapeHtml(z.zoneId)}</b></div>` : ""}
        <div class="sub">_id: <b>${escapeHtml(id)}</b></div>
        <div class="mini">
          <span class="badge">zips: ${(zips || []).length}</span>
          <span class="badge">points: ${points}</span>
          ${z?.slug ? `<span class="badge">slug: ${escapeHtml(z.slug)}</span>` : ""}
        </div>
        <div class="btns" style="margin-top:10px;">
          <button class="ghost" data-act="edit">编辑</button>
          <button class="ghost" data-act="focus">定位</button>
          <button class="danger" data-act="del">删除</button>
        </div>
      `;

      div.querySelector('[data-act="edit"]').onclick = () => startEditZone(z);
      div.querySelector('[data-act="focus"]').onclick = () => focusZone(z);
      div.querySelector('[data-act="del"]').onclick = async () => {
        if (!id) return toast("缺少 zone id");
        if (!confirm(`确定删除 Zone：${z?.name || ""} ?`)) return;

        const r = await apiDeleteZone(id);
        if (!(r.success || r.ok)) {
          const http = r?._http ? `HTTP ${r._http.status}` : "";
          return toast(`删除失败 ${http}\n${r.message || r.error || "unknown"}`);
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

    clearRendered();
    zones.forEach(renderZoneOnMap);
  }

  // =========================
  // ✅ Zip 自动画框（多 zip 合并）
  // （只做辅助，不再是保存必需项）
  // =========================
  function ensureGeocoder() {
    if (!window.google || !google.maps || !google.maps.Geocoder) return null;
    return new google.maps.Geocoder();
  }

  function boundsToRectanglePolygon(bounds) {
    if (!bounds) return null;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    const nw = new google.maps.LatLng(ne.lat(), sw.lng());
    const se = new google.maps.LatLng(sw.lat(), ne.lng());

    return new google.maps.Polygon({
      paths: [nw, ne, se, sw],
      map,
      editable: true,
      clickable: true,
    });
  }

  function makeFallbackBoundsFromLocation(loc) {
    const lat = loc.lat();
    const lng = loc.lng();
    const d = 0.02;
    return new google.maps.LatLngBounds(
      new google.maps.LatLng(lat - d, lng - d),
      new google.maps.LatLng(lat + d, lng + d)
    );
  }

  function expandBounds(targetBounds, extraBounds) {
    if (!targetBounds || !extraBounds) return targetBounds;
    targetBounds.union(extraBounds);
    return targetBounds;
  }

  function geocodeZipToBounds(geocoder, zip) {
    return new Promise((resolve) => {
      geocoder.geocode(
        { address: zip, componentRestrictions: { country: "US" } },
        (results, status) => {
          console.log("[ZIP GEOCODE]", zip, { status, results });

          if (status !== "OK" || !results || !results.length) {
            resolve({ ok: false, status, bounds: null });
            return;
          }

          const g = results[0].geometry;
          const bounds = g.viewport || g.bounds || null;

          if (bounds) {
            resolve({ ok: true, status, bounds });
            return;
          }

          if (g.location) {
            resolve({
              ok: true,
              status,
              bounds: makeFallbackBoundsFromLocation(g.location),
            });
            return;
          }

          resolve({ ok: false, status, bounds: null });
        }
      );
    });
  }

  async function tryAutoPolygonFromZips(zips, opts = {}) {
    const { silent = false, requestSeq = 0 } = opts;

    const clean = (zips || []).map((z) => String(z).trim()).filter(Boolean);
    if (!clean.length) return { poly: null, bounds: null, used: [] };

    const geocoder = ensureGeocoder();
    if (!geocoder) {
      if (!silent) toast("Geocoder 不可用：请确认 Google Maps 脚本加载成功，并开启 Geocoding API");
      return { poly: null, bounds: null, used: [] };
    }

    let merged = null;
    const used = [];

    for (const zip of clean) {
      if (requestSeq && requestSeq !== zipReqSeq) {
        return { poly: null, bounds: null, used: [] };
      }

      const r = await geocodeZipToBounds(geocoder, zip);

      if (r?.ok && r.bounds) {
        used.push(zip);
        if (!merged) {
          merged = new google.maps.LatLngBounds(
            r.bounds.getSouthWest(),
            r.bounds.getNorthEast()
          );
        } else {
          merged = expandBounds(merged, r.bounds);
        }
      } else {
        console.warn("Zip geocode failed:", zip, r?.status);
      }
    }

    if (!merged) {
      if (!silent)
        toast("Zip 无法定位：请检查 zip 是否正确，或确认 Geocoding API 已开启");
      return { poly: null, bounds: null, used: [] };
    }

    const poly = boundsToRectanglePolygon(merged);
    return { poly, bounds: merged, used };
  }

  async function generatePolygonFromZipNow({ silent = false } = {}) {
    const zips = parseZips();
    if (!zips.length) return;

    const mySeq = ++zipReqSeq;

    const { poly, bounds, used } = await tryAutoPolygonFromZips(zips, {
      silent,
      requestSeq: mySeq,
    });

    if (mySeq !== zipReqSeq) return;
    if (!poly) return;

    clearActivePolygon();
    setActivePolygon(poly);

    if (bounds) fitBounds(bounds);

    if (!silent) {
      if (used.length <= 1)
        toast(`已根据 Zip ${used[0]} 自动生成近似矩形（可继续手动微调）`);
      else
        toast(
          `已根据多个 Zip（${used.join(",")}）合并生成近似矩形（可继续手动微调）`
        );
    }
  }

  function bindZipAutoDraw() {
    if (!elZoneZips) return;

    elZoneZips.addEventListener("input", () => {
      if (zipDebounceTimer) clearTimeout(zipDebounceTimer);
      zipDebounceTimer = setTimeout(() => {
        generatePolygonFromZipNow({ silent: true });
      }, 600);
    });

    elZoneZips.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (zipDebounceTimer) clearTimeout(zipDebounceTimer);
        generatePolygonFromZipNow({ silent: false });
      }
    });

    elZoneZips.addEventListener("blur", () => {
      if (zipDebounceTimer) clearTimeout(zipDebounceTimer);
      generatePolygonFromZipNow({ silent: true });
    });
  }

  // =========================
  // Save logic（✅ ZIP 白名单为硬规则；Polygon 可选）
  // =========================
  async function onSave() {
    const zoneId = String(elZoneId?.value || "").trim(); // 兼容旧 UI，可不填
    const name = String(elZoneName?.value || "").trim();
    const zipWhitelist = parseZips();
    const note = String(elZoneNote?.value || "");

    if (!name) return toast("name 不能为空");
    if (!zipWhitelist.length) return toast("请至少填写 1 个 5 位 ZIP（白名单）");

    const polygon = activePolygon ? polygonToGeoJSON(activePolygon) : null;

    const body = {
      name,
      zipWhitelist, // ✅ 新字段
      note,
      polygon,
      // 兼容旧字段（后端若仍接收也不影响）
      zoneId,
      zips: zipWhitelist,
    };

    const id = editingZone ? getZoneId(editingZone) : "";
    let r;

    if (id) r = await apiUpdateZone(id, body);
    else r = await apiCreateZone(body);

    if (!(r.success || r.ok)) {
      const http = r?._http ? `HTTP ${r._http.status}` : "";
      return toast(`保存失败 ${http}\n${r.message || r.error || "unknown"}`);
    }

    toast("保存成功");
    resetForm();
    await reload();
  }

  // =========================
  // Map init
  // =========================
  function initMap() {
    map = new google.maps.Map(document.getElementById("map"), {
      center: { lat: 40.7392, lng: -73.791 },
      zoom: 12,
    });

    drawingManager = new google.maps.drawing.DrawingManager({
      drawingMode: google.maps.drawing.OverlayType.POLYGON,
      drawingControl: true,
      drawingControlOptions: {
        position: google.maps.ControlPosition.TOP_CENTER,
        drawingModes: ["polygon"],
      },
      polygonOptions: {
        editable: true,
        clickable: true,
      },
    });

    drawingManager.setMap(map);

    google.maps.event.addListener(drawingManager, "overlaycomplete", function (event) {
      if (event.type === google.maps.drawing.OverlayType.POLYGON) {
        clearActivePolygon();
        setActivePolygon(event.overlay);
        drawingManager.setDrawingMode(null);
      }
    });

    if (btnSave) btnSave.onclick = onSave;
    if (btnNew) btnNew.onclick = () => resetForm();
    if (btnClearPoly) btnClearPoly.onclick = () => clearActivePolygon();

    bindZipAutoDraw();

    if (btnBack) {
      btnBack.addEventListener("click", () => {
        window.location.href = "dashboard.html"; // 需要的话改
      });
    }

    reload();
  }

  window.initZonesMap = initMap;
})();
