(function () {
  const API_CANDIDATES = [
    // ✅ 你真实接口如果是这个，会优先命中
    "/api/driver/orders",

    // 兼容你可能的旧命名
    "/api/driver/orders/today",
    "/api/driver/tasks",
    "/api/driver/routes/today",
  ];

  const el = (id) => document.getElementById(id);

  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2600);
  }

  function fmtTime(d) {
    const dt = new Date(d || Date.now());
    if (Number.isNaN(dt.getTime())) return "-";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const da = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${da} ${hh}:${mm}`;
  }

  function getSeq(o) {
    if (typeof o.routeSeq === "number") return o.routeSeq;
    if (typeof o.sequenceNumber === "number") return o.sequenceNumber;
    if (typeof o.sequenceNo === "number") return o.sequenceNo;
    return null;
  }

  function getDeliveryType(o) {
    const v = String(
      o.deliveryType ||
        o.fulfillmentType ||
        o.shippingType ||
        o.receiveMode ||
        ""
    ).toLowerCase();
    if (v === "door" || v === "delivery" || v === "home") return "door";
    if (v === "pickup" || v === "leader") return "pickup";
    if (o.address || o.shippingAddress || o.fullAddress) return "door";
    return "";
  }

  function renderStatusPill(status) {
    const s = String(status || "").toLowerCase();
    if (s === "done" || s === "completed") return `<span class="pill ok">已完成</span>`;
    if (s === "shipping") return `<span class="pill warn">配送中</span>`;
    if (s === "packing") return `<span class="pill warn">配货中</span>`;
    if (s === "paid") return `<span class="pill ok">已支付</span>`;
    if (s === "cancelled") return `<span class="pill bad">已取消</span>`;
    return `<span class="pill">待处理</span>`;
  }

  function getOrderId(o) {
    return o._id || o.id || o.orderId || o.orderNo || "";
  }

  function getOrderNo(o) {
    return o.orderNo || o.no || o.number || o._id || "";
  }

  function getName(o) {
    return (o.user && o.user.name) || o.customerName || o.name || "—";
  }

  function getPhone(o) {
    return (o.user && o.user.phone) || o.customerPhone || o.phone || "";
  }

  function getAddr(o) {
    return (
      o.fullAddress ||
      o.address ||
      o.shippingAddress ||
      (o.fulfillment && o.fulfillment.address) ||
      "—"
    );
  }

  function getItems(o) {
    return o.items || o.orderItems || o.products || [];
  }

  function normalizeList(data) {
    // 兼容各种返回结构
    const list =
      data?.list ||
      data?.orders ||
      data?.tasks ||
      data?.data ||
      (Array.isArray(data) ? data : []) ||
      [];
    return Array.isArray(list) ? list : [];
  }

  function keywordHit(o, kw) {
    if (!kw) return true;
    const s = kw.toLowerCase();
    const blob = [
      getOrderNo(o),
      getOrderId(o),
      getName(o),
      getPhone(o),
      getAddr(o),
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(s);
  }

  function isToday(createdAt) {
    if (!createdAt) return true; // 没时间字段就别过滤掉
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return true;
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  async function tryFetchOrders() {
    let lastErr = "";
    for (const url of API_CANDIDATES) {
      try {
        const res = await window.driverFetch(url);
        if (res.status === 401) {
          throw new Error(`401 未登录（司机 token 未带上或已过期）`);
        }
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        const list = normalizeList(data);

        el("apiUsed").textContent = url;
        return { url, list, raw: data };
      } catch (e) {
        lastErr = `${url} -> ${e.message || e}`;
      }
    }
    throw new Error(lastErr || "没有可用接口");
  }

  async function patchStatus(orderId, status) {
    // 你后端如果不是这个路径，把这里改成你真实的 driver 更新接口
    const url = `/api/driver/orders/${encodeURIComponent(orderId)}/status`;
    const res = await window.driverFetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.status === 401) throw new Error("401 未登录");
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new Error(data?.message || `更新失败：${res.status}`);
    }
    return data;
  }

  function render(list) {
    const container = el("list");
    container.innerHTML = "";

    const kw = el("kw").value.trim();
    const st = el("status").value || "";
    const scope = el("scope").value || "today";
    const mode = el("mode").value || "";

    let filtered = [...list];

    if (scope === "today") filtered = filtered.filter((o) => isToday(o.createdAt || o.createdAtAt));
    if (st) filtered = filtered.filter((o) => String(o.status || "").toLowerCase() === st);
    if (mode) filtered = filtered.filter((o) => getDeliveryType(o) === mode);
    if (kw) filtered = filtered.filter((o) => keywordHit(o, kw));

    // 有 routeSeq 的优先排序
    filtered.sort((a, b) => {
      const sa = getSeq(a);
      const sb = getSeq(b);
      if (sa != null && sb != null) return sa - sb;
      if (sa != null) return -1;
      if (sb != null) return 1;
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return ta - tb;
    });

    el("count").textContent = String(filtered.length);

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `
        <div class="row">
          <div class="main">
            <div class="oid">暂无订单</div>
            <div class="muted">
              如果后台已经派单但这里为空：
              <br/>1) 看 Network 是否 401（token）
              <br/>2) 确认后端司机接口是否按 driverId 查询
              <br/>3) 确认司机端调用的接口路径
            </div>
          </div>
          <div class="right">
            <span class="pill info">提示</span>
          </div>
        </div>
      `;
      container.appendChild(empty);
      return;
    }

    filtered.forEach((o) => {
      const orderId = getOrderId(o);
      const orderNo = getOrderNo(o);
      const seq = getSeq(o);
      const addr = getAddr(o);
      const name = getName(o);
      const phone = getPhone(o);
      const items = getItems(o);
      const amount = Number(o.totalAmount ?? o.amount ?? 0);
      const status = o.status;

      const card = document.createElement("div");
      card.className = "card";

      const mapQ = encodeURIComponent(addr === "—" ? "" : addr);
      const gmap = mapQ ? `https://www.google.com/maps/search/?api=1&query=${mapQ}` : "";

      card.innerHTML = `
        <div class="row">
          <div class="left">
            <div class="seq ${seq == null ? "empty" : ""}">${seq == null ? "-" : seq}</div>
            <div class="main">
              <div class="oid">订单：${orderNo}</div>
              <div class="addr">${addr}</div>
              <div class="muted">客户：${name}${phone ? ` · ${phone}` : ""}</div>
              <div class="muted">金额：$${amount.toFixed(2)} · 下单：${fmtTime(o.createdAt)}</div>
            </div>
          </div>
          <div class="right">
            ${renderStatusPill(status)}
            <div class="btnrow">
              <button class="btn ghost" data-act="toggle">详情</button>
              ${gmap ? `<a class="btn" href="${gmap}" target="_blank" rel="noreferrer">导航</a>` : ""}
              <button class="btn primary" data-act="done">标记送达</button>
            </div>
          </div>
        </div>

        <div class="detail">
          <div class="hr"></div>
          <div class="muted">订单ID：<code>${orderId}</code></div>
          <div class="items">
            ${
              items && items.length
                ? items
                    .map((it) => {
                      const n = it.name || it.productName || "商品";
                      const q = it.qty || it.quantity || 1;
                      const p = Number(it.price || it.unitPrice || 0);
                      return `<div class="item"><span>${n} × ${q}</span><span>$${p.toFixed(2)}</span></div>`;
                    })
                    .join("")
                : `<div class="muted">无商品明细</div>`
            }
          </div>
        </div>
      `;

      const detail = card.querySelector(".detail");
      card.querySelector('[data-act="toggle"]').addEventListener("click", () => {
        detail.classList.toggle("active");
      });

      card.querySelector('[data-act="done"]').addEventListener("click", async () => {
        if (!orderId) return toast("缺少订单ID，无法更新状态");
        if (!confirm(`确认将订单 ${orderNo} 标记为已完成？`)) return;
        try {
          await patchStatus(orderId, "done");
          toast("✅ 已标记完成");
          await load();
        } catch (e) {
          toast("❌ 更新失败：" + (e.message || e));
        }
      });

      container.appendChild(card);
    });
  }

  let LAST_LIST = [];

  async function load() {
    el("subTitle").textContent = "正在拉取订单...";
    el("debugHint").textContent = "";

    try {
      const { url, list, raw } = await tryFetchOrders();
      LAST_LIST = list;

      el("updatedAt").textContent = fmtTime(Date.now());
      el("subTitle").textContent = `已连接司机接口，当前显示来自：${url}`;
      render(LAST_LIST);

      // 给你一个 debug：如果返回结构不一样，你也能看到
      if (list.length === 0) {
        el("debugHint").textContent =
          "提示：接口返回了空列表。请检查“派单写入的字段”是否与司机端查询一致。";
      } else {
        el("debugHint").textContent = "";
      }
    } catch (e) {
      el("subTitle").textContent = "拉取失败";
      el("debugHint").textContent = String(e.message || e);

      el("apiUsed").textContent = "未命中";
      el("count").textContent = "0";
      el("updatedAt").textContent = fmtTime(Date.now());

      const container = el("list");
      container.innerHTML = "";
      const err = document.createElement("div");
      err.className = "card";
      err.innerHTML = `
        <div class="row">
          <div class="main">
            <div class="oid">❌ 拉取订单失败</div>
            <div class="muted" style="margin-top:6px;">
              ${String(e.message || e)}
              <div style="margin-top:8px;">
                你现在要做的就是：
                <br/>1) 点右上角“检查 Token”
                <br/>2) 看 Network 是否 401
                <br/>3) 确认后端司机接口路径（把真实路径放到 <code>API_CANDIDATES</code> 第一项）
              </div>
            </div>
          </div>
          <div class="right">
            <span class="pill bad">ERROR</span>
          </div>
        </div>
      `;
      container.appendChild(err);
    }
  }

  function bind() {
    el("btnRefresh").addEventListener("click", load);
    el("btnApply").addEventListener("click", () => render(LAST_LIST));

    el("btnTestToken").addEventListener("click", () => {
      const t = window.__driverGetToken ? window.__driverGetToken() : "";
      if (!t) return toast("❌ 没找到司机 token（localStorage 里）");
      toast("✅ 找到 token（已隐藏）长度：" + String(t).length);
      console.log("driver token length:", String(t).length);
    });

    el("btnLogout").addEventListener("click", () => {
      ["driver_token","freshbuy_driver_token","token","jwt","access_token"].forEach(k=>localStorage.removeItem(k));
      toast("已清除本地 token");
      setTimeout(() => location.reload(), 600);
    });

    // 输入即筛选
    el("kw").addEventListener("input", () => render(LAST_LIST));
    el("status").addEventListener("change", () => render(LAST_LIST));
    el("scope").addEventListener("change", () => render(LAST_LIST));
    el("mode").addEventListener("change", () => render(LAST_LIST));
  }

  window.addEventListener("DOMContentLoaded", () => {
    bind();
    load();
  });
})();
