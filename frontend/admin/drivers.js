// frontend/admin/drivers.js
console.log("🔥 drivers.js 新版已加载 2025-12-14");

let currentPage = 1;
let totalPages = 1;
let editingDriverId = null;

// =============== 临时密码提示条 ===============
function copyToClipboard(text) {
  if (!text) return Promise.resolve(false);

  // 优先用 Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
  }

  // fallback
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve(!!ok);
  } catch {
    return Promise.resolve(false);
  }
}

async function showTempPasswordBar(tempPassword, title = "临时密码（已自动复制）") {
  const bar = document.getElementById("tempPwdBar");
  const textEl = document.getElementById("tempPwdText");
  const tipEl = document.getElementById("tempPwdTip");
  const copyBtn = document.getElementById("copyTempPwdBtn");

  if (!bar || !textEl || !tipEl || !copyBtn) return;

  textEl.textContent = tempPassword || "-";
  tipEl.textContent = title;

  bar.style.display = "block";

  const copied = await copyToClipboard(tempPassword || "");
  tipEl.textContent = copied ? `${title} ✅` : `${title}（自动复制失败，可点“复制”）`;

  copyBtn.onclick = async () => {
    const ok = await copyToClipboard(tempPassword || "");
    tipEl.textContent = ok ? "已复制 ✅" : "复制失败（请手动选中复制）";
  };
}

function hideTempPasswordBar() {
  const bar = document.getElementById("tempPwdBar");
  if (bar) bar.style.display = "none";
}

function mapStatusLabel(status) {
  switch (status) {
    case "online":
      return "在线";
    case "offline":
      return "离线";
    case "suspended":
    case "disabled":
      return "停用";
    default:
      return status || "-";
  }
}

function normalizeDriver(d) {
  return {
    id: d.id || d._id,
    name: d.name || "",
    phone: d.phone || "",
    vehicleType: d.carType || d.vehicleType || "",
    plateNumber: d.plate || d.plateNumber || "",
    region: d.zone || d.region || "",
    status: d.status || "offline",
    todayOrders: d.todayOrders ?? 0,
    totalOrders: d.totalOrders ?? 0,
    rating: d.rating ?? 0,
  };
}

// =============== 列表（DB：/api/admin/drivers 返回 drivers） ===============
async function fetchDrivers(page = 1) {
  const keyword = document.getElementById("keyword").value.trim();
  const status = document.getElementById("statusFilter").value;
  const region = document.getElementById("regionFilter").value;

  const params = new URLSearchParams();
  if (keyword) params.append("q", keyword);
  if (status) {
    // 你的下拉里是 disabled，这里转成后端的 suspended
    params.append("status", status === "disabled" ? "suspended" : status);
  }
  if (region) params.append("zone", region);

  try {
    const res = await fetch(`/api/admin/drivers?${params.toString()}`);
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "获取司机列表失败");
      return;
    }

    const all = (data.drivers || []).map(normalizeDriver);

    // 前端分页（20/页）
    const pageSize = 20;
    totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    currentPage = Math.min(Math.max(1, page), totalPages);

    const start = (currentPage - 1) * pageSize;
    const list = all.slice(start, start + pageSize);

    renderTable(list);
    renderPagination();
  } catch (e) {
    console.error(e);
    alert("请求失败，请检查后端是否启动");
  }
}

