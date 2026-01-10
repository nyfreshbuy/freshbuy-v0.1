console.log("driver_index.js loaded (NEW) - FIXED ROUTES");

(() => {
  const API_BASE = ""; // 同域部署留空
  const $ = (id) => document.getElementById(id);

  // ====== AUTH（司机端 token 优先 + 兼容你项目里已有 key）======
  const AUTH = {
    tokenKeys: [
      "driver_token",
      "freshbuy_driver_token",
      "access_token",
      "jwt",
      "token",
      "admin_token",
      "freshbuy_token",
      "auth_token",
    ],
    getToken() {
      for (const k of this.tokenKeys) {
        const v = localStorage.getItem(k);
        if (v && String(v).trim()) return String(v).trim();
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

  // ====== UI refs（你页面里需要有这些 id）======
  const dateInput = $("dateInput");
  const batchSelect = $("batchSelect");
  const stopList = $("stopList");
  const routeSub = $("routeSub");
  const hello = $("hello");
  const driverSub = $("driverSub");
  const errBox = $("errBox");
  const okBox = $("okBox");

  const btnLogout = $("btnLogout");
  const btnLoadBatches = $("btnLoadBatches");
  const btnLoadOrders = $("btnLoadOrders");
  const btnRefresh = $("btnRefresh");
  const btnNavAll = $("btnNavAll");
  const btnPing = $("btnPing");

  // 可选：如果你页面里有这些显示位
  const apiHint = $("apiHint");
  const tokenHint = $("tokenHint");
  const countHint = $("countHint");

  // ====== State ======
  let DRIVER = null;
  let BATCHES = [];
  let ORDERS = [];
  let ACTIVE_BATCHKEY = "";

  let ACTIVE_API = {
    me: "",
    batches: "",
    ordersByBatch: "",
    ordersByDate: "",
    delivered: "",
    photo: "",
    ping: "",
  };

  // ====== UI helpers ======
  function showErr(err) {
    let msg = "未知错误";
    let extra = "";

    if (typeof err === "string") {
      msg = err;
    } else if (err && typeof err === "object") {
      msg = err.message || msg;

      if (err._candidates && Array.isArray(err._candidates)) {
        extra +=
          "\n\n尝试过的接口：\n" +
          err._candidates.map((x) => " - " + x.replace(API_BASE, "")).join("\n");
      }
      if (err.status) {
        extra += `\n\nHTTP: ${err.status}`;
      }
      if (err.data && err.data.message) {
        extra += `\n\n后端返回：${err.data.message}`;
      }
    }

    if (errBox) {
      errBox.style.display = "block";
      errBox.textContent = String(msg) + extra;
    } else {
      alert(String(msg) + extra);
    }
    if (okBox) okBox.style.display = "none";
  }

  function showOk(msg) {
    if (okBox) {
      okBox.style.display = "block";
      okBox.textContent = String(msg || "OK");
    }
    if (errBox) errBox.style.display = "none";
  }

  function clearMsg() {
    if (errBox) errBox.style.display = "none";
    if (okBox) okBox.style.display = "none";
  }

  function fmtDateISO(d) {
    const dt = d instanceof Date ? d : new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // ====== fetch ======
  async function fetchJSON(url, options = {}) {
    const token = AUTH.getToken();
    const headers = { ...(options.headers || {}) };

    const hasBody = options.body != null;
    const isForm = hasBody && options.body instanceof FormData;
    if (hasBody && !isForm && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

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

  async function tryFetchCandidates(label, candidates, options) {
    let lastErr = null;
    for (const u of candidates) {
      try {
        const data = await fetchJSON(u, options);
        if (apiHint) apiHint.textContent = u.replace(API_BASE, "");
        return { data, used: u };
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      lastErr._label = label;
      lastErr._candidates = candidates;
    }
    throw lastErr || new Error("All candidates failed");
  }

  function addrToText(addr) {
    if (!addr) return "";
    if (typeof addr === "string") return addr.trim();

    if (typeof addr === "object") {
      const line1 = addr.line1 || addr.address1 || addr.street || "";
      const line2 = addr.line2 || addr.address2 || addr.apt || "";
      const city = addr.city || "";
      const state = addr.state || "";
      const zip = addr.zip || addr.postalCode || "";

      const parts = [line1, line2, city, state, zip].filter(Boolean);
      if (parts.length) return parts.join(" ").replace(/\s+/g, " ").trim();

      try {
        return JSON.stringify(addr);
      } catch {
        return String(addr);
      }
    }

    return String(addr).trim();
  }

  // ====== normalize ======
  function normalizeBatchList(payload) {
    const list = payload?.batches || payload?.data || payload || [];
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => ({
        batchKey: String(x.batchKey || x.key || x._id || x.batch || "").trim(),
        count: Number(x.count || x.orderCount || x.orders || x.total || 0),
        label: String(x.label || x.name || x.title || "").trim(),
      }))
      .filter((x) => x.batchKey);
  }

  function normalizeOrderList(payload) {
    const list =
      payload?.orders ||
      payload?.list ||
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
        o.routeSeq ??
          o.routeIndex ??
          o.route_index ??
          o.sequenceNumber ??
          o.sequenceNo ??
          o.seq ??
          999999
      );

      const addr =
        o.addressText ||
        o.fullAddress ||
        o.address?.fullText ||
        o.address?.full ||
        o.address ||
        o.shippingAddress ||
        o.fulfillment?.address ||
        o.deliveryAddress?.full ||
        "";

      const name =
        o.customerName ||
        o.receiverName ||
        o.address?.name ||
        o.deliveryAddress?.name ||
        o.user?.name ||
        "";

      const phone =
        o.customerPhone ||
        o.receiverPhone ||
        o.address?.phone ||
        o.deliveryAddress?.phone ||
        o.user?.phone ||
        "";

      const amount = Number(o.totalAmount ?? o.amount ?? o.total ?? 0);

      const lat = Number(o.lat ?? o.address?.lat ?? o.deliveryAddress?.lat ?? NaN);
      const lng = Number(o.lng ?? o.address?.lng ?? o.deliveryAddress?.lng ?? NaN);

      return {
        id,
        orderNo,
        status,
        routeIndex: Number.isFinite(routeIndex) ? routeIndex : 999999,
        addr: addrToText(addr),
        name: String(name || "").trim(),
        phone: String(phone || "").trim(),
        amount,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        raw: o,
      };
    });
  }

  function statusBadge(status) {
    const s = String(status || "").toLowerCase();
    if (["done", "delivered", "完成", "已送达"].some((k) => s.includes(String(k).toLowerCase()))) {
      return { text: "已送达", cls: "badge ok" };
    }
    if (["cancel", "取消", "failed", "异常"].some((k) => s.includes(String(k).toLowerCase()))) {
      return { text: "异常/取消", cls: "badge warn" };
    }
    if (!status) return { text: "未开始", cls: "badge dim" };
    return { text: status, cls: "badge dim" };
  }

  function buildGoogleMapsSingle(addrOrLatLng) {
    const q = encodeURIComponent(addrOrLatLng);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  function buildGoogleMapsDirections(stops) {
    const points = stops
      .map((s) => (s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : s.addr))
      .filter(Boolean);

    if (!points.length) return "";

    const maxStops = 22;
    const sliced = points.slice(0, maxStops);
    const origin = encodeURIComponent(sliced[0]);
    const destination = encodeURIComponent(sliced[sliced.length - 1]);
    const waypointsArr = sliced.slice(1, -1);
    const waypoints = waypointsArr.length
      ? `&waypoints=${encodeURIComponent(waypointsArr.join("|"))}`
      : "";
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`;
  }

  // ====== API calls（自动探测）======
  async function loadDriverMe() {
    const candidates = [
      `${API_BASE}/api/users/me`,
      `${API_BASE}/api/driver/me`,
      `${API_BASE}/api/drivers/me`,
    ];
    const { data, used } = await tryFetchCandidates("me", candidates);
    ACTIVE_API.me = used;

    const me = data?.user || data?.driver || data?.data || data;
    const id = String(me?._id || me?.id || "").trim();
    const phone = String(me?.phone || me?.mobile || localStorage.getItem("freshbuy_login_phone") || "").trim();
    const name = String(me?.name || me?.nickname || me?.nick || localStorage.getItem("freshbuy_login_nickname") || "司机").trim();

    DRIVER = { id, phone, name, raw: me };
    if (hello) hello.textContent = `你好，${phone || name || "司机"}`;
    if (driverSub) driverSub.textContent = `当前司机：${name}${phone ? " · " + phone : ""}`;
  }

  async function ping() {
    clearMsg();
    const candidates = [
      `${API_BASE}/api/driver/ping`,
      `${API_BASE}/api/drivers/ping`,
      `${API_BASE}/api/ping`,
    ];
    const { data, used } = await tryFetchCandidates("ping", candidates);
    ACTIVE_API.ping = used;
    showOk(`Ping OK ✅（${used.replace(API_BASE, "")}）`);
    return data;
  }

  // ✅ FIX 1：批次接口换成你后端真实路由：/api/driver/orders/batches
  async function loadBatchesByDate(dateStr) {
    clearMsg();
    if (batchSelect) batchSelect.innerHTML = `<option value="">加载中…</option>`;

    const q = encodeURIComponent(dateStr);
    const candidates = [
      `${API_BASE}/api/driver/orders/batches?date=${q}`, // ✅ 你的 driver_orders.js
      `${API_BASE}/api/driver/batches?date=${q}`,       // 备选（未来别名）
    ];

    const { data, used } = await tryFetchCandidates("batches", candidates);
    ACTIVE_API.batches = used;

    BATCHES = normalizeBatchList(data);

    if (!BATCHES.length) {
      if (batchSelect) batchSelect.innerHTML = `<option value="">当天没有批次</option>`;
      showOk("当天没有可用批次（可能未生成 batchKey / 未派单）");
      return;
    }

    if (batchSelect) {
      batchSelect.innerHTML = [
        `<option value="">请选择批次</option>`,
        ...BATCHES.map((b) => {
          const txt = `${b.batchKey}${b.count ? `（${b.count}单）` : ""}${b.label ? ` · ${b.label}` : ""}`;
          return `<option value="${escapeHtml(b.batchKey)}">${escapeHtml(txt)}</option>`;
        }),
      ].join("");

      batchSelect.value = BATCHES[0].batchKey;
      ACTIVE_BATCHKEY = batchSelect.value;
    }

    showOk(`已加载批次：${BATCHES.length} 个（默认选中第一个）`);
  }

  // ✅ FIX 2：按批次拉单接口换成你后端真实路由：/api/driver/orders/batch/orders
  async function loadOrdersByBatchKey(batchKey) {
    clearMsg();
    if (routeSub) routeSub.textContent = `批次：${batchKey} · 加载中…`;
    if (stopList) stopList.innerHTML = `<div class="hint">加载中…</div>`;

    const q = encodeURIComponent(batchKey);
    const candidates = [
      `${API_BASE}/api/driver/orders/batch/orders?batchKey=${q}`, // ✅ 你的 driver_orders.js
      `${API_BASE}/api/driver/batch/orders?batchKey=${q}`,        // 备选
    ];

    const { data, used } = await tryFetchCandidates("ordersByBatch", candidates);
    ACTIVE_API.ordersByBatch = used;

    ORDERS = normalizeOrderList(data).sort((a, b) => (a.routeIndex || 0) - (b.routeIndex || 0));
    renderOrders();
  }

  // ✅ FIX 3：按日期拉单走你后端真实路由：/api/driver/orders?date=...
  async function loadOrdersByDate(dateStr) {
    clearMsg();
    if (routeSub) routeSub.textContent = `日期：${dateStr} · 加载中…`;
    if (stopList) stopList.innerHTML = `<div class="hint">加载中…</div>`;

    const q = encodeURIComponent(dateStr);
    const candidates = [
      `${API_BASE}/api/driver/orders?date=${q}`,               // ✅ 你的 driver_orders.js
      `${API_BASE}/api/driver/orders/byDate?date=${q}`,        // 备选
      `${API_BASE}/api/driver/orders/date/${q}`,               // 备选
    ];

    const { data, used } = await tryFetchCandidates("ordersByDate", candidates);
    ACTIVE_API.ordersByDate = used;

    ACTIVE_BATCHKEY = "";
    ORDERS = normalizeOrderList(data).sort((a, b) => (a.routeIndex || 0) - (b.routeIndex || 0));
    renderOrders({ mode: "date", dateStr });
  }

  // ====== render ======
  function renderOrders(extra = {}) {
    const mode = extra.mode || "batch";

    if (countHint) countHint.textContent = String(ORDERS.length || 0);

    if (mode === "batch") {
      if (routeSub) {
        routeSub.textContent = ACTIVE_BATCHKEY
          ? `批次：${ACTIVE_BATCHKEY} · 共 ${ORDERS.length} 单`
          : `未选择批次（也可按日期加载）`;
      }
    } else {
      if (routeSub) routeSub.textContent = `日期：${extra.dateStr || ""} · 共 ${ORDERS.length} 单`;
    }

    if (!stopList) return;

    if (!ORDERS.length) {
      stopList.innerHTML =
        `<div class="hint">没有订单。若后台已派单：请确认司机端 token 正确、并确认派单时写入了 driverId / dispatch.batchKey / deliveryDate。</div>`;
      return;
    }

    stopList.innerHTML = ORDERS.map((o, idx) => {
      const badge = statusBadge(o.status);
      const title = `#${idx + 1} · 订单 ${o.orderNo || o.id}`;
      const addrLine = o.addr || "(无地址)";
      const who = [o.name, o.phone].filter(Boolean).join(" · ");
      const amt = o.amount ? `$${Number(o.amount).toFixed(2)}` : "";
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
                ${amt ? `<div><b>金额：</b>${escapeHtml(amt)}</div>` : ``}
              </div>
            </div>
            <div class="${badge.cls}">${escapeHtml(badge.text)}</div>
          </div>

          <div class="actions">
            <a class="btn mini info" href="${navUrl}" target="_blank" rel="noreferrer">单点导航</a>
            <button class="btn mini primary" data-act="delivered" data-id="${escapeHtml(o.id)}">标记送达</button>

            <label class="btn mini" style="cursor:pointer;">
              上传照片
              <input type="file" accept="image/*" capture="environment" style="display:none;"
                data-act="photo" data-id="${escapeHtml(o.id)}" />
            </label>
          </div>
        </div>
      `;
    }).join("");

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

  // ====== actions ======
  async function markDelivered(orderId) {
    if (!orderId) return;
    clearMsg();

    const id = encodeURIComponent(orderId);
    const candidates = [
      `${API_BASE}/api/driver/orders/${id}/delivered`,
      `${API_BASE}/api/driver/order/${id}/delivered`,
      `${API_BASE}/api/driver/orders/${id}/status`,
      `${API_BASE}/api/admin/orders/${id}/status`, // 兜底
    ];

    try {
      const { used } = await tryFetchCandidates(
        "delivered",
        candidates,
        { method: "POST", body: JSON.stringify({ status: "done" }) }
      );
      ACTIVE_API.delivered = used;

      const it = ORDERS.find((x) => x.id === orderId);
      if (it) it.status = "done";
      showOk("已标记送达/完成 ✅");
      renderOrders();
    } catch (e) {
      showErr(`标记失败：${e.message}（后端可能未实现 delivered/status 接口）`);
    }
  }

  async function uploadPhoto(orderId, file) {
    if (!orderId || !file) return;
    clearMsg();

    const id = encodeURIComponent(orderId);
    const form = new FormData();
    form.append("file", file);

    const candidates = [
      `${API_BASE}/api/driver/orders/${id}/photo`,
      `${API_BASE}/api/driver/order/${id}/photo`,
      `${API_BASE}/api/driver/orders/${id}/upload`,
    ];

    let lastErr = null;
    for (const url of candidates) {
      try {
        await fetchJSON(url, { method: "POST", body: form });
        ACTIVE_API.photo = url;
        showOk("照片已上传 ✅");
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    showErr(`上传失败：${lastErr?.message || "未知错误"}（后端可能未实现 photo/upload 接口）`);
  }

  function navAll() {
    if (!ORDERS.length) return showErr("没有订单，无法全程导航");
    const stops = ORDERS.map((o) => ({ addr: o.addr, lat: o.lat, lng: o.lng }));
    const url = buildGoogleMapsDirections(stops);
    if (!url) return showErr("缺少地址/坐标，无法生成路线导航");
    window.open(url, "_blank", "noreferrer");
  }

  // ====== init ======
  async function init() {
    if (tokenHint) tokenHint.textContent = AUTH.getToken() ? "FOUND" : "MISSING";

    if (dateInput) dateInput.value = fmtDateISO(new Date());

    if (btnLogout) {
      btnLogout.addEventListener("click", () => {
        AUTH.clear();
        location.href = "/driver/login.html"; // 没有就改成你的司机登录页
      });
    }

    if (btnPing) {
      btnPing.addEventListener("click", async () => {
        try { await ping(); } catch (e) { showErr(`Ping 失败：${e.message}`); }
      });
    }

    if (btnLoadBatches && dateInput) {
      btnLoadBatches.addEventListener("click", async () => {
        try { await loadBatchesByDate(dateInput.value); }
        catch (e) { showErr(e); }
      });
    }

    if (btnLoadOrders && dateInput) {
      btnLoadOrders.addEventListener("click", async () => {
        try {
          ACTIVE_BATCHKEY = batchSelect ? batchSelect.value : "";

          if (ACTIVE_BATCHKEY) {
            await loadOrdersByBatchKey(ACTIVE_BATCHKEY);
            return;
          }

          if (!BATCHES || BATCHES.length === 0) {
            showErr("当天没有批次：请先在后台生成批次/派单。");
            return;
          }

          ACTIVE_BATCHKEY = BATCHES[0].batchKey;
          if (batchSelect) batchSelect.value = ACTIVE_BATCHKEY;
          await loadOrdersByBatchKey(ACTIVE_BATCHKEY);
        } catch (e) {
          showErr(e);
        }
      });
    }

    if (btnRefresh && dateInput) {
      btnRefresh.addEventListener("click", async () => {
        try {
          if (ACTIVE_BATCHKEY) return await loadOrdersByBatchKey(ACTIVE_BATCHKEY);
          return await loadOrdersByDate(dateInput.value);
        } catch (e) {
          showErr(e);
        }
      });
    }

    if (btnNavAll) btnNavAll.addEventListener("click", navAll);

    if (dateInput) {
      dateInput.addEventListener("change", async () => {
        try {
          await loadBatchesByDate(dateInput.value);
        } catch (e) {
          showErr(e);
        }
      });
    }

    if (batchSelect) {
      batchSelect.addEventListener("change", () => {
        ACTIVE_BATCHKEY = batchSelect.value;
        if (routeSub) {
          routeSub.textContent = ACTIVE_BATCHKEY
            ? `批次：${ACTIVE_BATCHKEY} · 未加载`
            : "未选择批次（可按日期加载）";
        }
      });
    }

    try {
      await loadDriverMe();
    } catch (e) {
      const phone = localStorage.getItem("freshbuy_login_phone") || "";
      const name = localStorage.getItem("freshbuy_login_nickname") || "司机";
      DRIVER = { id: "", phone, name, raw: null };
      if (hello) hello.textContent = `你好，${phone || name || "司机"}`;
      if (driverSub) driverSub.textContent =
        `当前司机：${name}${phone ? " · " + phone : ""}（/api/driver/me 未找到，使用本地兜底）`;
    }

    // 初次自动加载批次（失败不阻断）
    if (dateInput) {
      try {
        await loadBatchesByDate(dateInput.value);
        showOk("已自动加载批次：可直接点“加载订单”");
      } catch (e) {
        showErr(e);
      }
    }
  }

  init().catch((e) => showErr(e));
})();
