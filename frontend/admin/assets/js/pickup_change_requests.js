function getAdminToken() {
  return (
    localStorage.getItem("freshbuy_admin_token") ||
    localStorage.getItem("freshbuy_token") ||
    ""
  );
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + getAdminToken()
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  return await res.json();
}

async function loadRequests() {
  const box = document.getElementById("requestList");
  if (!box) return;

  box.innerHTML = "加载中...";

  try {
    const data = await api("/api/admin/pickups/change-requests");

    if (!data?.success || !Array.isArray(data.items)) {
      box.innerHTML = "加载失败";
      return;
    }

    if (!data.items.length) {
      box.innerHTML = "暂无审核记录";
      return;
    }

    box.innerHTML = data.items.map((r) => `
      <div style="border:1px solid #ddd;padding:12px;border-radius:8px;margin-bottom:12px;background:#fff;">
        <div><b>${r.submittedData?.name || "-"}</b></div>
        <div>类型：${r.requestType === "edit" ? "修改" : "新增"}</div>
        <div>团长：${r.leaderUser?.name || r.leaderUser?.phone || "-"}</div>
        <div>联系人：${r.submittedData?.contactName || "-"}</div>
        <div>电话：${r.submittedData?.contactPhone || "-"}</div>
        <div>地址：${r.submittedData?.fullAddress || "-"}</div>
        <div>营业时间：${r.submittedData?.pickupTimeText || "-"}</div>
        <div>状态：${r.status || "-"}</div>
        <div>团长备注：${r.leaderRemark || "-"}</div>
        <div>管理员备注：${r.adminRemark || "-"}</div>
        ${
          r.status === "pending"
            ? `<div style="margin-top:10px;">
                 <button onclick="approveRequest('${r._id}')">通过</button>
                 <button onclick="rejectRequest('${r._id}')">拒绝</button>
               </div>`
            : ""
        }
      </div>
    `).join("");
  } catch (e) {
    console.error("loadRequests error:", e);
    box.innerHTML = "加载失败";
  }
}

async function approveRequest(id) {
  const adminRemark = prompt("审核备注（可留空）", "") || "";
  const data = await api(`/api/admin/pickups/change-requests/${id}/approve`, {
    method: "POST",
    body: { adminRemark }
  });

  alert(data?.message || "操作完成");
  loadRequests();
}

async function rejectRequest(id) {
  const adminRemark = prompt("拒绝原因", "") || "";
  const data = await api(`/api/admin/pickups/change-requests/${id}/reject`, {
    method: "POST",
    body: { adminRemark }
  });

  alert(data?.message || "操作完成");
  loadRequests();
}

document.addEventListener("DOMContentLoaded", loadRequests);