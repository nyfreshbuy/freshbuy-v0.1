function safeMoney(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function safeText(v, fallback = "-") {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

function renderEmptyRow(tbody, text, colSpan = 4) {
  tbody.innerHTML = `
    <tr>
      <td colspan="${colSpan}" style="color:#999;text-align:center;padding:16px;">
        ${text}
      </td>
    </tr>
  `;
}

function makeStatusBadge(text) {
  const t = String(text || "待处理");

  let bg = "#f3f4f6";
  let color = "#374151";

  if (t.includes("已完成")) {
    bg = "#dcfce7";
    color = "#166534";
  } else if (t.includes("待自提")) {
    bg = "#dbeafe";
    color = "#1d4ed8";
  } else if (t.includes("已通知")) {
    bg = "#fef3c7";
    color = "#92400e";
  } else if (t.includes("处理中") || t.includes("待处理")) {
    bg = "#ede9fe";
    color = "#6d28d9";
  } else if (t.includes("已取消")) {
    bg = "#fee2e2";
    color = "#991b1b";
  }

  return `
    <span style="
      display:inline-block;
      padding:4px 10px;
      border-radius:999px;
      font-size:12px;
      font-weight:600;
      background:${bg};
      color:${color};
      white-space:nowrap;
    ">
      ${t}
    </span>
  `;
}

async function loadStats() {
  const data = await api("/api/leader/dashboard/stats?_t=" + Date.now());

  const todayOrdersEl = document.getElementById("todayOrders");
  const pendingPickupEl = document.getElementById("pendingPickup");
  const weekCommissionEl = document.getElementById("weekCommission");
  const totalCustomersEl = document.getElementById("totalCustomers");

  if (!data || !data.ok) {
    if (todayOrdersEl) todayOrdersEl.innerText = "0";
    if (pendingPickupEl) pendingPickupEl.innerText = "0";
    if (weekCommissionEl) weekCommissionEl.innerText = "$0.00";
    if (totalCustomersEl) totalCustomersEl.innerText = "0";
    return;
  }

  const stats = data.stats || {};

  if (todayOrdersEl) {
    todayOrdersEl.innerText = Number(stats.todayOrders || 0);
  }

  if (pendingPickupEl) {
    pendingPickupEl.innerText = Number(stats.pendingPickupOrders || 0);
  }

  if (weekCommissionEl) {
    weekCommissionEl.innerText = "$" + safeMoney(stats.weekCommission);
  }

  if (totalCustomersEl) {
    totalCustomersEl.innerText = Number(stats.totalCustomers || 0);
  }
}

async function loadOrders() {
  const data = await api("/api/leader/orders?status=pending&_t=" + Date.now());

  const tbody = document.getElementById("orderList");
  if (!tbody) return;

  if (!data || !data.ok) {
    renderEmptyRow(tbody, "订单加载失败");
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    renderEmptyRow(tbody, "暂无待处理订单");
    return;
  }

  tbody.innerHTML = "";

  items.forEach((o) => {
    const tr = document.createElement("tr");

    const statusText = safeText(o.statusText || o.status, "待处理");

    tr.innerHTML = `
      <td>${safeText(o.orderNo)}</td>
      <td>${safeText(o.customerName)}</td>
      <td>$${safeMoney(o.total)}</td>
      <td>${makeStatusBadge(statusText)}</td>
    `;

    tbody.appendChild(tr);
  });
}

async function loadPickups() {
  const data = await api("/api/leader/pickups/today?_t=" + Date.now());

  const tbody = document.getElementById("pickupList");
  if (!tbody) return;

  if (!data || !data.ok) {
    renderEmptyRow(tbody, "今日自提加载失败");
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    renderEmptyRow(tbody, "今天暂无自提订单");
    return;
  }

  tbody.innerHTML = "";

  items.forEach((o) => {
    const tr = document.createElement("tr");

    const statusText = safeText(o.statusText || o.status, "待处理");

    tr.innerHTML = `
      <td>${safeText(o.orderNo)}</td>
      <td>${safeText(o.customerName)}</td>
      <td>${safeText(o.pickupCode, "-")}</td>
      <td>${makeStatusBadge(statusText)}</td>
    `;

    tbody.appendChild(tr);
  });
}

async function loadPickupPoints() {
  const box = document.getElementById("pickupPointList");
  if (!box) return;

  box.innerHTML = "加载中...";

  try {
    const resp = await api("/api/leader/pickup-points?_t=" + Date.now());
    const payload = resp?.data && typeof resp.data === "object" ? resp.data : resp;

    if (!payload || !payload.ok || !Array.isArray(payload.items)) {
      box.innerHTML = "<div class='card'>暂无数据</div>";
      return;
    }

    if (!payload.items.length) {
      box.innerHTML = "<div class='card'>暂无自提点</div>";
      return;
    }

    CURRENT_PICKUP_POINTS = Array.isArray(payload.items) ? payload.items : [];

box.innerHTML = payload.items.map((p) => `
  <div class="card" style="margin-bottom:12px;">
    <div><b>${safeText(p.name)}</b></div>
    <div>联系人：${safeText(p.contactName || p.leaderName)}</div>
    <div>电话：${safeText(p.contactPhone || p.leaderPhone)}</div>
    <div>地址：${safeText(p.fullAddress || p.maskedAddress)}</div>
    <div>营业时间：${safeText(p.pickupTimeText)}</div>
    <div>状态：${safeText(p.status, "active")}</div>

    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
      <button onclick="startEdit('${p._id}')">编辑</button>
    </div>
  </div>
`).join("");
  } catch (e) {
    console.error("loadPickupPoints error:", e);
    box.innerHTML = "<div class='card'>加载失败</div>";
  }
}

async function loadPickupRequestList() {
  const box = document.getElementById("pickupRequestList");
  if (!box) return;

  box.innerHTML = "加载中...";

  try {
    const resp = await api("/api/leader/pickup-change-requests?_t=" + Date.now());
    const payload = resp?.data && typeof resp.data === "object" ? resp.data : resp;

    if (!payload || !payload.ok || !Array.isArray(payload.items)) {
      box.innerHTML = "<div class='card'>暂无记录</div>";
      return;
    }

    if (!payload.items.length) {
      box.innerHTML = "<div class='card'>暂无申请记录</div>";
      return;
    }

    box.innerHTML = payload.items.map((r) => `
      <div class="card" style="margin-bottom:12px;">
        <div><b>${safeText(r.submittedData?.name)}</b></div>
        <div>类型：${r.requestType === "edit" ? "修改" : "新增"}</div>
        <div>联系人：${safeText(r.submittedData?.contactName)}</div>
        <div>电话：${safeText(r.submittedData?.contactPhone)}</div>
        <div>地址：${safeText(r.submittedData?.fullAddress)}</div>
        <div>营业时间：${safeText(r.submittedData?.pickupTimeText)}</div>
        <div>状态：${safeText(r.status, "pending")}</div>
        <div>团长备注：${safeText(r.leaderRemark)}</div>
        <div>管理员备注：${safeText(r.adminRemark)}</div>
      </div>
    `).join("");
  } catch (e) {
    console.error("loadPickupRequestList error:", e);
    box.innerHTML = "<div class='card'>加载失败</div>";
  }
}
function collectEditBusinessHours() {
  const rows = document.querySelectorAll(".edit-bh-row");

  const result = [];

  rows.forEach(row => {
    const day = Number(row.dataset.day);

    const status = row.querySelector(".edit-status").value;
    const open = row.querySelector(".edit-open").value;
    const close = row.querySelector(".edit-close").value;

    result.push({
      day,
      open: status === "closed" ? "" : open,
      close: status === "closed" ? "" : close,
      closed: status === "closed"
    });
  });

  return result;
}
function bindEditBusinessHourUI() {
  const rows = Array.from(document.querySelectorAll(".edit-bh-row"));

  const syncRow = (row) => {
    const statusEl = row.querySelector(".edit-status");
    const openEl = row.querySelector(".edit-open");
    const closeEl = row.querySelector(".edit-close");

    const isClosed = statusEl?.value === "closed";

    row.classList.toggle("closed-row", isClosed);

    if (openEl) openEl.disabled = isClosed;
    if (closeEl) closeEl.disabled = isClosed;
  };

  rows.forEach(row => {
    const statusEl = row.querySelector(".edit-status");
    statusEl?.addEventListener("change", () => syncRow(row));
    syncRow(row);
  });

  // ✅ 复制周一
  document.getElementById("copyFirstDayBtn")?.addEventListener("click", () => {
    const first = document.querySelector('.edit-bh-row[data-day="1"]');
    if (!first) return;

    const status = first.querySelector(".edit-status")?.value || "open";
    const open = first.querySelector(".edit-open")?.value || "09:00";
    const close = first.querySelector(".edit-close")?.value || "18:00";

    rows.forEach(row => {
      row.querySelector(".edit-status").value = status;
      row.querySelector(".edit-open").value = open;
      row.querySelector(".edit-close").value = close;
      syncRow(row);
    });
  });

  // ✅ 全部营业
  document.getElementById("setAllOpenBtn")?.addEventListener("click", () => {
    rows.forEach(row => {
      row.querySelector(".edit-status").value = "open";
      if (!row.querySelector(".edit-open").value) row.querySelector(".edit-open").value = "09:00";
      if (!row.querySelector(".edit-close").value) row.querySelector(".edit-close").value = "18:00";
      syncRow(row);
    });
  });

  // ✅ 全部休息
  document.getElementById("setAllClosedBtn")?.addEventListener("click", () => {
    rows.forEach(row => {
      row.querySelector(".edit-status").value = "closed";
      syncRow(row);
    });
  });
}
function collectBusinessHours() {
  try {
    const rows = Array.from(document.querySelectorAll(".bh-row"));

    return rows.map((row) => {
      const day = Number(row.getAttribute("data-day"));
      const statusEl = row.querySelector(".bh-status");
      const openEl = row.querySelector(".bh-open");
      const closeEl = row.querySelector(".bh-close");

      const isClosed = statusEl?.value === "closed";
      const open = (openEl?.value || "").trim();
      const close = (closeEl?.value || "").trim();

      if (!isClosed) {
        if (!open || !close) {
          throw new Error("营业时间不能为空");
        }
      }

      return {
        day,
        open: isClosed ? "" : open,
        close: isClosed ? "" : close,
        closed: isClosed
      };
    });
  } catch (e) {
    console.error("collectBusinessHours error:", e);
    return null;
  }
}

function bindBusinessHourToggles() {
  const rows = Array.from(document.querySelectorAll(".bh-row"));

  rows.forEach((row) => {
    const statusEl = row.querySelector(".bh-status");
    const openEl = row.querySelector(".bh-open");
    const closeEl = row.querySelector(".bh-close");

    const sync = () => {
      const isClosed = statusEl?.value === "closed";

      if (openEl) {
        openEl.disabled = isClosed;
        openEl.style.opacity = isClosed ? "0.5" : "1";
      }

      if (closeEl) {
        closeEl.disabled = isClosed;
        closeEl.style.opacity = isClosed ? "0.5" : "1";
      }
    };

    if (statusEl) {
      statusEl.addEventListener("change", sync);
    }

    sync();
  });
}
async function submitPickupPointRequest() {
  const msg = document.getElementById("pickupPointSubmitMsg");
  if (msg) msg.innerText = "提交中...";

    const businessHours = collectBusinessHours();
  if (!businessHours) {
    if (msg) msg.innerText = "营业时间填写不正确";
    return;
  }
  const payload = {
    requestType: "add",
    name: document.getElementById("pp_name")?.value?.trim() || "",
    contactName: document.getElementById("pp_contactName")?.value?.trim() || "",
    contactPhone: document.getElementById("pp_contactPhone")?.value?.trim() || "",
    addressLine1: document.getElementById("pp_addressLine1")?.value?.trim() || "",
    addressLine2: document.getElementById("pp_addressLine2")?.value?.trim() || "",
    city: document.getElementById("pp_city")?.value?.trim() || "",
    state: document.getElementById("pp_state")?.value?.trim() || "NY",
    zip: document.getElementById("pp_zip")?.value?.trim() || "",
    fullAddress: document.getElementById("pp_fullAddress")?.value?.trim() || "",
    displayArea: document.getElementById("pp_displayArea")?.value?.trim() || "",
    nearStreet: document.getElementById("pp_nearStreet")?.value?.trim() || "",
    maskedAddress: document.getElementById("pp_maskedAddress")?.value?.trim() || "",
    pickupTimeText: document.getElementById("pp_pickupTimeText")?.value?.trim() || "",
    businessHours,
    leaderRemark: document.getElementById("pp_leaderRemark")?.value?.trim() || ""
  };

  try {
    const data = await api("/api/leader/pickup-change-requests", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (data?.success) {
      if (msg) msg.innerText = "提交成功，等待管理员审核";

      const ids = [
  "pp_name",
  "pp_contactName",
  "pp_contactPhone",
  "pp_addressLine1",
  "pp_addressLine2",
  "pp_city",
  "pp_state",
  "pp_zip",
  "pp_fullAddress",
  "pp_displayArea",
  "pp_nearStreet",
  "pp_maskedAddress",
  "pp_pickupTimeText",
  "pp_leaderRemark"
];
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
// ✅ 重置营业时间
const rows = Array.from(document.querySelectorAll(".bh-row"));
rows.forEach((row) => {
  const statusEl = row.querySelector(".bh-status");
  const openEl = row.querySelector(".bh-open");
  const closeEl = row.querySelector(".bh-close");

  if (statusEl) statusEl.value = "open";
  if (openEl) openEl.value = "09:00";
  if (closeEl) closeEl.value = "18:00";
});

// 重新绑定状态
bindBusinessHourToggles();
      await loadPickupRequestList();
    } else {
      if (msg) msg.innerText = data?.message || "提交失败";
    }
  } catch (e) {
    console.error("submitPickupPointRequest error:", e);
    if (msg) msg.innerText = "提交失败";
  }
}
let CURRENT_PICKUP_POINTS = [];

function openBasicEdit(id) {
  const point = CURRENT_PICKUP_POINTS.find(x => String(x._id) === String(id));
  if (!point) return;

  const contactName = prompt("联系人", point.contactName || point.leaderName || "");
  if (contactName === null) return;

  const contactPhone = prompt("联系电话", point.contactPhone || point.leaderPhone || "");
  if (contactPhone === null) return;

  const rawHours = prompt(
    '营业时间 JSON（例如 [{"day":6,"open":"14:00","close":"18:00","closed":false}]）',
    JSON.stringify(point.businessHours || [])
  );
  if (rawHours === null) return;

  let businessHours = [];
  try {
    businessHours = rawHours ? JSON.parse(rawHours) : [];
  } catch (e) {
    alert("营业时间格式不正确");
    return;
  }

  saveBasicPickupPoint(id, {
    contactName,
    contactPhone,
    businessHours
  });
}

async function saveBasicPickupPoint(id, payload) {
  try {
    const resp = await api(`/api/leader/pickup-points/${id}/basic`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json"
      }
    });

    const data = resp?.data && typeof resp.data === "object" ? resp.data : resp;

    if (!data?.success) {
      alert(data?.message || "保存失败");
      return;
    }

    alert("保存成功");
    await loadPickupPoints();
  } catch (e) {
    console.error("saveBasicPickupPoint error:", e);
    alert("保存失败");
  }
}

function openAuditEdit(id) {
  const point = CURRENT_PICKUP_POINTS.find(x => String(x._id) === String(id));
  if (!point) {
    alert("找不到自提点数据");
    return;
  }

  const name = prompt("自提点名字（修改后需审核）", point.name || "");
  if (name === null) return;

  const addressLine1 = prompt("地址1（修改后需审核）", point.addressLine1 || "");
  if (addressLine1 === null) return;

  const addressLine2 = prompt("地址2（可选）", point.addressLine2 || "");
  if (addressLine2 === null) return;

  const city = prompt("城市", point.city || "");
  if (city === null) return;

  const state = prompt("州", point.state || "NY");
  if (state === null) return;

  const zip = prompt("ZIP", point.zip || "");
  if (zip === null) return;

  const fullAddress = prompt("完整地址", point.fullAddress || "");
  if (fullAddress === null) return;

  const displayArea = prompt("展示区域", point.displayArea || "");
  if (displayArea === null) return;

  const nearStreet = prompt("附近街道", point.nearStreet || "");
  if (nearStreet === null) return;

  const maskedAddress = prompt("前台遮罩地址", point.maskedAddress || "");
  if (maskedAddress === null) return;

  submitAuditEditRequest({
    requestType: "edit",
    pickupPointId: id,
    name,
    contactName: point.contactName || "",
    contactPhone: point.contactPhone || "",
    addressLine1,
    addressLine2,
    city,
    state,
    zip,
    fullAddress,
    displayArea,
    nearStreet,
    maskedAddress,
    pickupTimeText: point.pickupTimeText || "",
    businessHours: Array.isArray(point.businessHours) ? point.businessHours : [],
    leaderRemark: "团长修改自提点名字/地址，等待审核"
  });
}

async function submitAuditEditRequest(payload) {
  try {
    const resp = await api("/api/leader/pickup-change-requests", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json"
      }
    });

    const data = resp?.data && typeof resp.data === "object" ? resp.data : resp;

    if (!data?.success) {
      alert(data?.message || "提交失败");
      return;
    }

    alert("已提交审核");
    await loadPickupRequestList();
  } catch (e) {
    console.error("submitAuditEditRequest error:", e);
    alert("提交失败");
  }
}
function startEdit(id) {
  const p = CURRENT_PICKUP_POINTS.find(x => String(x._id) === String(id));
  if (!p) return;

  const editor = document.getElementById("pickupEditor");
  if (!editor) {
    console.error("❌ pickupEditor 不存在");
    return;
  }

  editor.style.display = "block";

// ✅ 自动滚动到编辑框
editor.scrollIntoView({ behavior: "smooth", block: "center" });

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) {
      console.warn("找不到元素:", id);
      return;
    }
    el.value = val || "";
  };

    setVal("edit_id", p._id);
  setVal("edit_name", p.name);
  setVal("edit_contactName", p.contactName);
  setVal("edit_contactPhone", p.contactPhone);
  setVal("edit_addressLine1", p.addressLine1);
  setVal("edit_city", p.city);
  setVal("edit_zip", p.zip);

  // ✅ 回填营业时间
  if (Array.isArray(p.businessHours)) {
    p.businessHours.forEach(h => {
      const row = document.querySelector(`.edit-bh-row[data-day="${h.day}"]`);
      if (!row) return;

      const statusEl = row.querySelector(".edit-status");
      const openEl = row.querySelector(".edit-open");
      const closeEl = row.querySelector(".edit-close");

      if (statusEl) statusEl.value = h.closed ? "closed" : "open";
      if (openEl) openEl.value = h.open || "";
      if (closeEl) closeEl.value = h.close || "";
    });
  }
}
async function init() {
  const btn = document.getElementById("submitPickupPointBtn");
  if (btn) {
    btn.addEventListener("click", submitPickupPointRequest);
  }

  bindBusinessHourToggles();
bindEditBusinessHourUI();   // 👈 加这一行

  // ✅ 就是这里开始新增
  document.getElementById("saveBasicBtn")?.addEventListener("click", async () => {
    const id = document.getElementById("edit_id").value;

    await saveBasicPickupPoint(id, {
      contactName: document.getElementById("edit_contactName").value,
      contactPhone: document.getElementById("edit_contactPhone").value,
      businessHours: collectEditBusinessHours()
    });
  });

  document.getElementById("submitAuditBtn")?.addEventListener("click", async () => {
    const id = document.getElementById("edit_id").value;

    await submitAuditEditRequest({
      requestType: "edit",
      pickupPointId: id,
      name: document.getElementById("edit_name").value,
      addressLine1: document.getElementById("edit_addressLine1").value,
      city: document.getElementById("edit_city").value,
      zip: document.getElementById("edit_zip").value
    });
  });
  // ✅ 新增结束

  await loadStats();
  await loadOrders();
  await loadPickups();
  await loadPickupPoints();
  await loadPickupRequestList();
}
window.openBasicEdit = openBasicEdit;
window.openAuditEdit = openAuditEdit;
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM 已加载");
});
init();