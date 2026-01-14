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

  // ✅ 新增（如果你 packing.html 还没加按钮，这里会是 null，不影响）
  const btnSmartRoute = $("#btnSmartRoute"); // 🧭 智能排序(路线)
  const btnPrintOrderDetails = $("#btnPrintOrderDetails"); // 🧾 打印订单详情

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
    return localStorage.getItem("admin_token") || localStorage.getItem("token") || "";
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

  // ---------- Privacy Mask (PRINT ONLY) ----------
  // ✅ 打印订单详情：名字只显示姓 + "**"
  function maskNameOnlyLastName(name) {
    const s = String(name || "").trim();
    if (!s) return "";
    const parts = s.split(/\s+/).filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : s;
    return `${last}**`;
  }

  // ✅ 打印订单详情：电话只显示前3 + 后3
  function maskPhone3_3(phone) {
    const s = String(phone || "");
    const digits = s.replace(/\D/g, "");
    if (digits.length < 6) return s;
    const head = digits.slice(0, 3);
    const tail = digits.slice(-3);
    return `${head}****${tail}`;
  }

  // ---------- Route Smart Sort + Sequence ----------
  function getLatLng(order) {
    const a = order?.address || order?.shippingAddress || order?.deliveryAddress || {};
    const lat =
      a.lat ??
      a.latitude ??
      a?.geo?.lat ??
      a?.location?.lat ??
      a?.location?.latitude ??
      order?.lat ??
      order?.latitude ??
      null;
    const lng =
      a.lng ??
      a.longitude ??
      a?.geo?.lng ??
      a?.location?.lng ??
      a?.location?.longitude ??
      order?.lng ??
      order?.longitude ??
      null;
    if (lat == null || lng == null) return null;
    const nlat = Number(lat);
    const nlng = Number(lng);
    if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return null;
    return { lat: nlat, lng: nlng };
  }

  function haversineKm(p1, p2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLng = toRad(p2.lng - p1.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function fallbackSortKey(order) {
    const a = order?.address || order?.shippingAddress || order?.deliveryAddress || {};
    const zip = String(a.zip || a.postalCode || "").trim();
    const line1 = String(a.line1 || a.street1 || a.address1 || a.detail || getAddress(order) || "").trim();
    const numMatch = line1.match(/\d+/);
    const streetNum = numMatch ? Number(numMatch[0]) : 999999;
    return { zip, streetNum, line1 };
  }

  function smartRouteSort(list, startPoint /* {lat,lng} | null */) {
    const ordersCopy = [...list];

    const withGeo = ordersCopy
      .map((o) => ({ o, p: getLatLng(o) }))
      .filter((x) => !!x.p);

    // 地理坐标不足 -> 退化排序
    if (withGeo.length < 2) {
      return ordersCopy.sort((a, b) => {
        const ka = fallbackSortKey(a);
        const kb = fallbackSortKey(b);
        if (ka.zip !== kb.zip) return ka.zip.localeCompare(kb.zip);
        if (ka.streetNum !== kb.streetNum) return ka.streetNum - kb.streetNum;
        return ka.line1.localeCompare(kb.line1);
      });
    }

    const noGeo = ordersCopy.filter((o) => !getLatLng(o));
    let current = startPoint || withGeo[0].p;

    const remaining = withGeo.map((x) => x.o);
    const result = [];

    while (remaining.length) {
      let bestIdx = 0;
      let bestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const pi = getLatLng(remaining[i]);
        const d = pi ? haversineKm(current, pi) : Infinity;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      const chosen = remaining.splice(bestIdx, 1)[0];
      result.push(chosen);
      const cp = getLatLng(chosen);
      if (cp) current = cp;
    }

    // 无坐标追加（zip+街号）
    noGeo.sort((a, b) => {
      const ka = fallbackSortKey(a);
      const kb = fallbackSortKey(b);
      if (ka.zip !== kb.zip) return ka.zip.localeCompare(kb.zip);
      if (ka.streetNum !== kb.streetNum) return ka.streetNum - kb.streetNum;
      return ka.line1.localeCompare(kb.line1);
    });

    return result.concat(noGeo);
  }

  function applyRouteSequence(sortedOrders) {
    sortedOrders.forEach((o, idx) => {
      o.routeSeq = idx + 1; // ✅ 送货先后顺序序列号
    });
    return sortedOrders;
  }

  function ensureRouteSeqForList(list) {
    // 如果已经有 routeSeq，就按 routeSeq 排；否则按当前列表顺序写 1..N（兜底）
    const hasAny = list.some((o) => Number.isFinite(Number(o?.routeSeq)));
    if (hasAny) {
      return [...list].sort((a, b) => (Number(a.routeSeq) || 999999) - (Number(b.routeSeq) || 999999));
    }
    const cloned = [...list];
    cloned.forEach((o, idx) => (o.routeSeq = idx + 1));
    return cloned;
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
  // ✅ 修改：A4 不干胶 2"×4"，每页 10 个（2 列×5 行），按 routeSeq 顺序分页打印
  function buildLabelsPrintHtml(list) {
    const style = `
  /* ✅ 固定 A4 画布，不让浏览器自己算可用区导致漂移 */
  @page { size: A4; margin: 0; }

  html, body {
    width: 210mm;
    height: 297mm;
    margin: 0;
    padding: 0;
  }

  /* ✅ 每页就是一张 A4，自己用 padding 做边距 */
  .page{
    width: 210mm;
    height: 297mm;
    box-sizing: border-box;
    padding: 8mm;                 /* 你原来 @page margin:8mm 的效果搬到这里 */
    page-break-after: always;
    break-after: page;
    overflow: hidden;             /* 防止内容把页面撑开导致错位 */
  }
  .page:last-child{ page-break-after:auto; break-after:auto; }

  /* ✅ 2列×5行：每张 2"×4" => 50.8mm × 101.6mm */
  .sheet{
    display: grid;
    grid-template-columns: repeat(2, 50.8mm);
    grid-template-rows: repeat(5, 101.6mm);

    column-gap: 6mm;
    row-gap: 4mm;

    justify-content: center;
    align-content: center;

    width: 100%;
    height: 100%;                /* ✅ 不要用 calc，直接吃满 page 内容区 */
  }

  .label{
    width: 50.8mm;
    height: 101.6mm;

    box-sizing: border-box;
    padding: 5mm;
    padding-top: 16mm;           /* 给右上角大号序号留空间 */

    font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 11pt;
    line-height: 1.25;

    overflow: hidden;
    break-inside: avoid;

    border: none;
    border-radius: 6mm;
    position: relative;
  }

  /* ✅ 送货顺序：超大字体（贴纸右上角） */
  .route-seq-big{
    position: absolute;
    top: 3mm;
    right: 3mm;

    font-size: 44pt;
    font-weight: 900;
    line-height: 1;

    color: #000;
    border: 2.2mm solid #000;
    border-radius: 5mm;

    padding: 2mm 4mm;
    min-width: 14mm;
    text-align: center;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .route-seq-big { font-size: 48pt; }
  }

  .label .name { font-weight: 800; font-size: 12pt; }
  .label .addr { margin-top: 2mm; font-size: 10pt; }
  .label .note { margin-top: 2mm; font-size: 9.5pt; }
  .label .ord  { margin-top: 2mm; font-size: 9pt; opacity: .9; }

  /* 🧪 对位测试用（对齐后再关） */
  /* .label { outline: 1px dashed rgba(0,0,0,.25); } */
`;

    // ✅ 每页 10 个贴纸
    const perPage = 10;

    // ✅ 先保证 routeSeq 存在 + 按 routeSeq 排序分页
    const sorted = ensureRouteSeqForList(list);

    const pages = [];
    for (let i = 0; i < sorted.length; i += perPage) {
      const slice = sorted.slice(i, i + perPage);

      // ✅ 不足 10 个时补空位（保持版式不乱）
      const filled = slice.concat(Array.from({ length: perPage - slice.length }, () => null));

      const labels = filled
        .map((o) => {
          if (!o) {
            return `<div class="label"></div>`;
          }

          const seq = o.routeSeq ?? "";
          const no = getOrderNo(o);
          const name = getName(o);
          const phone = getPhone(o);
          const addr = getAddress(o);
          const note = String(o.note || o.remark || "—");

          return `
            <div class="label">
              <div class="route-seq-big">${esc(seq)}</div>
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

  // ✅ 打印订单详情（姓名/电话脱敏；显示 routeSeq；每单一页）
  function buildOrderDetailsPrintHtml(list) {
    // ✅ 先保证 routeSeq 存在 + 按 routeSeq 顺序打印
    const sorted = ensureRouteSeqForList(list);

    const style = `
      @page { size: A4; margin: 12mm; }
      body{font-family: Arial,"PingFang SC","Microsoft YaHei",sans-serif; color:#111827; margin:0;}
      .page{page-break-after:always; break-after:page; padding:0;}
      .page:last-child{page-break-after:auto; break-after:auto;}
      .head{display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:10px;}
      .title{font-size:18px; font-weight:800; margin:0;}
      .muted{color:#6b7280; font-size:12px;}
      .tag{font-size:12px; border:1px solid #e5e7eb; padding:4px 8px; border-radius:10px; margin-bottom:6px; display:inline-block;}
      .right{text-align:right;}
      .info{border:1px solid #e5e7eb; border-radius:12px; padding:10px; font-size:13px; line-height:1.6; margin-bottom:10px;}
      table{width:100%; border-collapse:collapse; font-size:12px;}
      th,td{border:1px solid #e5e7eb; padding:6px 8px; vertical-align:top;}
      th{background:#f9fafb; text-align:left;}
      .c2{width:170px;}
      .c3{width:80px; text-align:center;}
      .seqBox{font-size:22px; font-weight:900; border:2px solid #111827; border-radius:12px; padding:4px 10px; display:inline-block;}
    `;

    const pages = sorted
      .map((o, idx) => {
        const seq = o.routeSeq ?? (idx + 1);

        const rawName = getName(o);
        const rawPhone = getPhone(o);

        const maskedName = maskNameOnlyLastName(rawName);
        const maskedPhone = maskPhone3_3(rawPhone);

        const no = getOrderNo(o);
        const addr = getAddress(o);
        const amount = getAmount(o);

        const items = Array.isArray(o.items) ? o.items : [];
        const rows =
          items
            .map((it) => {
              const name = String(it.name || it.productName || "商品").trim();
              const sku = String(it.sku || it.productSku || "").trim();
              const qty = Math.max(1, Number(it.qty || it.quantity || 1));
              const unit = String(it.unit || it.spec || "").trim();
              return `
                <tr>
                  <td>${esc(name)} ${unit ? `<span class="muted">(${esc(unit)})</span>` : ""}</td>
                  <td class="c2">${esc(sku || "-")}</td>
                  <td class="c3">${esc(qty)}</td>
                </tr>
              `;
            })
            .join("") || `<tr><td colspan="3" class="muted">（无商品明细 items）</td></tr>`;

        return `
          <section class="page">
            <div class="head">
              <div>
                <div class="title">配货订单详情</div>
                <div class="muted">批次：${esc(batchId)} · 第 ${idx + 1}/${sorted.length} 单</div>
              </div>
              <div class="right">
                <div class="tag">送货顺序：<span class="seqBox">${esc(seq)}</span></div><br/>
                <div class="tag">订单号：${esc(no)}</div><br/>
                <div class="tag">金额：${esc(money(amount))}</div>
              </div>
            </div>

            <div class="info">
              <div><b>客户：</b>${esc(maskedName || "—")}</div>
              <div><b>电话：</b>${esc(maskedPhone || "—")}</div>
              <div><b>地址：</b>${esc(addr || "—")}</div>
            </div>

            <table>
              <thead><tr><th>商品</th><th class="c2">SKU</th><th class="c3">数量</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>

            <div class="muted" style="margin-top:10px;">用于仓库配货核对（打印脱敏）</div>
          </section>
        `;
      })
      .join("");

    return `
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>订单详情打印 - ${esc(batchId)}</title>
          <style>${style}</style>
        </head>
        <body>${pages}</body>
      </html>
    `;
  }

  // ✅ 修改：不要 print 后立刻 close（会导致部分浏览器/打印机没来得及渲染就关了）
  function openPrintWindow(html) {
    const win = window.open("", "_blank");
    if (!win) {
      alert("浏览器拦截了打印窗口，请允许弹窗后重试。");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();

    win.onload = () => {
      win.focus();
      win.print();
      // 不自动关闭：避免打印机慢/手机端导致打印空白
    };
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

  function printOrderDetailsAllOrSelected() {
    if (!orders.length) return alert("该批次没有订单");

    const ids = new Set(getSelectedOrderIds());
    let list = orders;

    if (ids.size) {
      list = orders.filter((o) => ids.has(getOrderId(o)));
      if (!list.length) return alert("勾选订单为空（可能列表刷新了）");
    }

    openPrintWindow(buildOrderDetailsPrintHtml(list));
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
    const candidates = ["/api/admin/drivers", "/api/admin/users?role=driver", "/api/drivers"];
    let data = null;
    for (const url of candidates) {
      try {
        data = await apiGet(url);
        break;
      } catch (e) {}
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

    // ✅ 从当前页面 URL 拿批次号（PK20260110-6SYD）
    const batchIdFromUrl = getBatchIdFromUrl();

    // ✅ 派单 payload：一定要带 batchId
    const payload = {
      batchId: batchIdFromUrl, // ⭐⭐⭐关键：让后端把订单写入这个批次
      orderIds: ids,
      driverId,
      status: "shipping",
      batchId, // 你原来就有，我保留（若你不需要可删）
    };

    if (deliveryDate) payload.deliveryDate = deliveryDate;

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
    await loadBatch();
  }

  // ---------- Batch Load ----------
  async function loadBatch() {
    if (!batchId) {
      ordersTbody.innerHTML = `<tr><td colspan="7">缺少 batch 参数：请从订单页打包后跳转进来</td></tr>`;
      if (batchHint) batchHint.textContent = "URL 需要 ?batch=PKxxxx";
      return;
    }

    if (batchIdText) batchIdText.textContent = batchId;
    if (batchHint)
      batchHint.innerHTML = `从 <code>/api/admin/orders/by-batch?batchId=${esc(batchId)}</code> 拉取订单`;

    ordersTbody.innerHTML = `<tr><td colspan="7">正在加载...</td></tr>`;
    picklistTbody.innerHTML = `<tr><td colspan="3">等待加载订单后生成...</td></tr>`;

    const url = `/api/admin/orders/by-batch?batchId=${encodeURIComponent(batchId)}`;
    try {
      const data = await apiGet(url);
      orders = data.list || data.orders || [];

      // ✅ 保留已有 routeSeq（如果存在），没有就不强行写，避免“加载就变顺序”
      // 如果你希望每次加载默认写 1..N，打开下一行：
      // orders = ensureRouteSeqForList(orders);

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

    // ✅ 新增：打印订单详情（默认：有勾选就打印勾选；没勾选打印全部）
    if (btnPrintOrderDetails) btnPrintOrderDetails.addEventListener("click", printOrderDetailsAllOrSelected);

    // ✅ 新增：智能排序(路线) -> 写 routeSeq（只在前端内存，不保存后端）
    if (btnSmartRoute)
      btnSmartRoute.addEventListener("click", () => {
        if (!orders.length) return alert("该批次没有订单");

        // 你如果有固定仓库坐标，填这里会更准；没有就留 null（用第一单当起点）
        const WAREHOUSE = null; // { lat: 40.7, lng: -73.8 }

        const sorted = applyRouteSequence(smartRouteSort(orders, WAREHOUSE));
        orders = sorted;

        renderOrdersTable();
        renderKpis();

        alert("✅ 已按智能路线排序，并写入送货顺序序号（routeSeq）\n现在打印贴纸/订单详情都会带同一个序号。");
      });

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
