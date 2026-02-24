(function () {
  function getAdminToken() {
    return (
      localStorage.getItem("freshbuy_admin_token") ||
      localStorage.getItem("freshbuy_token") ||
      localStorage.getItem("admin_token") ||
      localStorage.getItem("token") ||
      localStorage.getItem("jwt") ||
      ""
    );
  }

  async function apiGet(url) {
    const headers = {};
    const tk = getAdminToken();
    if (tk) headers.Authorization = "Bearer " + tk;

    const res = await fetch(url, { headers });
    let data = null;
    try { data = await res.json(); } catch {}
    return { res, data };
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  function money(n) {
    const x = Number(n || 0);
    return "$" + (Number.isFinite(x) ? x.toFixed(2) : "0.00");
  }

  const hint = document.getElementById("hint");
  const root = document.getElementById("root");
  const btnPrint = document.getElementById("btnPrint");
  const btnClose = document.getElementById("btnClose");

  if (btnPrint) btnPrint.onclick = () => window.print();
  if (btnClose) btnClose.onclick = () => history.length > 1 ? history.back() : window.close();

  (async function init() {
    const from = qs("from");
    const to = qs("to");
    const userId = qs("userId");

    if (!from || !to) {
      root.textContent = "缺少参数：from / to";
      return;
    }

    hint.textContent = "⏳ 正在加载 Statement…";

    const q = new URLSearchParams();
    q.set("from", from);
    q.set("to", to);
    if (userId) q.set("userId", userId);

    const { res, data } = await apiGet(`/api/admin/invoices/statements?${q.toString()}`);
    if (!res.ok || !data?.success) {
      root.textContent = "加载失败：" + (data?.message || res.status);
      hint.textContent = "❌";
      return;
    }

    const list = data.invoices || data.list || data.items || [];
    const total = data.total ?? list.reduce((s, x) => s + Number(x.total || x.amount || x.grandTotal || 0), 0);

    document.title = `Statement ${from} ~ ${to}`;

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:18px;font-weight:700;">Statement / 对账单</div>
          <div class="muted">From: ${from} &nbsp; To: ${to}</div>
          <div class="muted">UserId: ${userId || "ALL"}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:600;">Margarita Market</div>
          <div class="muted">Admin Print View</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:130px;">Date</th>
            <th style="width:160px;">Invoice No</th>
            <th>Sold To</th>
            <th style="width:120px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(x => {
            const d = (x.date || x.createdAt || "").toString().slice(0,10);
            const no = x.invoiceNo || x.no || "";
            const name = x.soldTo?.name || x.customerName || "";
            const t = Number(x.total || x.amount || x.grandTotal || 0);
            return `
              <tr>
                <td>${d}</td>
                <td>${no}</td>
                <td>${name}</td>
                <td>${money(t)}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>

      <div class="totals">
        <div class="box">
          <div class="line"><span>Count</span><b>${data.count ?? list.length}</b></div>
          <div class="line grand"><span>Total</span><b>${money(total)}</b></div>
        </div>
      </div>
    `;

    hint.textContent = "✅ 可打印";
  })();
})();