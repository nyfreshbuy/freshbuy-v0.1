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
    try {
      data = await res.json();
    } catch {}
    return { res, data };
  }

  async function loadCompanyHeader() {
    try {
      const res = await fetch("/admin/components/company_header.html", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      const el = document.getElementById("companyHeader");
      if (el) el.innerHTML = html;
    } catch (e) {
      console.warn("company_header.html 加载失败：", e);
    }
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  function money(n) {
    const x = Number(n || 0);
    return "$" + (Number.isFinite(x) ? x.toFixed(2) : "0.00");
  }

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const hint = document.getElementById("hint");
  const root = document.getElementById("root");
  const btnPrint = document.getElementById("btnPrint");
  const btnClose = document.getElementById("btnClose");

  if (btnPrint) {
    btnPrint.onclick = () => window.print();
  }

  if (btnClose) {
    btnClose.onclick = () => (history.length > 1 ? history.back() : window.close());
  }

  (async function init() {
    const id = qs("id");

    if (!id) {
      root.textContent = "缺少参数：id";
      return;
    }

    hint.textContent = "⏳ 正在加载发票…";

    const { res, data } = await apiGet(`/api/admin/invoices/${encodeURIComponent(id)}`);

    if (!res.ok || !data?.success) {
      root.textContent = "加载失败：" + (data?.message || res.status);
      hint.textContent = "❌";
      return;
    }

    const inv = data.invoice || data.data || {};
    const items = Array.isArray(inv.items) ? inv.items : [];

    const invoiceNo = esc(inv.invoiceNo || "");
    const invoiceDate = esc((inv.date || inv.createdAt || "").toString().slice(0, 10));

    document.title = invoiceNo ? `Invoice ${invoiceNo}` : "Invoice Print";

    const soldToName = esc(inv.soldTo?.name || "");
    const soldToPhone = esc(inv.soldTo?.phone || "");
    const soldToAddress = esc(inv.soldTo?.address || "");

    const shipToName = esc(inv.shipTo?.name || "");
    const shipToPhone = esc(inv.shipTo?.phone || "");
    const shipToAddress = esc(inv.shipTo?.address || "");

    const subtotal = Number(inv.subtotal ?? inv.total ?? 0);
    const total = Number(inv.total ?? inv.grandTotal ?? inv.subtotal ?? 0);

    root.innerHTML = `
      <div id="companyHeader"></div>

      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-top:8px;">
        <div>
          <div style="font-size:18px;font-weight:700;">Invoice / 发票</div>
          <div class="muted">No: ${invoiceNo}</div>
          <div class="muted">Date: ${invoiceDate}</div>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;" />

      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:240px;">
          <div style="font-weight:700;margin-bottom:6px;">Sold To</div>
          <div>${soldToName}</div>
          <div>${soldToPhone}</div>
          <div class="muted" style="white-space:pre-wrap;">${soldToAddress}</div>
        </div>

        <div style="flex:1;min-width:240px;">
          <div style="font-weight:700;margin-bottom:6px;">Ship To</div>
          <div>${shipToName}</div>
          <div>${shipToPhone}</div>
          <div class="muted" style="white-space:pre-wrap;">${shipToAddress}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th style="width:70px;">Qty</th>
            <th style="width:90px;">Price</th>
            <th style="width:100px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${
            items.length
              ? items
                  .map((it) => {
                    const qty = Number(it.qty || 0);
                    const unitPrice = Number(it.unitPrice || 0);
                    const line = Math.round(qty * unitPrice * 100) / 100;

                    const baseDesc = (it.description || "").toString();
                    const vlab = (it.variantLabel || "").toString().trim();
                    const showDesc = vlab ? `${baseDesc} (${vlab})` : baseDesc;

                    return `
                      <tr>
                        <td>${esc(showDesc)}</td>
                        <td>${qty}</td>
                        <td>${money(unitPrice)}</td>
                        <td>${money(line)}</td>
                      </tr>
                    `;
                  })
                  .join("")
              : `
                <tr>
                  <td colspan="4" class="muted" style="text-align:center;padding:20px 8px;">
                    暂无商品明细
                  </td>
                </tr>
              `
          }
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <div style="min-width:260px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span>Subtotal</span>
            <b>${money(subtotal)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:18px;">
            <span>Total</span>
            <b>${money(total)}</b>
          </div>
        </div>
      </div>
    `;

    await loadCompanyHeader();
    hint.textContent = "✅ 可打印";
  })();
})();