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

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

function safeText(v, fallback = "-") {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

function renderStatusTag(status, enabled) {
  const s = String(status || "").toLowerCase();

  if (enabled === false || s === "disabled") {
    return `<span class="admin-tag admin-tag-danger">停用</span>`;
  }

  if (s === "pending") {
    return `<span class="admin-tag admin-tag-warning">待审核</span>`;
  }

  return `<span class="admin-tag admin-tag-success">启用</span>`;
}

function renderTable(items) {
  const tbody = document.getElementById("pickupTableBody");
  if (!tbody) return;

  if (!Array.isArray(items) || !items.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:20px;color:#999;">暂无自提点</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map((p, idx) => {
    const pickupId = safeText(p.pickupId || p.code || `PUP-${String(idx + 1).padStart(3, "0")}`);
    const leaderName = safeText(p.leaderName || p.contactName);
    const address = safeText(
      p.address ||
      p.maskedAddress ||
      p.fullAddress ||
      [p.addressLine1, p.addressLine2, p.city, p.state, p.zip].filter(Boolean).join(", ")
    );
    const timeText = safeText(p.pickupTimeText);
    const weeklyOrders = safeText(p.weeklyOrders || 0);

    return `
      <tr>
        <td>${pickupId}</td>
        <td>${safeText(p.name)}</td>
        <td>${leaderName}</td>
        <td>${address}</td>
        <td>${timeText}</td>
        <td>${weeklyOrders}</td>
        <td>${renderStatusTag(p.status, p.enabled)}</td>
      </tr>
    `;
  }).join("");
}

function renderSummary(items, summary = {}) {
  const totalEl = document.getElementById("pickupTotalCount");
  const totalSubEl = document.getElementById("pickupTotalSub");
  const activeEl = document.getElementById("pickupActiveCount");
  const latestNameEl = document.getElementById("pickupLatestName");
  const latestSubEl = document.getElementById("pickupLatestSub");
  const pendingEl = document.getElementById("pickupPendingCount");

  const list = Array.isArray(items) ? items : [];
  const total = Number(summary.total || list.length || 0);
  const active = Number(
    summary.active ||
    list.filter((x) => x.enabled !== false && String(x.status || "active") === "active").length
  );
  const pending = Number(
    summary.pending ||
    list.filter((x) => String(x.status || "") === "pending").length
  );

  const latest = list[0] || null;

  if (totalEl) totalEl.innerText = String(total);
  if (activeEl) activeEl.innerText = String(active);
  if (pendingEl) pendingEl.innerText = String(pending);

  if (totalSubEl) {
    const cities = [...new Set(list.map(x => x.city).filter(Boolean))].slice(0, 3);
    totalSubEl.innerText = cities.length ? cities.join(" / ") + (list.length > 3 ? " 等" : "") : "当前系统自提点";
  }

  if (latestNameEl) latestNameEl.innerText = latest ? safeText(latest.name) : "-";
  if (latestSubEl) latestSubEl.innerText = latest ? `ZIP ${safeText(latest.zip, "-")}` : "暂无数据";
}

async function loadPickupsPage() {
  const tbody = document.getElementById("pickupTableBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:20px;color:#999;">加载中...</td>
      </tr>
    `;
  }

  const result = await api("/api/admin/pickups");
  const data = result.data;

  if (!result.ok || !data?.success) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:20px;color:#999;">加载失败</td>
        </tr>
      `;
    }
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  renderSummary(items, data.summary || {});
  renderTable(items);
}

document.addEventListener("DOMContentLoaded", loadPickupsPage);