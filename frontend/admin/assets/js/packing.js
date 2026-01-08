// frontend/admin/assets/js/packing.js
console.log("✅ /admin/assets/js/packing.js loaded");

(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---------- DOM ----------
  const batchIdText = $("#batchIdText");
  const batchHint = $("#batchHint");

  const kpiOrders = $("#kpiOrders");
  const kpiGMV = $("#kpiGMV");
  const kpiStatus = $("#kpiStatus");
  const ordersMeta = $("#ordersMeta");

  const driverSelect = $("#driverSelect");
  const deliveryDateEl = $("#deliveryDate");
  const btnAssignDriver = $("#btnAssignDriver");

  const btnBack = $("#btnBack");
  const btnRefresh = $("#btnRefresh");
  const btnPrintPicklist = $("#btnPrintPicklist");
  const btnPrintLabelsAll = $("#btnPrintLabelsAll");
  const btnPrintLabelsSelected = $("#btnPrintLabelsSelected");

  const checkAll = $("#checkAll");
  const ordersTbody = $("#ordersTbody");
  const picklistTbody = $("#picklistTbody");

  // ---------- State ----------
  let batchId = "";
  let orders = [];

  // ---------- Utils ----------
  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function money(n) {
    const v = Number(n || 0);
    return `$${v.toFixed(2)}`;
  }

  function getBatchIdFromUrl() {
    const p = new URLSearchParams(location.search);
    return String(p.get("batch") || p.get("batchId") || "").trim();
  }

  function getOrderId(o) {
    return String(o._id || o.id || o.orderId || o.orderNo || "").trim();
  }

  function getOrderNo(o) {
    return String(o.orderNo || o.no || o._id || "").trim();
  }

  function getName(o) {
    return (o.user && o.user.name) || o.customerName || o.name || "—";
  }

  function getPhone(o) {
    return (o.user && o.user.phone) || o.customerPhone || o.phone || "";
  }

  function getAddress(o) {
    if (typeof o.address === "string") return o.address;
    if (o.address && typeof o.address === "object") {
      return (
        o.address.fullText ||
        o.addressText ||
        o.fullAddress ||
        o.shippingAddress ||
        "—"
      );
    }
    return o.addressText || o.fullAddress || o.shippingAddress || "—";
  }

  function getDeliveryType(o) {
    const v = String(
      o.deliveryType || o.fulfillmentType || o.shippingType || o.receiveMode || ""
    ).toLowerCase();
    if (v === "pickup" || v === "leader") return "pickup";
    if (v === "door" || v === "delivery" || v === "home") return "door";
    if (o.address || o.addressText || o.fullAddress) return "door";
    return "";
  }

  function renderDeliveryPill(o) {
    const t = getDeliveryType(o);
    if (t === "pickup") return `<span class="pill success">团长自提</span>`;
    if (t === "door") return `<span class="pill">送货上门</span>`;
    return `<span class="pill warn">未知</span>`;
  }

  function getStatus(o) {
    return String(o.status || "").toLowerCase() || "pending";
  }

  function renderStatusPill(s) {
    if (s === "done" || s === "completed") return `<span class="pill success">已完成</span>`;
    if (s === "shipping") return `<span class="pill warn">配送中</span>`;
    if (s === "packing") return `<span class="pill warn">配货中</span>`;
    if (s === "paid") return `<span class="pill success">已支付</span>`;
    if (s === "cancel" || s === "cancelled") return `<span class="pill">已取消</span>`;
    return `<span class="pill">待处理</span>`;
  }

  function getAmount(o) {
    if (typeof o.totalAmount === "number") return o.totalAmount;
    if (o.payment && typeof o.payment.amountTotal === "number") return o.payment.amountTotal;
    return Number(o.amount || 0);
  }

  function getBatchStatusFromOrders(list) {
    if (!list.length) return "-";
    const ss = new Set(list.map((x) => getStatus(x)));
    if ([...ss].every((x) => x === "done" || x === "completed")) return "已完成";
    if (ss.has("shipping")) return "配送中";
    if (ss.has("packing")) return "配货中";
    if (ss.has("paid")) return "已支付";
    return "待处理";
  }
  function getAdminToken() {
  return (
    localStorage.getItem("admin_token") ||
    localStorage.getItem("token") ||
    ""
  );
}
 async function apiGet(url) {
  const token = getAdminToken();

  const res = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: "Bearer " + token } : {},
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}
 async function apiSend(url, method, body) {
  const token = getAdminToken();

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}
  // ---------- Render ----------
  function bindCheckAll() {
    if (!checkAll) return;
    checkAll.addEventListener("change", () => {
      const checked = checkAll.checked;
      $$(".order-check").forEach((c) => (c.checked = checked));
    });
  }

  function getSelectedOrderIds() {
    return $$(".order-check:checked")
      .map((el) => el.getAttribute("data-id"))
      .filter(Boolean);
  }

  function renderOrdersTable() {
    if (!orders.length) {
      ordersTbody.innerHTML = `<tr><td colspan="7">该批次没有订单</td></tr>`;
      return;
    }

    ordersTbody.innerHTML = "";
    orders.forEach((o) => {
      const oid = getOrderId(o);
      const no = getOrderNo(o);
      const name = getName(o);
      const phone = getPhone(o);
      const addr = getAddress(o);
      const amount = getAmount(o);
      const status = getStatus(o);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="order-check" data-id="${esc(oid)}"/></td>
        <td>${renderStatusPill(status)}</td>
        <td><code>${esc(no)}</code></td>
        <td>
          ${esc(name)}
          ${phone ? `<div class="muted">${esc(phone)}</div>` : ""}
        </td>
        <td class="addr" title="${esc(addr)}">${esc(addr)}</td>
        <td>${money(amount)}</td>
        <td>${renderDeliveryPill(o)}</td>
      `;
      ordersTbody.appendChild(tr);
    });

    if (checkAll) checkAll.checked = false;
  }

  function buildPicklist(list) {
    const map = new Map(); // key -> {name, sku, qty}
    list.forEach((o) => {
      (o.items || []).forEach((it) => {
        const name = String(it.name || it.productName || "商品").trim();
        const sku = String(it.sku || it.productSku || "").trim();
        const qty = Math.max(1, Number(it.qty || it.quantity || 1));
        const key = `${name}||${sku}`;
        const cur = map.get(key) || { name, sku, qty: 0 };
        cur.qty += qty;
        map.set(key, cur);
      });
    });

    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }

  function renderPicklist() {
    const list = buildPicklist(orders);
    if (!list.length) {
      picklistTbody.innerHTML = `<tr><td colspan="3">该批次没有商品明细</td></tr>`;
      return;
    }
    picklistTbody.innerHTML = "";
    list.forEach((x) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(x.name)}</td>
        <td>${esc(x.qty)}</td>
        <td>${esc(x.sku || "-")}</td>
      `;
      picklistTbody.appendChild(tr);
    });
  }

  function renderKpis() {
    kpiOrders.textContent = String(orders.length);
    const gmv = orders.reduce((sum, o) => sum + Number(getAmount(o) || 0), 0);
    kpiGMV.textContent = money(gmv);
    kpiStatus.textContent = getBatchStatusFromOrders(orders);
    ordersMeta.textContent = `共 ${orders.length} 单 · 批次 ${batchId}`;
  }

  // ---------- Print ----------
  function buildLabelsPrintHtml(list) {
    const style = `
      @page { size: A4; margin: 8mm; }
      @media print { body { margin: 0; } }

      .page { page-break-after: always; }
      .sheet {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3mm;
        width: 100%;
        height: calc(297mm - 16mm);
      }
      .label {
        border: 1px dashed rgba(0,0,0,0.2);
        border-radius: 3mm;
        padding: 4mm;
        font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 10.5pt;
        line-height: 1.25;
        overflow: hidden;
      }
      .label .name { font-weight: 800; font-size: 12pt; }
      .label .addr { margin-top: 2mm; font-size: 10pt; }
      .label .note { margin-top: 2mm; font-size: 9.5pt; }
      .label .ord  { margin-top: 2mm; font-size: 9pt; opacity: .9; }
    `;

    const perPage = 20;
    const pages = [];
    for (let i = 0; i < list.length; i += perPage) {
      const slice = list.slice(i, i + perPage);
      const labels = slice
        .map((o) => {
          const no = getOrderNo(o);
          const name = getName(o);
          const phone = getPhone(o);
          const addr = getAddress(o);
          const note = String(o.note || o.remark || "—");
          return `
            <div class="label">
              <div class="name">${esc(name)} ${phone ? `(${esc(phone)})` : ""}</div>
              <div class="addr">${esc(addr)}</div>
              <div class="note">留言：${esc(note)}</div>
              <div class="ord">订单号：${esc(no)} · 批次：${esc(batchId)}</div>
            </div>
          `;
        })
        .join("");

      pages.push(`<div class="page"><div class="sheet">${labels}</div></div>`);
    }

    return `
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>贴纸打印 - ${esc(batchId)}</title>
          <style>${style}</style>
        </head>
        <body>${pages.join("")}</body>
      </html>
    `;
  }

  function openPrintWindow(html) {
    const win = window.open("", "_blank");
    if (!win) {
      alert("浏览器拦截了打印窗口，请允许弹窗后重试。");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  function printLabelsAll() {
    if (!orders.length) return alert("该批次没有订单");
    openPrintWindow(buildLabelsPrintHtml(orders));
  }

  function printLabelsSelected() {
    const ids = new Set(getSelectedOrderIds());
    if (!ids.size) return alert("请先勾选订单");
    const list = orders.filter((o) => ids.has(getOrderId(o)));
    if (!list.length) return alert("勾选订单为空（可能列表刷新了）");
    openPrintWindow(buildLabelsPrintHtml(list));
  }

  function printPicklist() {
    const list = buildPicklist(orders);
    const rows = list
      .map(
        (x) => `
        <tr>
          <td>${esc(x.name)}</td>
          <td style="text-align:right">${esc(x.qty)}</td>
          <td>${esc(x.sku || "-")}</td>
        </tr>
      `
      )
      .join("");

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>配货汇总 - ${esc(batchId)}</title>
          <style>
            body{font-family: Arial,"PingFang SC","Microsoft YaHei",sans-serif; padding:16px; color:#111827;}
            h1{font-size:18px; margin:0 0 10px;}
            .muted{color:#6b7280; font-size:12px; margin-bottom:10px;}
            table{width:100%; border-collapse:collapse; font-size:12px;}
            th,td{border:1px solid #e5e7eb; padding:6px 8px;}
            th{background:#f9fafb; text-align:left;}
          </style>
        </head>
        <body>
          <h1>配货汇总（Picklist）</h1>
          <div class="muted">批次：${esc(batchId)} · 订单数：${orders.length}</div>
          <table>
            <thead><tr><th>商品</th><th style="width:90px;text-align:right">数量</th><th style="width:160px">SKU</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="3">无数据</td></tr>`}</tbody>
          </table>
        </body>
      </html>
    `;
    openPrintWindow(html);
  }

  // ---------- Driver ----------
  async function loadDrivers() {
    // 你项目里司机接口可能不同，我做多入口兼容
    const candidates = [
      "/api/admin/drivers",
      "/api/admin/users?role=driver",
      "/api/drivers",
    ];

    let data = null;
    for (const url of candidates) {
      try {
        data = await apiGet(url);
        break;
      } catch (e) {
        // try next
      }
    }

    if (!data) {
      console.warn("⚠️ 未找到司机接口（/api/admin/drivers 等）");
      driverSelect.innerHTML = `<option value="">选择司机（批量派单）</option>`;
      return;
    }

    const list = data.list || data.drivers || data.users || [];
    driverSelect.innerHTML = `<option value="">选择司机（批量派单）</option>`;
    list.forEach((d) => {
      const id = String(d._id || d.id || d.userId || "").trim();
      const name = String(d.name || (d.user && d.user.name) || d.phone || "司机").trim();
      if (!id) return;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      driverSelect.appendChild(opt);
    });
  }

  async function assignDriverSelected() {
    const driverId = String(driverSelect.value || "").trim();
    if (!driverId) return alert("请先选择司机");
    const ids = getSelectedOrderIds();
    if (!ids.length) return alert("请先勾选要派单的订单");

    const deliveryDate = String(deliveryDateEl.value || "").trim(); // YYYY-MM-DD or ""
    const payload = {
      orderIds: ids,
      driverId,
      status: "shipping",
    };
    if (deliveryDate) payload.deliveryDate = deliveryDate;

    // 兼容 PATCH / POST
    try {
      await apiSend("/api/admin/orders/assign-driver", "PATCH", payload);
    } catch (e1) {
      try {
        await apiSend("/api/admin/orders/assign-driver", "POST", payload);
      } catch (e2) {
        console.error(e1, e2);
        alert("派单失败：" + (e2.message || e1.message || "未知错误"));
        return;
      }
    }

    alert("✅ 派单成功");
    await loadBatch(); // refresh
  }

  // ---------- Batch Load ----------
  async function loadBatch() {
    if (!batchId) {
      ordersTbody.innerHTML = `<tr><td colspan="7">缺少 batch 参数：请从订单页打包后跳转进来</td></tr>`;
      if (batchHint) batchHint.textContent = "URL 需要 ?batch=PKxxxx";
      return;
    }

    if (batchIdText) batchIdText.textContent = batchId;
    if (batchHint) batchHint.innerHTML = `从 <code>/api/admin/orders/by-batch?batchId=${esc(batchId)}</code> 拉取订单`;

    ordersTbody.innerHTML = `<tr><td colspan="7">正在加载...</td></tr>`;
    picklistTbody.innerHTML = `<tr><td colspan="3">等待加载订单后生成...</td></tr>`;

    const url = `/api/admin/orders/by-batch?batchId=${encodeURIComponent(batchId)}`;
    try {
      const data = await apiGet(url);
      orders = data.list || data.orders || [];
      renderOrdersTable();
      renderPicklist();
      renderKpis();
    } catch (e) {
      console.error(e);
      orders = [];
      ordersTbody.innerHTML = `<tr><td colspan="7">加载失败：${esc(e.message || "未知错误")}</td></tr>`;
      picklistTbody.innerHTML = `<tr><td colspan="3">加载失败</td></tr>`;
      renderKpis();
    }
  }

  // ---------- Bind ----------
  function bindEvents() {
    bindCheckAll();

    if (btnBack) btnBack.addEventListener("click", () => (location.href = "/admin/orders.html"));
    if (btnRefresh) btnRefresh.addEventListener("click", loadBatch);

    if (btnPrintPicklist) btnPrintPicklist.addEventListener("click", printPicklist);
    if (btnPrintLabelsAll) btnPrintLabelsAll.addEventListener("click", printLabelsAll);
    if (btnPrintLabelsSelected) btnPrintLabelsSelected.addEventListener("click", printLabelsSelected);

    if (btnAssignDriver) btnAssignDriver.addEventListener("click", assignDriverSelected);
  }

  // ---------- Init ----------
  window.addEventListener("DOMContentLoaded", async () => {
    batchId = getBatchIdFromUrl();
    if (batchIdText) batchIdText.textContent = batchId || "-";

    bindEvents();
    await loadDrivers();
    await loadBatch();
  });
})();