function renderTable(list) {
  const tbody = document.getElementById("driverTableBody");
  tbody.innerHTML = "";

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10">暂无司机数据</td></tr>`;
    return;
  }

  list.forEach((d) => {
    const tr = document.createElement("tr");

    const statusClass =
      d.status === "online"
        ? "status-pill active"
        : d.status === "suspended" || d.status === "disabled"
        ? "status-pill disabled"
        : "status-pill";

    tr.innerHTML = `
      <td>${d.name || "-"}</td>
      <td>${d.phone || "-"}</td>
      <td>${d.vehicleType || "-"}</td>
      <td>${d.plateNumber || "-"}</td>
      <td>${d.region || "-"}</td>
      <td><span class="${statusClass}">${mapStatusLabel(d.status)}</span></td>
      <td>${d.todayOrders ?? 0}</td>
      <td>${d.totalOrders ?? 0}</td>
      <td>${typeof d.rating === "number" && d.rating > 0 ? d.rating.toFixed(1) : "-"}</td>
      <td>
       <td>
  <button class="link-btn" onclick="openEditModal('${d.id}')">编辑</button>
  <button class="link-btn" onclick="resetPassword('${d.id}')">重置密码</button>
  <button class="link-btn" style="color:#f87171"
    onclick="deleteDriver('${d.id}', '${d.name || ""}')">
    删除
  </button>
</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPagination() {
  const container = document.getElementById("driverPagination");
  if (!container) return;

  container.innerHTML = "";

  if (totalPages <= 1) return;

  const info = document.createElement("span");
  info.textContent = `第 ${currentPage} / ${totalPages} 页`;

  const prev = document.createElement("button");
  prev.textContent = "上一页";
  prev.className = "driver-page-btn";
  prev.disabled = currentPage === 1;
  prev.onclick = () => fetchDrivers(currentPage - 1);

  const next = document.createElement("button");
  next.textContent = "下一页";
  next.className = "driver-page-btn";
  next.disabled = currentPage === totalPages;
  next.onclick = () => fetchDrivers(currentPage + 1);

  container.appendChild(info);
  container.appendChild(prev);
  container.appendChild(next);
}

// =============== 新增司机（需要你已经有 addModal 那套 HTML；若还没加我再给你） ===============
function openAddModal() {
  document.getElementById("addModal")?.classList.add("open");
  ["addName","addPhone","addCarType","addPlate","addZone"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const st = document.getElementById("addStatus");
  if (st) st.value = "offline";
}

function closeAddModal() {
  document.getElementById("addModal")?.classList.remove("open");
}

async function createDriver() {
  const body = {
    name: document.getElementById("addName").value.trim(),
    phone: document.getElementById("addPhone").value.trim(),
    carType: document.getElementById("addCarType").value.trim(),
    plate: document.getElementById("addPlate").value.trim(),
    zone: document.getElementById("addZone").value.trim(),
    status: document.getElementById("addStatus").value,
  };

  if (!body.name || !body.phone) {
    alert("姓名和手机号不能为空");
    return;
  }

  try {
    const res = await fetch("/api/admin/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "新增司机失败");
      return;
    }

    closeAddModal();
    await showTempPasswordBar(data.tempPassword, "新增司机临时密码（已自动复制）");
    fetchDrivers(1);
  } catch (e) {
    console.error(e);
    alert("请求失败");
  }
}

// =============== 编辑司机（DB：GET详情 + PATCH保存） ===============
async function openEditModal(id) {
  try {
    const res = await fetch(`/api/admin/drivers/${id}`);
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "获取司机详情失败");
      return;
    }

    const d = data.driver;
    editingDriverId = d.id;

    document.getElementById("editName").value = d.name || "";
    document.getElementById("editPhone").value = d.phone || "";
    document.getElementById("editVehicleType").value = d.carType || "";
    document.getElementById("editPlateNumber").value = d.plate || "";
    document.getElementById("editRegion").value = d.zone || "";
    document.getElementById("editStatus").value =
      d.status === "suspended" ? "disabled" : (d.status || "offline");

    document.getElementById("editModal").classList.add("open");
  } catch (e) {
    console.error(e);
    alert("请求失败");
  }
}

async function saveDriver() {
  if (!editingDriverId) return;

  const body = {
    name: document.getElementById("editName").value.trim(),
    phone: document.getElementById("editPhone").value.trim(),
    carType: document.getElementById("editVehicleType").value.trim(),
    plate: document.getElementById("editPlateNumber").value.trim(),
    zone: document.getElementById("editRegion").value.trim(),
    status:
      document.getElementById("editStatus").value === "disabled"
        ? "suspended"
        : document.getElementById("editStatus").value,
  };

  if (!body.name || !body.phone) {
    alert("姓名和手机号不能为空");
    return;
  }

  try {
    const res = await fetch(`/api/admin/drivers/${editingDriverId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "保存失败");
      return;
    }

    document.getElementById("editModal").classList.remove("open");
    editingDriverId = null;
    fetchDrivers(currentPage);
  } catch (e) {
    console.error(e);
    alert("请求失败");
  }
}

function closeEditModal() {
  document.getElementById("editModal").classList.remove("open");
  editingDriverId = null;
}

// =============== 重置密码（DB：POST reset-password） ===============
async function resetPassword(id) {
  if (!confirm("确认要重置这个司机的密码吗？")) return;

  try {
    const res = await fetch(`/api/admin/drivers/${id}/reset-password`, {
      method: "POST",
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "重置失败");
      return;
    }

    await showTempPasswordBar(data.tempPassword, "重置密码临时密码（已自动复制）");
  } catch (e) {
    console.error(e);
    alert("请求失败");
  }
}
async function deleteDriver(id, name) {
  const label = name ? `【${name}】` : "";
  if (!confirm(`确认要删除司机 ${label} 吗？此操作不可恢复！`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/drivers/${id}`, {
      method: "DELETE",
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "删除失败");
      return;
    }

    // 删除成功
    alert("司机已删除");
    fetchDrivers(1);
  } catch (e) {
    console.error(e);
    alert("请求失败");
  }
}
// 挂到 window，给 HTML onclick 用
window.openEditModal = openEditModal;
window.resetPassword = resetPassword;
window.deleteDriver = deleteDriver;
// =============== 事件绑定 ===============
window.addEventListener("DOMContentLoaded", () => {
  // 搜索
  document.getElementById("searchBtn")?.addEventListener("click", () => fetchDrivers(1));
  document.getElementById("refreshBtn")?.addEventListener("click", () => fetchDrivers(1));

  // 编辑弹窗
  document.getElementById("saveDriverBtn")?.addEventListener("click", saveDriver);
  document.getElementById("cancelEditBtn")?.addEventListener("click", closeEditModal);

  // 新增弹窗（需要你已经添加 addModal HTML）
  document.getElementById("addDriverBtn")?.addEventListener("click", openAddModal);
  document.getElementById("createDriverBtn")?.addEventListener("click", createDriver);
  document.getElementById("cancelAddBtn")?.addEventListener("click", closeAddModal);

  // 临时密码条
  document.getElementById("closeTempPwdBtn")?.addEventListener("click", hideTempPasswordBar);

  fetchDrivers(1);
});
