// frontend/admin/users.js
console.log("✅ users.js 已加载");

let currentPage = 1;
let totalPages = 1;
let editingUserId = null;

// 拉取用户列表（不需要 token）
async function fetchUsers(page = 1) {
  const keyword = document.getElementById("keyword").value.trim();
  const role = document.getElementById("roleFilter").value;
  const status = document.getElementById("statusFilter").value;

  const params = new URLSearchParams({
    page,
    limit: 20,
  });

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

    // ✅ 兼容后端不同字段名
    currentPage = data.page || page;
    totalPages = data.totalPages ?? data.pages ?? 1;

    // ✅ 兼容 items/users/list/data
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
  tbody.innerHTML = "";

  users.forEach((u) => {
    const tr = document.createElement("tr");

    // ✅ 兼容后端可能返回 _id / id
    const id = String(u.id || u._id || "");

    // ✅ 新增：余额/地址字段兼容
    const wallet = Number(u.walletBalance ?? u.balance ?? u.wallet ?? 0);
    const addrText = String(u.addressText || u.address || "").trim();

    tr.innerHTML = `
      <td>${u.name || "-"}</td>
      <td>${u.phone || "-"}</td>
      <td>${mapRole(u.role)}</td>
      <td>${mapStatus(u.status)}</td>
      <td>${u.totalOrders ?? 0}</td>
      <td>$${Number(u.totalSpent ?? 0).toFixed(2)}</td>

      <!-- ✅ 新增：账户余额 -->
      <td>$${Number(wallet).toFixed(2)}</td>

      <!-- ✅ 新增：地址（长地址省略，hover 可看全） -->
      <td style="max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          title="${addrText.replace(/"/g, "&quot;")}">
        ${addrText ? addrText : "-"}
      </td>

      <td>${u.createdAt ? formatDate(u.createdAt) : "-"}</td>
      <td>
        <!-- ✅ id 必须加引号，避免 ObjectId 字符串导致 JS 语法错误 -->
        <button class="link-btn" onclick="openEditModal('${id}')">编辑</button>
        <button class="link-btn" onclick="resetPassword('${id}')">重置密码</button>

        <!-- ✅ 新增：删除用户 -->
        <button class="link-btn danger" onclick="deleteUser('${id}')">删除</button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// 渲染分页
function renderPagination() {
  const container = document.getElementById("pagination");
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

// 角色显示（加固：大小写、空值）
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

// 状态显示（加固：大小写、空值）
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

// 时间显示（加固：无效时间兜底）
function formatDate(str) {
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

// ===== 编辑弹窗 =====
async function openEditModal(id) {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "获取用户详情失败");
      return;
    }

    const u = data.user || {};
    // ✅ 兼容 id / _id
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
  if (!editingUserId) return;

  const body = {
    name: document.getElementById("editName").value.trim(),
    phone: document.getElementById("editPhone").value.trim(),
    role: document.getElementById("editRole").value,
    status: document.getElementById("editStatus").value,
  };

  if (!body.name || !body.phone) {
    alert("姓名和手机号不能为空");
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(editingUserId)}`, {
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
    editingUserId = null;
    fetchUsers(currentPage);
  } catch (err) {
    console.error("saveUser error:", err);
    alert("请求失败");
  }
}

async function resetPassword(id) {
  if (!confirm("确认要重置该用户密码吗？")) return;

  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: "POST",
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "重置失败");
      return;
    }
    alert(`已重置，新密码为：${data.tempPassword}`);
  } catch (err) {
    console.error("resetPassword error:", err);
    alert("请求失败");
  }
}

function closeEditModal() {
  document.getElementById("editModal").classList.remove("open");
  editingUserId = null;
}

// ✅✅ 新增：删除用户
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

// 挂到 window
window.openEditModal = openEditModal;
window.resetPassword = resetPassword;
window.deleteUser = deleteUser;

// 事件绑定
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("searchBtn")?.addEventListener("click", () => fetchUsers(1));
  document.getElementById("saveUserBtn")?.addEventListener("click", saveUser);
  document.getElementById("cancelEditBtn")?.addEventListener("click", closeEditModal);

  // ✅ 创建用户：打开弹窗
  document.getElementById("btnCreateUser")?.addEventListener("click", openCreateModal);

  // ✅ 创建弹窗：取消/关闭
  document.getElementById("cancelCreateBtn")?.addEventListener("click", closeCreateModal);
  document.getElementById("cancelCreateBtn2")?.addEventListener("click", closeCreateModal);

  // ✅ 创建弹窗：提交创建
  document.getElementById("createUserBtn")?.addEventListener("click", submitCreateUser);

  fetchUsers(1);
});

// ===== 创建用户弹窗 =====
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

    const data = await res.json();

    if (!res.ok || !data.success) {
      alert(data.message || "创建失败");
      return;
    }

    // ✅ 有些后端会返回临时密码（如果你选择系统生成）
    const tempPwd = data.tempPassword || data.password || data.generatedPassword;

    const hint = document.getElementById("createHint");
    if (hint && tempPwd) {
      hint.style.display = "block";
      hint.textContent = `创建成功。系统生成初始密码：${tempPwd}（请及时告知用户并建议修改）`;
    }

    // 关闭弹窗（如果你想让管理员先看密码，就注释掉下一行）
    closeCreateModal();

    // 刷新列表：回到第一页更直观
    fetchUsers(1);
  } catch (err) {
    console.error("submitCreateUser error:", err);
    alert("请求失败");
  } finally {
    const btn = document.getElementById("createUserBtn");
    if (btn) btn.disabled = false;
  }
}
