console.log("driver_index.js loaded");

(() => {
  const API_BASE = ""; // 同域部署留空
  const $ = (id) => document.getElementById(id);

  // ====== AUTH（复用你项目里常见 token 习惯）======
  const AUTH = {
    tokenKeys: ["freshbuy_token", "token", "auth_token", "jwt"],
    getToken() {
      for (const k of this.tokenKeys) {
        const v = localStorage.getItem(k);
        if (v) return v;
      }
      return "";
    },
    clear() {
      for (const k of this.tokenKeys) localStorage.removeItem(k);
      localStorage.removeItem("freshbuy_is_logged_in");
      localStorage.removeItem("freshbuy_login_phone");
      localStorage.removeItem("freshbuy_login_nickname");
    },
  };

  // ====== UI refs ======
  const dateInput = $("dateInput");
  const batchSelect = $("batchSelect");
  const stopList = $("stopList");
  const routeSub = $("routeSub");
  const hello = $("hello");
  const driverSub = $("driverSub");
  const errBox = $("errBox");
  const okBox = $("okBox");

  const btnLogout = $("btnLogout");
  const btnRefreshBatches = $("btnRefreshBatches");
  const btnLoadRoute = $("btnLoadRoute");
  const btnRefreshOrders = $("btnRefreshOrders");
  const btnNavAll = $("btnNavAll");

  // ====== State ======
  let DRIVER = null; // {id,name,phone}
  let BATCHES = [];  // [{batchKey,count,...}]
  let ORDERS = [];   // normalized orders
  let ACTIVE_BATCHKEY = "";

  // ====== Helpers ======
  function showErr(msg) {
    errBox.style.display = "block";
    errBox.textContent = String(msg || "未知错误");
    okBox.style.display = "none";
  }
  function showOk(msg) {
    okBox.style.display = "block";
    okBox.textContent = String(msg || "OK");
    errBox.style.display = "none";
  }
  function clearMsg() {
    errBox.style.display = "none";
    okBox.style.display = "none";
  }

  function fmtDateISO(d) {
    const dt = d instanceof Date ? d : new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  async function fetchJSON(url, options = {}) {
    const token = AUTH.getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || `${res.status} ${res.statusText}`;
      const e = new Error(msg);
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  async function tryFetchCandidates(candidates, options) {
    let lastErr = null;
    for (const u of candidates) {
      try {
        return await fetchJSON(u, options);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("All candidates failed");
  }

  function normalizeBatchList(payload) {
    const list =
      payload?.batches ||
      payload?.data ||
      payload ||
      [];
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => ({
        batchKey: String(x.batchKey || x.key || x._id || "").trim(),
        count: Number(x.count || x.orderCount || x.orders || 0),
        label: x.label || x.name || "",
      }))
      .filter((x) => x.batchKey);
  }

  function normalizeOrderList(payload) {
    const list =
      payload?.orders ||
      payload?.data ||
      payload?.items ||
      payload ||
      [];
    if (!Array.isArray(list)) return [];

    return list.map((o) => {
      const id = String(o._id || o.id || o.orderId || "").trim();
      const orderNo = String(o.orderNo || o.no || o.orderNumber || o.order_id || id).trim();
      const status = String(o.status || o.state || "").trim();
      const routeIndex = Number(
        o.routeIndex ?? o.route_index ?? o.routeOrder ?? o.route_order ?? o.seq ?? 999999
      );

      const addr =
        o.deliveryAddress?.full ||
        o.address?.full ||
        o.deliveryAddress ||
        o.address ||
        o.shippingAddress ||
        o.fulfillment?.address ||
        "";

      const name =
        o.deliveryAddress?.name ||
        o.address?.name ||
        o.receiverName ||
        o.name ||
        "";

      const phone =
        o.deliveryAddress?.phone ||
        o.address?.phone ||
        o.receiverPhone ||
        o.phone ||
        "";

      const amount = Number(o.amount ?? o.total ?? o.totalAmount ?? 0);

      const deliveryMethod =
        o.deliveryMethod ||
        o.shippingMethod ||
        o.dispatch?.mode ||
        o.fulfillment?.mode ||
        "";

      const lat = Number(o.lat ?? o.deliveryAddress?.lat ?? o.address?.lat ?? NaN);
      const lng = Number(o.lng ?? o.deliveryAddress?.lng ?? o.address?.lng ?? NaN);

      const driverId = String(o.driverId || o.driver_id || o.driver?._id || o.driver?.id || "").trim();

      const batchKey = String(
        o.dispatch?.batchKey ||
          o.fulfillment?.batchKey ||
          o.batchKey ||
          o.batch_key ||
          ""
      ).trim();

      return {
        id,
        orderNo,
        status,
        routeIndex,
        addr: String(addr || "").trim(),
        name: String(name || "").trim(),
        phone: String(phone || "").trim(),
        amount,
        deliveryMethod: String(deliveryMethod || "").trim(),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        driverId,
        batchKey,
        raw: o,
      };
    });
  }

  function statusBadge(status) {
    const s = String(status || "").toLowerCase();
    if (["delivered", "完成", "已送达", "delivered_ok"].some((k) => s.includes(k))) {
      return { text: "已送达", cls: "badge badge-ok" };
    }
    if (["cancel", "取消", "failed", "异常"].some((k) => s.includes(k))) {
      return { text: "异常/取消", cls: "badge badge-warn" };
    }
    if (["assigned", "已分配"].some((k) => s.includes(k))) {
      return { text: "已分配", cls: "badge badge-dim" };
    }
    if (!status) return { text: "未开始", cls: "badge badge-dim" };
    return { text: status, cls: "badge badge-dim" };
  }

  function buildGoogleMapsSingle(addrOrLatLng) {
    const q = encodeURIComponent(addrOrLatLng);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  function buildGoogleMapsDirections(stops) {
    // stops: [{addr, lat, lng}]
    const points = stops
      .map((s) => {
        if (s.lat != null && s.lng != null) return `${s.lat},${s.lng}`;
        return s.addr;
      })
      .filter(Boolean);

    if (points.length === 0) return "";

    // Google Maps Directions: origin + destination + waypoints
    // waypoints 数量限制（通常 23 左右），这里做安全截断
    const maxStops = 22; // origin+dest+waypoints <= 22 保险一点
    const sliced = points.slice(0, maxStops);
    const origin = encodeURIComponent(sliced[0]);
    const destination = encodeURIComponent(sliced[sliced.length - 1]);

    const waypointsArr = sliced.slice(1, -1);
    const waypoints =
      waypointsArr.length > 0
        ? `&waypoints=${encodeURIComponent(waypointsArr.join("|"))}`
        : "";

    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`;
  }

  // ====== API mapping（关键：batchKey 对齐后台派单）======
  async function loadDriverMe() {
    // 你后端如果没有这个接口，先用本地存储兜底
    const candidates = [
      `${API_BASE}/api/driver/me`,
      `${API_BASE}/api/drivers/me`,
      `${API_BASE}/api/users/me`, // 如果你项目已有用户 me
    ];

    try {
      const data = await tryFetchCandidates(candidates);
      const me = data?.user || data?.driver || data?.data || data;
      const id = String(me?._id || me?.id || "").trim();
      const phone = String(me?.phone || me?.mobile || localStorage.getItem("freshbuy_login_phone") || "").trim();
      const name = String(me?.name || me?.nickname || me?.nick || localStorage.getItem("freshbuy_login_nickname") || "司机").trim();

      DRIVER = { id, phone, name, raw: me };
      hello.textContent = `你好，${phone || name || "-"}`;
      driverSub.textContent = `当前司机：${name}${phone ? " · " + phone : ""}`;
    } catch (e) {
      // 兜底
      const phone = localStorage.getItem("freshbuy_login_phone") || "";
      const name = localStorage.getItem("freshbuy_login_nickname") || "司机";
      DRIVER = { id: "", phone, name, raw: null };
      hello.textContent = `你好，${phone || name || "-"}`;
      driverSub.textContent = `当前司机：${name}${phone ? " · " + phone : ""}（接口 /api/driver/me 未找到，使用本地兜底）`;
    }
  }

  async function loadBatchesByDate(dateStr) {
    clearMsg();
    batchSelect.innerHTML = `<option value="">加载中…</option>`;

    const q = encodeURIComponent(dateStr);
    const candidates = [
      // ✅ 推荐：司机专用接口
      `${API_BASE}/api/driver/batches?date=${q}`,
      `${API_BASE}/api/driver/dispatch/batches?date=${q}`,
      // ⚠️ 如果你还没做司机接口，临时用 admin 的（不建议生产环境）
      `${API_BASE}/api/admin/dispatch/batches?date=${q}`,
    ];

    const data = await tryFetchCandidates(candidates);
    BATCHES = normalizeBatchList(data);

    if (BATCHES.length === 0) {
      batchSelect.innerHTML = `<option value="">当天没有批次</option>`;
      showOk("当天没有可用批次（可能还未派单/未生成 batchKey）");
      return;
    }

    batchSelect.innerHTML = [
      `<option value="">请选择批次</option>`,
      ...BATCHES.map((b) => {
        const txt = `${b.batchKey}${b.count ? `（${b.count}单）` : ""}`;
        return `<option value="${escapeHtml(b.batchKey)}">${escapeHtml(txt)}</option>`;
      }),
    ].join("");

    // 默认选中第一个
    batchSelect.value = BATCHES[0].batchKey;
    ACTIVE_BATCHKEY = batchSelect.value;
    showOk(`已加载批次：${BATCHES.length} 个`);
  }

  async function loadOrdersByBatchKey(batchKey) {
    clearMsg();
    routeSub.textContent = `批次：${batchKey} · 加载中…`;
    stopList.innerHTML = `<div class="hint">加载中…</div>`;

    const q = encodeURIComponent(batchKey);

    const candidates = [
      // ✅ 推荐：司机接口（只返回分配给该司机的订单）
      `${API_BASE}/api/driver/batch/orders?batchKey=${q}`,
      `${API_BASE}/api/driver/dispatch/batch/orders?batchKey=${q}`,
      `${API_BASE}/api/driver/orders?batchKey=${q}`,
      // ⚠️ 临时：若你只做了 admin 的 batch orders
      `${API_BASE}/api/admin/dispatch/batch/orders?batchKey=${q}`,
    ];

    const data = await tryFetchCandidates(candidates);
    let list = normalizeOrderList(data);

    // 如果返回的是全量订单，这里尽量按 driverId 过滤（如果字段存在）
    if (DRIVER?.id) {
      const hasDriverId = list.some((x) => x.driverId);
      if (hasDriverId) list = list.filter((x) => !x.driverId || x.driverId === DRIVER.id);
    }

    // 排序：routeIndex / seq
    list.sort((a, b) => (a.routeIndex || 0) - (b.routeIndex || 0));

    ORDERS = list;
    renderOrders();
  }

  function renderOrders() {
    if (!ACTIVE_BATCHKEY) {
      routeSub.textContent = "未选择批次";
      stopList.innerHTML = `<div class="hint">请先选择批次。</div>`;
      return;
    }

    routeSub.textContent = `批次：${ACTIVE_BATCHKEY} · 共 ${ORDERS.length} 单`;

    if (ORDERS.length === 0) {
      stopList.innerHTML = `<div class="hint">该批次没有分配给你的订单（或接口返回为空）。</div>`;
      return;
    }

    stopList.innerHTML = ORDERS.map((o, idx) => {
      const badge = statusBadge(o.status);
      const title = `#${idx + 1} · 订单 ${o.orderNo}`;
      const addrLine = o.addr || "(无地址)";
      const who = [o.name, o.phone].filter(Boolean).join(" · ");
      const amt = o.amount ? `$${Number(o.amount).toFixed(2)}` : "";
      const meta2 = [o.deliveryMethod, amt].filter(Boolean).join(" · ");
      const navTarget = o.lat != null && o.lng != null ? `${o.lat},${o.lng}` : addrLine;
      const navUrl = buildGoogleMapsSingle(navTarget);

      return `
        <div class="stop" data-id="${escapeHtml(o.id)}">
          <div class="stop-top">
            <div>
              <h3>${escapeHtml(title)}</h3>
              <div class="meta">
                <div><b>地址：</b>${escapeHtml(addrLine)}</div>
                ${who ? `<div><b>收货：</b>${escapeHtml(who)}</div>` : ``}
                <div><b>路线序：</b>${Number.isFinite(o.routeIndex) ? o.routeIndex : "-"}</div>
                ${meta2 ? `<div>${escapeHtml(meta2)}</div>` : ``}
              </div>
            </div>
            <div class="${badge.cls}">${escapeHtml(badge.text)}</div>
          </div>

          <div class="actions">
            <a class="btn mini" href="${navUrl}" target="_blank" rel="noreferrer">单点导航</a>
            <button class="btn mini btn-primary" data-act="delivered" data-id="${escapeHtml(o.id)}">标记送达</button>

            <label class="btn mini" style="cursor:pointer;">
              上传照片
              <input type="file" accept="image/*" capture="environment" style="display:none;"
                data-act="photo" data-id="${escapeHtml(o.id)}" />
            </label>
          </div>
        </div>
      `;
    }).join("");

    // bind actions
    stopList.querySelectorAll("button[data-act='delivered']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        await markDelivered(id);
      });
    });

    stopList.querySelectorAll("input[type='file'][data-act='photo']").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const id = inp.getAttribute("data-id");
        const file = inp.files && inp.files[0];
        if (!file) return;
        await uploadPhoto(id, file);
        inp.value = "";
      });
    });
  }

  // ====== Actions ======
  async function markDelivered(orderId) {
    if (!orderId) return;
    clearMsg();

    const candidates = [
      `${API_BASE}/api/driver/orders/${encodeURIComponent(orderId)}/delivered`,
      `${API_BASE}/api/driver/order/${encodeURIComponent(orderId)}/delivered`,
      // 临时（不建议）：如果你只有 admin 更新状态接口
      `${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/delivered`,
    ];

    try {
      await tryFetchCandidates(
        candidates,
        { method: "POST", body: JSON.stringify({ status: "delivered" }) }
      );
      showOk("已标记送达 ✅");
      // 本地更新
      const it = ORDERS.find((x) => x.id === orderId);
      if (it) it.status = "delivered";
      renderOrders();
    } catch (e) {
      showErr(`标记送达失败：${e.message}`);
    }
  }

  async function uploadPhoto(orderId, file) {
    if (!orderId || !file) return;
    clearMsg();

    const token = AUTH.getToken();
    const form = new FormData();
    form.append("file", file);

    const candidates = [
      `${API_BASE}/api/driver/orders/${encodeURIComponent(orderId)}/photo`,
      `${API_BASE}/api/driver/order/${encodeURIComponent(orderId)}/photo`,
    ];

    let lastErr = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
        if (!res.ok) throw new Error(data?.message || `${res.status} ${res.statusText}`);
        showOk("照片已上传 ✅");
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    showErr(`上传失败：${lastErr?.message || "未知错误"}（请确认后端是否已实现 photo 接口）`);
  }

  function navAll() {
    if (!ORDERS.length) return showErr("没有路线订单，无法导航");
    const stops = ORDERS.map((o) => ({
      addr: o.addr,
      lat: o.lat,
      lng: o.lng,
    }));
    const url = buildGoogleMapsDirections(stops);
    if (!url) return showErr("缺少地址/坐标，无法生成路线导航");
    window.open(url, "_blank", "noreferrer");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // ====== Init ======
  async function init() {
    // 默认今天
    dateInput.value = fmtDateISO(new Date());

    btnLogout.addEventListener("click", () => {
      AUTH.clear();
      location.href = "/driver/login.html"; // 你如果没有 login.html，就改成你实际司机登录页
    });

    btnRefreshBatches.addEventListener("click", async () => {
      try {
        await loadBatchesByDate(dateInput.value);
      } catch (e) {
        showErr(`加载批次失败：${e.message}`);
      }
    });

    btnLoadRoute.addEventListener("click", async () => {
      ACTIVE_BATCHKEY = batchSelect.value;
      if (!ACTIVE_BATCHKEY) return showErr("请先选择批次");
      try {
        await loadOrdersByBatchKey(ACTIVE_BATCHKEY);
      } catch (e) {
        showErr(`加载路线失败：${e.message}`);
      }
    });

    btnRefreshOrders.addEventListener("click", async () => {
      if (!ACTIVE_BATCHKEY) return showErr("请先选择批次");
      try {
        await loadOrdersByBatchKey(ACTIVE_BATCHKEY);
      } catch (e) {
        showErr(`刷新路线失败：${e.message}`);
      }
    });

    btnNavAll.addEventListener("click", navAll);

    dateInput.addEventListener("change", async () => {
      try {
        await loadBatchesByDate(dateInput.value);
      } catch (e) {
        showErr(`加载批次失败：${e.message}`);
      }
    });

    batchSelect.addEventListener("change", () => {
      ACTIVE_BATCHKEY = batchSelect.value;
      routeSub.textContent = ACTIVE_BATCHKEY ? `批次：${ACTIVE_BATCHKEY} · 未加载` : "未选择批次";
    });

    await loadDriverMe();

    try {
      await loadBatchesByDate(dateInput.value);
    } catch (e) {
      showErr(`加载批次失败：${e.message}`);
    }
  }

  init().catch((e) => showErr(e.message));
})();
