(function () {
  const API_URL = "/api/admin/leaders";

  const els = {
    tbody: document.getElementById("leadersTableBody"),
    leaderCount: document.getElementById("leaderCount"),
    leaderGmv: document.getElementById("leaderGmv"),
    leaderPendingCommission: document.getElementById("leaderPendingCommission"),
    leaderActiveCount: document.getElementById("leaderActiveCount"),
    paginationText: document.getElementById("leadersPaginationText"),
  };

  function getToken() {
    return (
      localStorage.getItem("freshbuy_token") ||
      localStorage.getItem("token") ||
      localStorage.getItem("admin_token") ||
      ""
    );
  }

  function fmtMoney(v) {
    const n = Number(v || 0);
    return `$${n.toFixed(2)}`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function maskPhone(phone) {
    const s = String(phone || "").replace(/\s+/g, "");
    if (!s) return "-";
    if (s.length <= 4) return s;
    return `${s.slice(0, 4)}***${s.slice(-4)}`;
  }

  function renderRows(items) {
    if (!els.tbody) return;

    if (!Array.isArray(items) || !items.length) {
      els.tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center; padding:24px; color:#9ca3af;">
            暂无真实团长数据
          </td>
        </tr>
      `;
      return;
    }

    els.tbody.innerHTML = items
      .map((it) => {
        const statusText = it.status || "正常";
        const statusClass =
          statusText === "待结算"
            ? "admin-tag-warning"
            : statusText === "冻结" || statusText === "停用"
            ? "admin-tag-danger"
            : "admin-tag-success";

        return `
          <tr>
            <td>${escapeHtml(it.leaderId || "-")}</td>
            <td>${escapeHtml(it.leaderName || "-")}</td>
            <td>${escapeHtml(maskPhone(it.phone || ""))}</td>
            <td>${escapeHtml(it.pickupName || "-")}</td>
            <td>${Number(it.totalOrders || 0)}</td>
            <td>${fmtMoney(it.totalGmv || 0)}</td>
            <td>${escapeHtml(String(it.commissionRate ?? 0))}%</td>
            <td>${fmtMoney(it.withdrawable || 0)}</td>
            <td><span class="admin-tag ${statusClass}">${escapeHtml(statusText)}</span></td>
            <td>
              <button class="admin-btn admin-btn-ghost" data-user-id="${escapeHtml(it.userId || "")}">
                明细
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderSummary(summary) {
    if (els.leaderCount) {
      els.leaderCount.textContent = Number(summary.totalLeaders || 0);
    }
    if (els.leaderGmv) {
      els.leaderGmv.textContent = fmtMoney(summary.totalGmv || 0);
    }
    if (els.leaderPendingCommission) {
      els.leaderPendingCommission.textContent = fmtMoney(summary.pendingCommission || 0);
    }
    if (els.leaderActiveCount) {
      els.leaderActiveCount.textContent = Number(summary.activeLeaders || 0);
    }
    if (els.paginationText) {
      els.paginationText.textContent = `共 ${Number(summary.totalLeaders || 0)} 位团长`;
    }
  }

  async function fetchLeaders() {
    const token = getToken();

    const res = await fetch(API_URL, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || `加载团长失败（${res.status}）`);
    }

    return data;
  }

  async function init() {
    try {
      const data = await fetchLeaders();
      renderSummary(data.summary || {});
      renderRows(data.items || []);
    } catch (err) {
      console.error("admin_leaders init error:", err);
      if (els.tbody) {
        els.tbody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align:center; padding:24px; color:#ef4444;">
              ${escapeHtml(err.message || "加载团长失败")}
            </td>
          </tr>
        `;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();