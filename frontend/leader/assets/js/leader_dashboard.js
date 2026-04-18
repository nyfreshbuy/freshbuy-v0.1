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

    box.innerHTML = payload.items.map((p) => `
      <div class="card" style="margin-bottom:12px;">
        <div><b>${safeText(p.name)}</b></div>
        <div>联系人：${safeText(p.contactName || p.leaderName)}</div>
        <div>电话：${safeText(p.contactPhone || p.leaderPhone)}</div>
        <div>地址：${safeText(p.fullAddress || p.maskedAddress)}</div>
        <div>营业时间：${safeText(p.pickupTimeText)}</div>
        <div>状态：${safeText(p.status, "active")}</div>
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

async function init() {
  const btn = document.getElementById("submitPickupPointBtn");
  if (btn) {
    btn.addEventListener("click", submitPickupPointRequest);
  }

  // ✅ 加这一行（关键）
  bindBusinessHourToggles();

  await loadStats();
  await loadOrders();
  await loadPickups();
  await loadPickupPoints();
  await loadPickupRequestList();
}
init();