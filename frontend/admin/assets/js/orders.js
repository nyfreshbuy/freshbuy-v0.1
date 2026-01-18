// 简单的订单管理逻辑 + 打印小票功能

let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
const PAGE_SIZE = 10;
const orderMap = {}; // key: orderId -> order 对象
const ZONE_NAME_MAP = {}; // key: zoneId -> zoneName
// ======================== 工具函数 ========================
// ======================== 司机列表（派单用） ========================
let DRIVER_OPTIONS = []; // [{id,label}]

async function loadDrivers() {
  try {
    const token = localStorage.getItem("adminToken");
    const res = await fetch("/api/admin/orders/drivers", {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    const data = await res.json();
    if (data && data.success && Array.isArray(data.drivers)) {
      DRIVER_OPTIONS = data.drivers.map((d) => ({
        id: d.id,
        label: d.label || d.name || d.id,
      }));
    } else {
      DRIVER_OPTIONS = [];
    }
  } catch (e) {
    console.error("获取司机列表失败:", e);
    DRIVER_OPTIONS = [];
  }
}
async function loadZones() {
  try {
    const token = localStorage.getItem("adminToken");

    // ✅ 你后端如果已有接口：建议用 /api/admin/zones
    // 如果你实际接口不是这个，把这里的 URL 改成你真实的即可
    const res = await fetch("/api/admin/zones", {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    const data = await res.json();

    // 兼容两种格式：数组 / {success, zones}
    const zones = Array.isArray(data) ? data : (data?.zones || []);
    if (!Array.isArray(zones)) throw new Error("zones format invalid");
    console.log("✅ zones raw:", zones);
    // 1) 先清空映射
    for (const k in ZONE_NAME_MAP) delete ZONE_NAME_MAP[k];

    // 2) 填充映射（兼容字段名）
    zones.forEach((z) => {
      const id = String(z._id || z.id || z.zoneId || "").trim();
      const name = String(z.name || z.zoneName || z.title || id).trim();
      if (id) ZONE_NAME_MAP[id.toLowerCase()] = name;
    });

    // 3) 生成下拉框 options：显示 name，不显示 id
    const select = document.getElementById("areaZoneFilter");
    if (!select) return;

    select.innerHTML = "";

    // “全部区域”
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "全部区域";
    select.appendChild(optAll);

    zones.forEach((z) => {
      const id = String(z._id || z.id || z.zoneId || "").trim();
      if (!id) return;

      const name = ZONE_NAME_MAP[id.toLowerCase()] || id;

      // ✅ 如果后端有 count/orderCount，就一起显示（可选）
      const count = z.count ?? z.orderCount ?? z.ordersCount ?? null;

      const opt = document.createElement("option");
      opt.value = id; // ✅ value 用 id（筛选用）
      opt.textContent = count != null ? `${name}（${count}单）` : name; // ✅ 显示用 name
      select.appendChild(opt);
    });
  } catch (e) {
    console.error("获取区域列表失败:", e);

    // 失败时保底：至少有“全部区域”
    const select = document.getElementById("areaZoneFilter");
    if (select && !select.options.length) {
      select.innerHTML = `<option value="">全部区域</option>`;
    }
  }
}
function toDateInputValue(d) {
  const dt = d ? new Date(d) : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildDriverSelect(order) {
  const id = order._id || order.id || "";
  const current = String(order.driverId || ""); // ✅ DB字段

  const options = [
    `<option value="">未分配</option>`,
    ...DRIVER_OPTIONS.map((d) => {
      const selected = current === String(d.id) ? "selected" : "";
      return `<option value="${d.id}" ${selected}>${escapeHtml(d.label)}</option>`;
    }),
  ].join("");

  return `<select class="driverSelect" data-order-id="${id}">${options}</select>`;
}

// 把后端的配送模式字段整理成统一的字符串：normal / friend / areaGroup
function getServiceMode(order) {
  const raw =
    order.serviceMode ||
    order.deliveryMode ||
    order.shippingMode ||
    order.mode ||
    "";
  return String(raw).toLowerCase(); // 约定：normal / friend / areagroup
}

// 区域团拼单的区域 ID
function getAreaZone(order) {
  const raw =
    order.areaGroupZone ||
    order.zoneId ||
    order.deliveryZone ||
    order.groupZone ||
    "";
  return String(raw).toLowerCase();
}

// 把模式转成中文
function getServiceModeText(order) {
  const m = getServiceMode(order);
  if (m === "normal") return "次日配送";
  if (m === "friend") return "好友拼单配送";
  if (m === "areagroup" || m === "group" || m === "groupday")
    return "区域团拼单配送";
  return "未标记";
}

// ⭐ 获取配送序号（统一入口）
function getOrderSeq(order) {
  if (typeof order.routeSeq === "number") return order.routeSeq;
  if (typeof order.sequenceNumber === "number") return order.sequenceNumber;
  if (typeof order.sequenceNo === "number") return order.sequenceNo;
  if (typeof order.seq === "number") return order.seq;
  return null;
}

// ⭐ 小票专用：姓名脱敏，只保留第一字/姓
function maskName(name) {
  if (!name) return "—";
  const n = String(name).trim();
  if (!n) return "—";

  // 英文名：取第一个单词 + " *"
  if (n.includes(" ")) {
    const parts = n.split(/\s+/);
    const first = parts[0];
    return first + " *";
  }

  // 中文或连续字符串：保留第一个字，其余全部 *
  if (n.length <= 1) return n;
  return n[0] + "*".repeat(n.length - 1);
}

// ⭐ 小票专用：手机号脱敏，保留前2 + 后2
function maskPhone(phone) {
  if (!phone) return "—";
  const p = String(phone).trim();
  if (p.length <= 4) return p; // 太短就不处理
  const head = p.slice(0, 2);
  const tail = p.slice(-2);
  const middleLen = p.length - 4;
  return head + "*".repeat(middleLen) + tail;
}

// ======================== 加载订单列表 ========================

async function loadOrders() {
  try {
    const token = localStorage.getItem("adminToken");

    const res = await fetch("/api/admin/orders", {
      headers: token
        ? {
            Authorization: "Bearer " + token,
          }
        : {},
    });

    const data = await res.json();

    // 后端返回格式可能是 { success, orders } 或直接数组
    if (Array.isArray(data)) {
      allOrders = data;
    } else if (data.success && Array.isArray(data.orders)) {
      allOrders = data.orders;
    } else {
      console.warn("订单接口返回格式不符合预期:", data);
      allOrders = [];
    }

    applyFilterAndRender();
  } catch (err) {
    console.error("获取订单失败:", err);
    allOrders = [];
    applyFilterAndRender();
  }
}

// ======================== 筛选 + 渲染 ========================

// 根据状态 + 搜索 + 配送模式 + 区域过滤
function applyFilterAndRender() {
  const status = document.getElementById("statusFilter")?.value || "";
  const keyword = document
    .getElementById("orderSearchInput")
    ?.value.trim()
    .toLowerCase();

  // 新增：配送模式筛选（normal / friend / areaGroup）
  const serviceMode =
    document.getElementById("serviceModeFilter")?.value.toLowerCase() || "";

  // 新增：区域团拼单的区域筛选
  const areaZone =
    document.getElementById("areaZoneFilter")?.value.toLowerCase() || "";

  filteredOrders = allOrders.filter((order) => {
    // 1) 状态过滤
    if (status && order.status !== status) return false;

    // 2) 搜索过滤：订单号 / 用户名 / 手机号
    if (keyword) {
      const orderId = (order._id || order.id || "")
        .toString()
        .toLowerCase();
      const userName = (
        order.userName ||
        order.customerName ||
        ""
      ).toLowerCase();
      const userPhone = (order.userPhone || order.phone || "").toLowerCase();

      if (
        !orderId.includes(keyword) &&
        !userName.includes(keyword) &&
        !userPhone.includes(keyword)
      ) {
        return false;
      }
    }

    // 3) 配送模式过滤（次日 / 好友拼单 / 区域团拼单）
    if (serviceMode) {
      const mode = getServiceMode(order); // normal / friend / areagroup
      if (mode !== serviceMode) return false;
    }

    // 4) 区域团拼单区域过滤（只对区域团有意义）
    if (areaZone) {
      const mode = getServiceMode(order);
      if (mode !== "areagroup" && mode !== "group" && mode !== "groupday") {
        // 如果当前订单本身就不是区域团，直接过滤掉
        return false;
      }
      const zone = getAreaZone(order); // areaGroupZone / zoneId ...
      if (zone !== areaZone) return false;
    }

    return true;
  });

  currentPage = 1;
  renderOrders();
  renderPagination();
}

// 渲染表格
function renderOrders() {
  const tbody = document.getElementById("ordersTbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  orderMapClear();

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredOrders.slice(start, start + PAGE_SIZE);

  if (pageItems.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 10;
    td.textContent = "暂无订单";
    td.style.textAlign = "center";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  pageItems.forEach((order) => {
    const tr = document.createElement("tr");

    const id = order._id || order.id || "";
    const userName = order.userName || order.customerName || "-";
    const phone = order.userPhone || order.phone || "";
    const amount = Number(order.totalAmount || order.amount || 0);
    // 原来的配送方式（收货方式）：送货上门 / 自提
    const deliveryType =
      order.deliveryType ||
      order.shippingMethod ||
      (order.isPickup ? "自提" : "送货上门");
    const createdAt = order.createdAt || order.paidAt || order.created_at;
    const status = order.status || "unknown";

    // 存入 map 供打印单笔使用
    orderMap[id] = order;

    // 新增：业务配送模式（次日 / 好友拼单 / 区域团拼单）
    const serviceModeText = getServiceModeText(order);

    tr.innerHTML = `
      <td>${id}</td>
      <td>${userName}<br /><span style="font-size:11px;color:#9ca3af;">${phone}</span></td>
      <td>$${amount.toFixed(2)}</td>
      <td>${deliveryType || "-"}</td>
      <td>${serviceModeText}</td>
      <td>${renderStatusTag(status)}</td>
      <td>${formatDateTime(createdAt)}</td>
      <td>
        <div class="admin-table-actions">
          <button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="printOrder('${id}')">
            打印小票
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// 分页渲染
function renderPagination() {
  const container = document.getElementById("ordersPagination");
  if (!container) return;

  const total = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  container.innerHTML = "";

  const infoSpan = document.createElement("span");
  infoSpan.textContent = `共 ${total} 笔 · 第 ${currentPage}/${totalPages} 页`;
  container.appendChild(infoSpan);

  const createBtn = (label, page, disabled = false, primary = false) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "admin-btn admin-btn-ghost";
    if (primary) btn.classList.add("admin-btn-primary");
    if (disabled) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    } else {
      btn.addEventListener("click", () => {
        currentPage = page;
        renderOrders();
        renderPagination();
      });
    }
    container.appendChild(btn);
  };

  createBtn("«", Math.max(1, currentPage - 1), currentPage === 1);
  for (let p = 1; p <= totalPages && p <= currentPage + 2; p++) {
    if (p < currentPage - 2) continue;
    createBtn(p.toString(), p, false, p === currentPage);
  }
  createBtn("»", Math.min(totalPages, currentPage + 1), currentPage === totalPages);
}

// 状态标签
function renderStatusTag(status) {
  const s = (status || "").toLowerCase();
  let cls = "admin-tag";
  let text = status;

  if (["paid", "completed", "done", "finished"].includes(s)) {
    cls += " admin-tag-success";
    text = "已完成";
  } else if (["pending", "processing", "packing"].includes(s)) {
    cls += " admin-tag-warning";
    text = "处理中";
  } else if (["delivering", "shipped"].includes(s)) {
    cls += " admin-tag-warning";
    text = "配送中";
  } else if (["cancelled", "canceled"].includes(s)) {
    text = "已取消";
  } else {
    text = status || "未知";
  }

  return `<span class="${cls}">${text}</span>`;
}

// 时间格式化
function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${mm}`;
}

// 清空 map
function orderMapClear() {
  for (const k in orderMap) {
    if (Object.prototype.hasOwnProperty.call(orderMap, k)) {
      delete orderMap[k];
    }
  }
}

// ======================== 打印相关 ========================

// 打印订单（单笔小票）
function printOrder(orderId) {
  const order = orderMap[orderId];
  if (!order) {
    alert("未找到该订单数据，请刷新后重试");
    return;
  }

  const rawUserName = order.userName || order.customerName || "-";
  const rawPhone = order.userPhone || order.phone || "-";
  const userName = maskName(rawUserName);   // ⭐ 脱敏姓名
  const phone = maskPhone(rawPhone);        // ⭐ 脱敏手机号

  const address = order.address || order.shippingAddress || "-";
  const amount = Number(order.totalAmount || order.amount || 0);
  const deliveryFee = Number(order.deliveryFee || order.shippingFee || 0);
  const createdAt = order.createdAt || order.paidAt || order.created_at;
  const items = order.items || order.orderItems || [];

  const seq = getOrderSeq(order); // ⭐ 配送序号

  const printHtml = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>订单小票 - ${orderId}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
            padding: 16px;
            color: #111827;
          }
          h1 {
            font-size: 18px;
            margin-bottom: 8px;
          }
          .seq-box {
            margin-bottom: 8px;
            padding: 6px 8px;
            border-radius: 8px;
            border: 1px solid #16a34a;
            background: #dcfce7;
            text-align: center;
          }
          .seq-label {
            font-size: 11px;
            color: #166534;
            letter-spacing: 1px;
          }
          .seq-value {
            font-size: 26px;
            font-weight: 900;
            color: #166534;
            line-height: 1.1;
          }
          .meta {
            font-size: 12px;
            margin-bottom: 10px;
          }
          .meta div {
            margin-bottom: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-top: 6px;
          }
          th, td {
            border: 1px solid #e5e7eb;
            padding: 4px 6px;
          }
          th {
            background: #f9fafb;
          }
          .total {
            margin-top: 10px;
            font-size: 13px;
            text-align: right;
          }
          .total strong {
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <h1>在鲜购拼好货 · 配货小票</h1>

        <!-- ⭐ 大号配送序号 -->
        <div class="seq-box">
          <div class="seq-label">配送序号</div>
          <div class="seq-value">${seq != null ? seq : "-"}</div>
        </div>

        <div class="meta">
          <div>订单号：${orderId}</div>
          <div>下单时间：${formatDateTime(createdAt)}</div>
          <div>客户姓名：${userName}</div>
          <div>联系电话：${phone}</div>
          <div>配送地址：${address}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>数量</th>
              <th>单价</th>
              <th>小计</th>
            </tr>
          </thead>
          <tbody>
            ${
              items
                .map((item) => {
                  const name = item.productName || item.name || "-";
                  const qty = item.quantity || item.qty || 0;
                  const price = Number(item.price || item.unitPrice || 0);
                  const subtotal = price * qty;
                  return `
                    <tr>
                      <td>${name}</td>
                      <td>${qty}</td>
                      <td>$${price.toFixed(2)}</td>
                      <td>$${subtotal.toFixed(2)}</td>
                    </tr>
                  `;
                })
                .join("") || ""
            }
          </tbody>
        </table>

        <div class="total">
          商品总额：$${amount.toFixed(2)}<br/>
          配送费：$${deliveryFee.toFixed(2)}<br/>
          <strong>应付总额：$${(amount + deliveryFee).toFixed(2)}</strong>
        </div>
      </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) {
    alert("浏览器拦截了打印窗口，请允许弹出窗口后重试");
    return;
  }
  win.document.write(printHtml);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}

// 新增：打印当前筛选出来的整张订单列表
function printOrderList() {
  if (!filteredOrders.length) {
    alert("当前没有可打印的订单");
    return;
  }

  const rowsHtml = filteredOrders
    .map((order) => {
      const id = order._id || order.id || "";
      const userName = order.userName || order.customerName || "-";
      const phone = order.userPhone || order.phone || "";
      const amount = Number(order.totalAmount || order.amount || 0);
      const statusText = renderStatusTag(order.status || "").replace(
        /<[^>]+>/g,
        ""
      );
      const createdAt = order.createdAt || order.paidAt || order.created_at;
      const modeText = getServiceModeText(order);

      const zoneRaw =
  order.areaGroupZone ||
  order.zoneId ||
  order.deliveryZone ||
  order.zoneName ||
  "";

const zoneKey = String(zoneRaw || "").toLowerCase();
const zoneText = ZONE_NAME_MAP[zoneKey] || zoneRaw || "-";
      return `
        <tr>
          <td>${id}</td>
          <td>${userName}</td>
          <td>${phone}</td>
          <td>$${amount.toFixed(2)}</td>
          <td>${modeText}</td>
          <td>${zoneText}</td>
          <td>${statusText}</td>
          <td>${formatDateTime(createdAt)}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>订单列表打印</title>
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
        <h3>在鲜购拼好货 · 订单列表</h3>
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>用户</th>
              <th>手机号</th>
              <th>金额</th>
              <th>配送模式</th>
              <th>区域</th>
              <th>状态</th>
              <th>下单时间</th>
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

// ======================== 初始化事件绑定 ========================

function initAreaZoneFilterOptions() {
  const select = document.getElementById("areaZoneFilter");
  if (!select) return;

  // ✅ 只做保底：如果 loadZones() 失败，至少有“全部区域”
  if (!select.options.length) {
    select.innerHTML = `<option value="">全部区域</option>`;
  }
}
window.addEventListener("DOMContentLoaded", () => {
  // ✅ 先拉司机列表，再拉订单（不然下拉为空）
  (async () => {
  await loadDrivers();
  await loadZones();   // ✅ 先把区域名称映射和下拉框准备好
  await loadOrders();
})();
  // 状态筛选
  const statusSelect = document.getElementById("statusFilter");
  if (statusSelect) {
    statusSelect.addEventListener("change", applyFilterAndRender);
  }

  // 搜索框
  const searchInput = document.getElementById("orderSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      applyFilterAndRender();
    });
  }

  // 重置按钮
  const btnReset = document.getElementById("btnResetFilter");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (statusSelect) statusSelect.value = "";
      if (searchInput) searchInput.value = "";

      const serviceModeSelect = document.getElementById("serviceModeFilter");
      const areaZoneSelect = document.getElementById("areaZoneFilter");
      if (serviceModeSelect) serviceModeSelect.value = "";
      if (areaZoneSelect) areaZoneSelect.value = "";

      applyFilterAndRender();
    });
  }

  // 导出（占位）
  const btnExport = document.getElementById("btnExportOrders");
  if (btnExport) {
    btnExport.addEventListener("click", () => {
      alert("导出功能可以后面接成 CSV / Excel，目前只是占位按钮。");
    });
  }

  // 配送模式筛选
  const serviceModeSelect = document.getElementById("serviceModeFilter");
  if (serviceModeSelect) {
    serviceModeSelect.addEventListener("change", applyFilterAndRender);
  }

  // 区域筛选
  initAreaZoneFilterOptions();
  const areaZoneSelect = document.getElementById("areaZoneFilter");
  if (areaZoneSelect) {
    areaZoneSelect.addEventListener("change", applyFilterAndRender);
  }

  // 一键打印筛选订单
  const btnPrintList = document.getElementById("btnPrintOrderList");
  if (btnPrintList) {
    btnPrintList.addEventListener("click", printOrderList);
  }
});
