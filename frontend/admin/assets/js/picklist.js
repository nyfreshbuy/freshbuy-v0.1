// 配货汇总：多筛选（scope/zone/配送方式多选/时间范围）+ SKU 显示 + 打印
let currentPicklist = [];

/* =========================
 * 小工具
 * ========================= */
function getAdminToken() {
  return localStorage.getItem("adminToken") || "";
}

function authHeaders() {
  const token = getAdminToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

function fmtMoney(n) {
  const v = Number(n || 0);
  return "$" + v.toFixed(2);
}

function qsAppendArray(params, key, arr) {
  (arr || []).forEach((v) => params.append(key, v));
}

function getCheckedDeliverTypes() {
  return Array.from(document.querySelectorAll('input[name="deliverTypes"]:checked'))
    .map((i) => String(i.value || "").trim())
    .filter(Boolean);
}

function toISOFromDatetimeLocal(v) {
  // datetime-local => ISO string
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

/* =========================
 * Zones 下拉（从后端拉）
 * 需要后端：GET /api/zones/list
 * 返回：{success:true,zones:[{zoneKey,zoneName,zips:[]},...]}
 * ========================= */
async function loadZonesIntoSelect() {
  const zoneSelect = document.getElementById("picklistZone");
  if (!zoneSelect) return;

  zoneSelect.innerHTML = `<option value="all">全部区域</option>`;

  try {
    const res = await fetch(`/api/zones/list?v=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    const data = await res.json();

    if (!data || !data.success || !Array.isArray(data.zones)) {
      // 兼容：如果暂时没有 zones/list，就放一个默认选项
      console.warn("zones/list 不可用，使用默认“全部区域”");
      return;
    }

    data.zones.forEach((z) => {
      const key = z.zoneKey || z.zoneId || z._id || "";
      const name = z.zoneName || z.name || key || "未命名区域";
      const zipCount = Array.isArray(z.zips) ? z.zips.length : 0;

      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = zipCount ? `${name}（${zipCount} zip）` : name;
      zoneSelect.appendChild(opt);
    });

    // 默认 all
    if (!zoneSelect.value) zoneSelect.value = "all";
  } catch (e) {
    console.warn("加载 zones 失败：", e);
  }
}

/* =========================
 * 渲染表格（SKU 为第一列）
 * ========================= */
function renderPicklistTable() {
  const tbody = document.getElementById("picklistTbody");
  const infoSpan = document.getElementById("picklistInfo");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!currentPicklist.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">暂无配货数据</td></tr>`;
    if (infoSpan) infoSpan.textContent = "暂无订单数据";
    return;
  }

  let totalQty = 0;
  let totalAmount = 0;

  currentPicklist.forEach((row) => {
    const qty = Number(row.totalQty || row.qty || 0);
    const amount = Number(row.totalAmount || row.amount || 0);

    totalQty += qty;
    totalAmount += amount;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.sku ? String(row.sku) : "-"}</td>
      <td>${row.name || ""}</td>
      <td>${row.spec || ""}</td>
      <td>${row.unit || ""}</td>
      <td>${qty}</td>
      <td>${fmtMoney(amount)}</td>
    `;
    tbody.appendChild(tr);
  });

  if (infoSpan) {
    infoSpan.textContent = `共 ${currentPicklist.length} 个商品 · 总数量 ${totalQty} · 预估金额 ${fmtMoney(
      totalAmount
    )}`;
  }
}

/* =========================
 * 读取筛选条件 -> querystring
 * ========================= */
function buildPicklistParams() {
  const scope = document.getElementById("picklistScope")?.value || "zone_group_only";
  const zone = document.getElementById("picklistZone")?.value || "all";
  const deliverTypes = getCheckedDeliverTypes();
  const from = toISOFromDatetimeLocal(document.getElementById("picklistFrom")?.value || "");
  const to = toISOFromDatetimeLocal(document.getElementById("picklistTo")?.value || "");

  const params = new URLSearchParams();
  params.set("scope", scope);
  params.set("zone", zone);

  if (deliverTypes.length) qsAppendArray(params, "deliverTypes", deliverTypes);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  return params;
}

/* =========================
 * 新接口：/api/admin/picklist/summary
 * 期望返回：
 * {success:true, items:[{sku,name,spec,unit,qty,amount}], ...}
 * ========================= */
async function fetchPicklistSummaryNew(params) {
  const url = `/api/admin/picklist/summary?${params.toString()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: authHeaders(),
  });

  // 让调用方决定如何处理 404
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`HTTP ${res.status} ${text || ""}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();

  if (!data || !data.success || !Array.isArray(data.items)) {
    console.warn("新配货接口返回不符合预期：", data);
    return [];
  }

  // 统一字段
  return data.items.map((x) => ({
    sku: x.sku || "",
    name: x.name || "",
    spec: x.spec || "",
    unit: x.unit || "",
    totalQty: Number(x.qty ?? x.totalQty ?? 0),
    totalAmount: Number(x.amount ?? x.totalAmount ?? 0),
  }));
}

/* =========================
 * 旧接口：/api/admin/orders/picklist
 * （兼容你原来的 week/zone 逻辑）
 * 注意：旧接口无法按“配送方式多选/时间范围/sku”统计
 * 这里只做兜底，至少页面不挂。
 * ========================= */
async function fetchPicklistFallbackOld() {
  const zone = document.getElementById("picklistZone")?.value || "";
  const params = new URLSearchParams();
  if (zone && zone !== "all") params.append("zone", zone);

  const res = await fetch(`/api/admin/orders/picklist?${params.toString()}`, {
    headers: authHeaders(),
  });
  const data = await res.json();

  let items = [];
  if (Array.isArray(data)) items = data;
  else if (data && Array.isArray(data.items)) items = data.items;

  // 尽量归一（旧接口没有 sku）
  return (items || []).map((x) => ({
    sku: x.sku || "", // 基本不会有
    name: x.name || "",
    spec: x.spec || "",
    unit: x.unit || "",
    totalQty: Number(x.totalQty || 0),
    totalAmount: Number(x.totalAmount || 0),
  }));
}

/* =========================
 * 加载配货数据（优先新接口）
 * ========================= */
async function loadPicklist() {
  const tbody = document.getElementById("picklistTbody");
  const infoSpan = document.getElementById("picklistInfo");

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">正在加载...</td></tr>`;
  }
  if (infoSpan) {
    infoSpan.textContent = "正在统计订单...";
  }

  const params = buildPicklistParams();

  try {
    // 优先新接口
    const items = await fetchPicklistSummaryNew(params);
    currentPicklist = items;
    renderPicklistTable();
  } catch (err) {
    console.warn("新接口不可用，尝试旧接口兜底：", err);

    try {
      const items2 = await fetchPicklistFallbackOld();
      currentPicklist = items2;
      renderPicklistTable();

      if (infoSpan) {
        infoSpan.textContent =
          "当前为旧接口兜底结果（未按配送方式/时间范围统计，且可能没有 SKU）";
      }
    } catch (e2) {
      console.error("加载配货数据失败:", e2);
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="6" style="text-align:center;color:#fca5a5;">加载失败，请稍后重试</td></tr>';
      }
      if (infoSpan) infoSpan.textContent = "加载失败";
    }
  }
}

/* =========================
 * 打印配货单（SKU 作为第一列）
 * ========================= */
function printPicklist() {
  if (!currentPicklist.length) {
    alert("当前没有可打印的配货数据");
    return;
  }

  const rowsHtml = currentPicklist
    .map((row) => {
      const qty = Number(row.totalQty || 0);
      const amount = Number(row.totalAmount || 0);
      return `
        <tr>
          <td>${row.sku ? String(row.sku) : "-"}</td>
          <td>${row.name || ""}</td>
          <td>${row.spec || ""}</td>
          <td>${row.unit || ""}</td>
          <td>${qty}</td>
          <td>${fmtMoney(amount)}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>配货单</title>
        <style>
          body {
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
            padding: 16px;
            color: #111827;
          }
          h3 { margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h3>在鲜购拼好货 · 配货单</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 140px">SKU</th>
              <th>商品名称</th>
              <th style="width: 120px">规格</th>
              <th style="width: 80px">单位</th>
              <th style="width: 100px">总数量</th>
              <th style="width: 120px">预估金额</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) {
    alert("浏览器拦截了打印窗口，请允许弹窗后重试");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}

/* =========================
 * 初始化：默认时间范围（可选）
 * ========================= */
function initDefaultTimeRange() {
  const fromEl = document.getElementById("picklistFrom");
  const toEl = document.getElementById("picklistTo");
  if (!fromEl || !toEl) return;

  // 默认：最近 7 天（你也可以改成“本周一 00:00 到现在”）
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  // datetime-local 需要 "YYYY-MM-DDTHH:mm"
  const toLocalInput = (d) => {
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  };

  if (!fromEl.value) fromEl.value = toLocalInput(from);
  if (!toEl.value) toEl.value = toLocalInput(now);
}

/* =========================
 * 事件绑定
 * ========================= */
window.addEventListener("DOMContentLoaded", async () => {
  // zones
  await loadZonesIntoSelect();

  // 默认时间
  initDefaultTimeRange();

  // 首次加载
  loadPicklist();

  // 事件
  const btnRefresh = document.getElementById("btnRefreshPicklist");
  const btnPrint = document.getElementById("btnPrintPicklist");
  const btnApply = document.getElementById("btnApplyPicklist");

  const zoneSelect = document.getElementById("picklistZone");
  const scopeSelect = document.getElementById("picklistScope");
  const fromEl = document.getElementById("picklistFrom");
  const toEl = document.getElementById("picklistTo");

  // ✅ 应用筛选按钮（推荐用它）
  if (btnApply) btnApply.addEventListener("click", loadPicklist);

  // ✅ 刷新
  if (btnRefresh) btnRefresh.addEventListener("click", loadPicklist);

  // ✅ 打印
  if (btnPrint) btnPrint.addEventListener("click", printPicklist);

  // 可选：改动就自动加载（你也可以注释掉，只用“应用筛选”按钮）
  if (zoneSelect) zoneSelect.addEventListener("change", loadPicklist);
  if (scopeSelect) scopeSelect.addEventListener("change", loadPicklist);

  // 时间改动频繁，建议只点“应用筛选”，这里不自动监听
  // if (fromEl) fromEl.addEventListener("change", loadPicklist);
  // if (toEl) toEl.addEventListener("change", loadPicklist);

  // 配送方式 checkbox：变化就重新加载
  document.querySelectorAll('input[name="deliverTypes"]').forEach((el) => {
    el.addEventListener("change", loadPicklist);
  });
});
