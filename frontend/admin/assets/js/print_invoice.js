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
const LOGO_URL = "/admin/assets/images/invoice_logo.png"; // ✅ 你的logo路径
const SITE_URL = "www.freshbuy.com";                      // ✅ 你的网站
  const hint = document.getElementById("hint");
  const root = document.getElementById("root");
  const btnPrint = document.getElementById("btnPrint");
  const btnClose = document.getElementById("btnClose");

  if (btnPrint) btnPrint.onclick = () => window.print();
  if (btnClose) btnClose.onclick = () => history.length > 1 ? history.back() : window.close();

  (async function init() {
    const id = qs("id");
    if (!id) {
      root.textContent = "缺少参数：id";
      return;
    }

    hint.textContent = "⏳ 正在加载发票…";

    const { res, data } = await apiGet(`/api/admin/invoices/${id}`);
    if (!res.ok || !data?.success) {
      root.textContent = "加载失败：" + (data?.message || res.status);
      hint.textContent = "❌";
      return;
    }

    const inv = data.invoice || data.data || {};
    const items = Array.isArray(inv.items) ? inv.items : [];

    document.title = inv.invoiceNo ? `Invoice ${inv.invoiceNo}` : "Invoice Print";

    // 简洁打印排版（你要更像正式发票我也能再美化）
    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
  <div>
    <div style="font-size:18px;font-weight:700;">Invoice / 发票</div>
    <div class="muted">No: ${inv.invoiceNo || ""}</div>
    <div class="muted">Date: ${(inv.date || "").slice(0,10)}</div>
  </div>

  <div style="text-align:right;min-width:220px;">
    <div style="font-size:26px;font-weight:900;line-height:1.1;">在鲜购商城</div>
    <div style="font-size:14px;font-weight:700;margin-top:4px;">Margarita Market Inc</div>
    <div class="muted" style="margin-top:2px;">${SITE_URL}</div>
    <div style="margin-top:8px;">
      <img src="${LOGO_URL}" alt="logo" style="height:52px;object-fit:contain;" />
    </div>
  </div>
</div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;" />

      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:240px;">
          <div style="font-weight:700;margin-bottom:6px;">Sold To</div>
          <div>${inv.soldTo?.name || ""}</div>
          <div>${inv.soldTo?.phone || ""}</div>
          <div class="muted" style="white-space:pre-wrap;">${inv.soldTo?.address || ""}</div>
        </div>
        <div style="flex:1;min-width:240px;">
          <div style="font-weight:700;margin-bottom:6px;">Ship To</div>
          <div>${inv.shipTo?.name || ""}</div>
          <div>${inv.shipTo?.phone || ""}</div>
          <div class="muted" style="white-space:pre-wrap;">${inv.shipTo?.address || ""}</div>
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
          ${items.map(it => {
  const qty = Number(it.qty || 0);
  const unitPrice = Number(it.unitPrice || 0);
  const line = Math.round(qty * unitPrice * 100)/100;

  // ✅ 规格显示：description + (variantLabel)
  const baseDesc = (it.description || "").toString();
  const vlab = (it.variantLabel || "").toString().trim();
  const showDesc = vlab ? `${baseDesc} (${vlab})` : baseDesc;

  return `
    <tr>
      <td>${showDesc}</td>
      <td>${qty}</td>
      <td>${money(unitPrice)}</td>
      <td>${money(line)}</td>
    </tr>`;
}).join("")}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <div style="min-width:260px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span>Subtotal</span><b>${money(inv.subtotal ?? inv.total ?? 0)}</b>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:18px;">
            <span>Total</span><b>${money(inv.total ?? inv.grandTotal ?? inv.subtotal ?? 0)}</b>
          </div>
        </div>
      </div>
    `;

    hint.textContent = "✅ 可打印";
  })();
})();