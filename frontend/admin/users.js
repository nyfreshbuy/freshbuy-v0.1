// frontend/admin/users.js
console.log("✅ users.js 已加载");

let currentPage = 1;
let totalPages = 1;
let editingUserId = null;

// ✅ 修改密码弹窗：当前正在改密码的用户ID
let settingPwdUserId = null;

// 拉取用户列表
async function fetchUsers(page = 1) {
  const keyword = document.getElementById("keyword")?.value?.trim() || "";
  const role = document.getElementById("roleFilter")?.value || "";
  const status = document.getElementById("statusFilter")?.value || "";

  const params = new URLSearchParams({ page, limit: 20 });
  if (keyword) params.append("keyword", keyword);
  if (role) params.append("role", role);
  if (status) params.append("status", status);

  try {
    const res = await fetch(`/api/admin/users?${params.toString()}`);
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "获取用户失败");
      return;
    }

    currentPage = data.page || page;
    totalPages = data.totalPages ?? data.pages ?? 1;

    const items = data.items || data.users || data.list || data.data || [];
    renderTable(items);
    renderPagination();
  } catch (err) {
    console.error("fetchUsers error:", err);
    alert("请求失败，请检查后端是否启动");
  }
}

// 渲染表格
function renderTable(users) {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  users.forEach((u) => {
    const tr = document.createElement("tr");

    const id = String(u.id || u._id || "");
    const wallet = Number(u.walletBalance ?? u.balance ?? u.wallet ?? 0);
    const addrText = String(u.addressText || u.address || "").trim();

    tr.innerHTML = `
      <td>${u.name || "-"}</td>
      <td>${u.phone || "-"}</td>
      <td>${mapRole(u.role)}</td>
      <td>${mapStatus(u.status)}</td>
      <td>${u.totalOrders ?? 0}</td>
      <td>$${Number(u.totalSpent ?? 0).toFixed(2)}</td>
      <td>$${Number(wallet).toFixed(2)}</td>
      <td style="max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          title="${addrText.replace(/"/g, "&quot;")}">
        ${addrText ? addrText : "-"}
      </td>
      <td>${u.createdAt ? formatDate(u.createdAt) : "-"}</td>
      <td>
        <button class="link-btn" onclick="openEditModal('${id}')">编辑</button>
        <button class="link-btn" onclick="openSetPasswordModal('${id}')">修改密码</button>
        <button class="link-btn danger" onclick="deleteUser('${id}')">删除</button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// 分页
function renderPagination() {
  const container = document.getElementById("pagination");
  if (!container) return;

  container.innerHTML = "";
  if (totalPages <= 1) return;

  const prev = document.createElement("button");
  prev.textContent = "上一页";
  prev.disabled = currentPage === 1;
  prev.onclick = () => fetchUsers(currentPage - 1);

  const next = document.createElement("button");
  next.textContent = "下一页";
  next.disabled = currentPage === totalPages;
  next.onclick = () => fetchUsers(currentPage + 1);

  const info = document.createElement("span");
  info.textContent = `第 ${currentPage} / ${totalPages} 页`;

  container.appendChild(prev);
  container.appendChild(info);
  container.appendChild(next);
}

// 角色显示
function mapRole(role) {
  const r = String(role || "").toLowerCase();
  switch (r) {
    case "admin":
      return "管理员";
    case "leader":
      return "团长";
    case "driver":
      return "司机";
    case "customer":
      return "普通用户";
    default:
      return r ? r : "普通用户";
  }
}

// 状态显示
function mapStatus(status) {
  const s = String(status || "").toLowerCase();
  switch (s) {
    case "active":
      return "正常";
    case "disabled":
      return "禁用";
    default:
      return s ? s : "-";
  }
}

// 时间显示
function formatDate(str) {
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

/* =========================
   编辑用户弹窗
========================= */
async function openEditModal(id) {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!data.success) {
      alert(data.message || "获取用户详情失败");
      return;
    }

    const u = data.user || {};
    editingUserId = String(u.id || u._id || id);

    document.getElementById("editName").value = u.name || "";
    document.getElementById("editPhone").value = u.phone || "";
    document.getElementById("editRole").value = u.role || "customer";
    document.getElementById("editStatus").value = u.status || "active";

    document.getElementById("editModal").classList.add("open");
  } catch (err) {
    console.error("openEditModal error:", err);
    alert("请求失败");
  }
}

async function saveUser() {
  if (!editingUserId) {
    alert("缺少 editingUserId");
    return;
  }

  const body = {
    name: document.getElementById("editName").value.trim(),
    phone: document.getElementById("editPhone").value.trim(),
    role: document.getElementById("editRole").value,
    status: document.getElementById("editStatus").value,
  };

  console.log("🧪 saveUser start:", {
    editingUserId,
    body,
  });

  if (!body.name || !body.phone) {
    alert("姓名和手机号不能为空");
    return;
  }

  try {
    const res = await fetch(
      `/api/admin/users/${encodeURIComponent(editingUserId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json().catch(() => ({}));
    console.log("🧪 PATCH /api/admin/users result:", {
      status: res.status,
      ok: res.ok,
      data,
    });

    if (!res.ok || !data.success) {
      alert(data.message || "保存失败");
      return;
    }

    // ✅ 如果当前角色被设置成团长，额外调用 make-leader
    if (body.role === "leader") {
      try {
        alert(`准备调用 makeLeader，userId=${editingUserId}`);
        console.log("🧪 about to call makeLeader:", editingUserId);

        const leaderRet = await makeLeader(editingUserId);

        console.log("✅ makeLeader success:", leaderRet);
        alert(
          `makeLeader 返回：pickupPointCreated=${Boolean(
            leaderRet?.pickupPointCreated
          )}，hasDefaultAddress=${Boolean(leaderRet?.hasDefaultAddress)}`
        );
      } catch (err) {
        console.error("makeLeader error:", err);
        alert(`用户已保存，但自动创建团长自提点失败：${err.message || err}`);
      }
    }

    closeEditModal();
    fetchUsers(currentPage);
  } catch (err) {
    console.error("saveUser error:", err);
    alert("请求失败");
  }
}

function closeEditModal() {
  document.getElementById("editModal").classList.remove("open");
  editingUserId = null;
}

/* =========================
   修改密码弹窗（管理员直接设置）
========================= */
function openSetPasswordModal(id) {
  settingPwdUserId = String(id || "");

  document.getElementById("pwdNew1").value = "";
  document.getElementById("pwdNew2").value = "";

  const hint = document.getElementById("pwdHint");
  if (hint) hint.textContent = "";

  document.getElementById("pwdModal").classList.add("open");
}

function closeSetPasswordModal() {
  document.getElementById("pwdModal").classList.remove("open");
  settingPwdUserId = null;
}

async function submitSetPassword() {
  if (!settingPwdUserId) return;

  const p1 = String(document.getElementById("pwdNew1").value || "").trim();
  const p2 = String(document.getElementById("pwdNew2").value || "").trim();

  const hint = document.getElementById("pwdHint");
  if (hint) hint.textContent = "";

  if (p1.length < 6) {
    if (hint) hint.textContent = "密码至少 6 位";
    else alert("密码至少 6 位");
    return;
  }
  if (p1 !== p2) {
    if (hint) hint.textContent = "两次密码不一致";
    else alert("两次密码不一致");
    return;
  }

  try {
    const res = await fetch(
      `/api/admin/users/${encodeURIComponent(settingPwdUserId)}/set-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: p1 }),
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = data.message || "修改密码失败";
      if (hint) hint.textContent = msg;
      else alert(msg);
      return;
    }

    alert("密码已更新");
    closeSetPasswordModal();
  } catch (err) {
    console.error("submitSetPassword error:", err);
    alert("请求失败");
  }
}

/* =========================
   删除用户
========================= */
async function deleteUser(id) {
  if (!id) return alert("缺少用户ID");
  if (!confirm("⚠️ 确认删除该用户？此操作不可恢复")) return;

  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || "删除失败");
      return;
    }

    alert("删除成功");
    fetchUsers(currentPage);
  } catch (err) {
    console.error("deleteUser error:", err);
    alert("请求失败");
  }
}

/* =========================
   创建用户弹窗
========================= */
function openCreateModal() {
  document.getElementById("createName").value = "";
  document.getElementById("createPhone").value = "";
  document.getElementById("createRole").value = "customer";
  document.getElementById("createStatus").value = "active";
  document.getElementById("createPassword").value = "";

  const hint = document.getElementById("createHint");
  if (hint) {
    hint.style.display = "none";
    hint.textContent = "";
  }

  document.getElementById("createModal").classList.add("open");
}

function closeCreateModal() {
  document.getElementById("createModal").classList.remove("open");
}

function normalizePhone10(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

async function makeLeader(userId) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("缺少 userId");

  console.log("🧪 POST /api/admin/leaders/make-leader userId =", id);

  const res = await fetch("/api/admin/leaders/make-leader", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: id }),
  });

  const data = await res.json().catch(() => ({}));

  console.log("🧪 makeLeader API result:", {
    status: res.status,
    ok: res.ok,
    data,
  });

  if (!res.ok || !data.ok) {
    throw new Error(data.message || "设为团长失败");
  }

  return data;
}

async function submitCreateUser() {
  const name = document.getElementById("createName").value.trim();
  const phoneRaw = document.getElementById("createPhone").value.trim();
  const phone = normalizePhone10(phoneRaw);
  const role = document.getElementById("createRole").value;
  const status = document.getElementById("createStatus").value;
  const password = document.getElementById("createPassword").value.trim();

  if (!phone || phone.length !== 10) {
    alert("手机号格式不正确，请输入 10 位手机号");
    return;
  }

  const body = { name, phone, role, status };
  if (password) body.password = password;

  try {
    const btn = document.getElementById("createUserBtn");
    if (btn) btn.disabled = true;

    const res = await fetch(`/api/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      alert(data.message || "创建失败");
      return;
    }

    const createdUserId = String(
      data.userId || data.id || data._id || data.user?._id || ""
    ).trim();

    // ✅ 创建时直接选团长，也调用 makeLeader
    if (role === "leader" && createdUserId) {
      try {
        alert(`创建后准备调用 makeLeader，userId=${createdUserId}`);
        const leaderRet = await makeLeader(createdUserId);
        console.log("✅ makeLeader after create success:", leaderRet);
      } catch (err) {
        console.error("makeLeader after create error:", err);
        alert(`用户已创建，但自动创建团长自提点失败：${err.message || err}`);
      }
    }

    const tempPwd = data.tempPassword || data.password || data.generatedPassword;
    const hint = document.getElementById("createHint");
    if (hint && tempPwd) {
      hint.style.display = "block";
      hint.textContent = `创建成功。系统生成初始密码：${tempPwd}（请及时告知用户并建议修改）`;
    }

    closeCreateModal();
    fetchUsers(1);
  } catch (err) {
    console.error("submitCreateUser error:", err);
    alert("请求失败");
  } finally {
    const btn = document.getElementById("createUserBtn");
    if (btn) btn.disabled = false;
  }
}

/* =========================
   暴露到 window（给 onclick 用）
========================= */
window.openEditModal = openEditModal;
window.openSetPasswordModal = openSetPasswordModal;
window.deleteUser = deleteUser;

/* =========================
   事件绑定
========================= */
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("searchBtn")?.addEventListener("click", () => fetchUsers(1));

  document.getElementById("refreshBtn")?.addEventListener("click", () => fetchUsers(currentPage));

  document.getElementById("saveUserBtn")?.addEventListener("click", saveUser);
  document.getElementById("cancelEditBtn")?.addEventListener("click", closeEditModal);

  document.getElementById("btnCreateUser")?.addEventListener("click", openCreateModal);
  document.getElementById("cancelCreateBtn")?.addEventListener("click", closeCreateModal);
  document.getElementById("createUserBtn")?.addEventListener("click", submitCreateUser);

  document.getElementById("cancelPwdBtn")?.addEventListener("click", closeSetPasswordModal);
  document.getElementById("savePwdBtn")?.addEventListener("click", submitSetPassword);

  fetchUsers(1);
});