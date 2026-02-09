// frontend/admin/assets/js/admin_invoices.js
// ✅ 发票开具（后台）完整前端脚本
// - 选用户自动带出 name/phone/address
// - 选商品/规格（variants）自动填描述/价格，并携带 unitCount（扣库存用，打印不显示）
// - 保存：POST /api/admin/invoices（后端扣库存）
// - 打印：GET /api/admin/invoices/:id/pdf（✅ 用 fetch+token+blob 打开，避免缺少 token）
// - Statement：
//    JSON: GET /api/admin/invoices/statements?from&to&userId
//    PDF : GET /api/admin/invoices/statements/pdf?from&to&userId（✅ 用 fetch+token+blob 打开）
// - 搜索发票：GET /api/admin/invoices?q&from&to&userId（后端需支持这些 query）

(function () {
  // =========================
  // Auth / Fetch helpers
  // =========================
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

  async function apiFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (!headers["Content-Type"] && options.body && typeof options.body === "string") {
      headers["Content-Type"] = "application/json";
    }

    const tk = getAdminToken();
    if (tk) headers.Authorization = "Bearer " + tk;

    const res = await fetch(url, { ...options, headers });

    let data = null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }
    return { res, data };
  }

  async function authedDownloadOpen(url) {
    const tk = getAdminToken();
    if (!tk) {
      alert("未登录：没有 token，请重新登录后台。");
      return;
    }

    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + tk },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      alert("打开失败：" + (txt || res.status));
      return;
    }

    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    window.open(objUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
  }

  // =========================
  // DOM
  // =========================
  const hint = document.getElementById("hint");

  const btnNew = document.getElementById("btnNew");
  const btnSave = document.getElementById("btnSave");
  const btnPrint = document.getElementById("btnPrint");

  const invDate = document.getElementById("invDate");
  const invNo = document.getElementById("invNo");
  const accountNo = document.getElementById("accountNo");
  const salesRep = document.getElementById("salesRep");
  const terms = document.getElementById("terms");

  const userSelect = document.getElementById("userSelect");
  const soldName = document.getElementById("soldName");
  const soldPhone = document.getElementById("soldPhone");
  const soldAddr = document.getElementById("soldAddr");

  const sameAsSold = document.getElementById("sameAsSold");
  const shipName = document.getElementById("shipName");
  const shipPhone = document.getElementById("shipPhone");
  const shipAddr = document.getElementById("shipAddr");

  const itemsTbody = document.getElementById("itemsTbody");
  const btnAddRow = document.getElementById("btnAddRow");
  const subTotalEl = document.getElementById("subTotal");
  const grandTotalEl = document.getElementById("grandTotal");

  const stFrom = document.getElementById("stFrom");
  const stTo = document.getElementById("stTo");
  const stUserId = document.getElementById("stUserId");
  const btnStatement = document.getElementById("btnStatement");
  const btnStatementPdf = document.getElementById("btnStatementPdf"); // ✅ 新增
  const stResult = document.getElementById("stResult");

  // ✅ 搜索区（可选：只有你的 invoices.html 有这些 id 才生效）
  const sQ = document.getElementById("sQ");
  const sFrom = document.getElementById("sFrom");
  const sTo = document.getElementById("sTo");
  const sUserId = document.getElementById("sUserId");
  const btnSearch = document.getElementById("btnSearch");
  const btnSearchReset = document.getElementById("btnSearchReset");
  const searchHint = document.getElementById("searchHint");
  const searchList = document.getElementById("searchList");

  // =========================
  // State
  // =========================
  let users = [];
  let products = [];
  let productMap = new Map(); // _id -> product
  let currentInvoiceId = "";  // 保存后返回 _id

  // =========================
  // Date helpers
  // =========================
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateInputValue(d) {
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
  }

  function todayLocalInput() {
    return toDateInputValue(new Date());
  }

  // invoiceNo: YYYYMMDD-001（前端先生成预览；最终以后台返回为准）
  function genInvoiceNoPreview(dateStr) {
    const s = String(dateStr || "").replaceAll("-", "");
    if (!/^\d{8}$/.test(s)) return "";
    return `${s}-001`;
  }

  // =========================
  // UI helpers
  // =========================
  function setHint(msg) {
    if (!hint) return;
    hint.textContent = msg || "";
  }

  function money(n) {
    const x = Number(n || 0);
    if (!Number.isFinite(x)) return "$0.00";
    return `$${x.toFixed(2)}`;
  }

  function parseNum(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  function setShipDisabled(disabled) {
    shipName.disabled = disabled;
    shipPhone.disabled = disabled;
    shipAddr.disabled = disabled;
  }

  function syncShipFromSold() {
    if (!sameAsSold.checked) return;
    shipName.value = soldName.value || "";
    shipPhone.value = soldPhone.value || "";
    shipAddr.value = soldAddr.value || "";
  }

  // =========================
  // Load users
  // =========================
  function normalizeUserFromApi(u) {
    return {
      _id: u?._id || u?.id || "",
      name: u?.name || "",
      phone: u?.phone || "",
      addressText: u?.addressText || u?.address || "",
    };
  }

  function renderUserSelect() {
    if (!userSelect) return;
    userSelect.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "（不选用户，手动填写）";
    userSelect.appendChild(opt0);

    for (const u of users) {
      const opt = document.createElement("option");
      opt.value = u._id;
      const label = `${u.name || ""} ${u.phone || ""}`.trim() || u._id;
      opt.textContent = label;

      opt.dataset.name = u.name || "";
      opt.dataset.phone = u.phone || "";
      opt.dataset.addr = u.addressText || "";

      userSelect.appendChild(opt);
    }
  }

  async function loadUsers(keyword = "") {
    const qs = new URLSearchParams();
    qs.set("page", "1");
    qs.set("pageSize", "80");
    if (keyword) qs.set("keyword", keyword);

    const { res, data } = await apiFetch(`/api/admin/users?${qs.toString()}`);

    if (!res.ok || !data?.success) {
      setHint("❌ 拉取用户失败：" + (data?.message || res.status));
      users = [];
      renderUserSelect();
      return;
    }

    const list = data.users || data.list || data.items || data.data || [];
    users = Array.isArray(list) ? list.map(normalizeUserFromApi) : [];
    renderUserSelect();
  }

  // =========================
  // Load products
  // =========================
  function normalizeProductFromApi(p) {
    const vars = Array.isArray(p?.variants) ? p.variants : [];
    const variants = vars
      .map((v) => ({
        key: String(v?.key || "").trim(),
        label: String(v?.label || "").trim(),
        unitCount: Math.max(1, Math.floor(parseNum(v?.unitCount, 1))),
        price: v?.price === null || v?.price === undefined ? null : parseNum(v?.price, null),
        enabled: v?.enabled !== false,
        sortOrder: parseNum(v?.sortOrder, 0),
      }))
      .filter((v) => v.key);

    return {
      _id: String(p?._id || p?.id || ""),
      name: p?.name || "",
      sku: p?.sku || "",
      price: parseNum(p?.price, 0),
      originPrice: parseNum(p?.originPrice, 0),
      taxable: !!p?.taxable,
      deposit: parseNum(p?.deposit, 0),
      stock: parseNum(p?.stock, 0),
      variants,
    };
  }

  async function loadProducts(keyword = "") {
    const qs = new URLSearchParams();
    if (keyword) qs.set("keyword", keyword);

    const { res, data } = await apiFetch(`/api/admin/products?${qs.toString()}`);

    if (!res.ok || !data?.success) {
      setHint("❌ 拉取商品失败：" + (data?.message || res.status));
      products = [];
      productMap = new Map();
      return;
    }

    const list = data.list || data.products || data.items || data.data || [];
    products = Array.isArray(list) ? list.map(normalizeProductFromApi) : [];

    productMap = new Map();
    for (const p of products) productMap.set(String(p._id), p);
  }

  function getProduct(id) {
    return productMap.get(String(id)) || null;
  }

  // =========================
  // Items table
  // =========================
  function recalcTotals() {
    let sub = 0;
    if (!itemsTbody) return;

    const trs = itemsTbody.querySelectorAll("tr");
    for (const tr of trs) {
      const qty = parseNum(tr.querySelector('[data-k="qty"]')?.value, 0);
      const unitPrice = parseNum(tr.querySelector('[data-k="unitPrice"]')?.value, 0);
      const line = Math.round(qty * unitPrice * 100) / 100;

      const lineEl = tr.querySelector('[data-k="lineTotal"]');
      if (lineEl) lineEl.textContent = money(line);

      sub += line;
    }

    sub = Math.round(sub * 100) / 100;
    if (subTotalEl) subTotalEl.textContent = money(sub);
    if (grandTotalEl) grandTotalEl.textContent = money(sub);
  }

  function makeProductSelect() {
    const sel = document.createElement("select");
    sel.dataset.k = "productId";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "（手填 / 不扣库存）";
    sel.appendChild(opt0);

    for (const p of products) {
      const opt = document.createElement("option");
      opt.value = p._id;
      opt.textContent = p.name || p._id;
      sel.appendChild(opt);
    }
    return sel;
  }

  function makeVariantSelect(product) {
    const sel = document.createElement("select");
    sel.dataset.k = "variantKey";

    const vars =
      product && Array.isArray(product.variants) && product.variants.length
        ? product.variants
        : [{ key: "single", label: "单个", unitCount: 1, price: null, enabled: true, sortOrder: 0 }];

    const sorted = [...vars].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    for (const v of sorted) {
      if (!v || !v.key) continue;
      if (v.enabled === false) continue;

      const opt = document.createElement("option");
      opt.value = v.key;
      opt.textContent = v.label || v.key;
      opt.dataset.unitCount = String(v.unitCount || 1);
      opt.dataset.variantPrice = v.price == null ? "" : String(v.price);
      sel.appendChild(opt);
    }
    return sel;
  }

  function addRow(preset = {}) {
    if (!itemsTbody) return;
    const tr = document.createElement("tr");

    // 商品
    const tdP = document.createElement("td");
    const selP = makeProductSelect();
    selP.value = preset.productId || "";
    tdP.appendChild(selP);
    tr.appendChild(tdP);

    // 规格
    const tdV = document.createElement("td");
    tdV.dataset.k = "variantCell";
    tr.appendChild(tdV);

    // Description
    const tdD = document.createElement("td");
    const inpDesc = document.createElement("input");
    inpDesc.dataset.k = "description";
    inpDesc.placeholder = "可手填";
    inpDesc.value = preset.description || "";
    tdD.appendChild(inpDesc);
    tr.appendChild(tdD);

    // Qty
    const tdQ = document.createElement("td");
    const inpQty = document.createElement("input");
    inpQty.type = "number";
    inpQty.step = "1";
    inpQty.min = "0";
    inpQty.dataset.k = "qty";
    inpQty.value = preset.qty != null ? String(preset.qty) : "1";
    tdQ.appendChild(inpQty);
    tr.appendChild(tdQ);

    // Unit Price
    const tdU = document.createElement("td");
    const inpPrice = document.createElement("input");
    inpPrice.type = "number";
    inpPrice.step = "0.01";
    inpPrice.min = "0";
    inpPrice.dataset.k = "unitPrice";
    inpPrice.value = preset.unitPrice != null ? String(preset.unitPrice) : "0";
    tdU.appendChild(inpPrice);
    tr.appendChild(tdU);

    // Total
    const tdT = document.createElement("td");
    const lineEl = document.createElement("div");
    lineEl.dataset.k = "lineTotal";
    lineEl.textContent = "$0.00";
    tdT.appendChild(lineEl);
    tr.appendChild(tdT);

    // 删除
    const tdX = document.createElement("td");
    const btnDel = document.createElement("button");
    btnDel.className = "btn btn-danger";
    btnDel.textContent = "删";
    btnDel.onclick = () => {
      tr.remove();
      recalcTotals();
    };
    tdX.appendChild(btnDel);
    tr.appendChild(tdX);

    function refreshVariantUI(productId) {
      tdV.innerHTML = "";
      const p = productId ? getProduct(productId) : null;

      if (!p) {
        const dummy = document.createElement("select");
        dummy.dataset.k = "variantKey";
        const o = document.createElement("option");
        o.value = "";
        o.textContent = "-";
        dummy.appendChild(o);
        tdV.appendChild(dummy);
        return dummy;
      }

      const vs = makeVariantSelect(p);
      tdV.appendChild(vs);

      if (preset.variantKey) vs.value = preset.variantKey;
      return vs;
    }

    function autofillByProductAndVariant() {
      const pid = selP.value;
      const p = pid ? getProduct(pid) : null;
      const varSel = tdV.querySelector('select[data-k="variantKey"]');

      if (!p) {
        recalcTotals();
        return;
      }

      if (!inpDesc.value) inpDesc.value = p.name || "";

      if (varSel && varSel.selectedOptions && varSel.selectedOptions[0]) {
        const opt = varSel.selectedOptions[0];
        const vp = opt.dataset.variantPrice;
        const auto = vp !== "" ? parseNum(vp, p.price) : p.price;

        if (!inpPrice.value || parseNum(inpPrice.value, 0) === 0) {
          inpPrice.value = String(auto || 0);
        }
      } else {
        if (!inpPrice.value || parseNum(inpPrice.value, 0) === 0) {
          inpPrice.value = String(p.price || 0);
        }
      }

      recalcTotals();
    }

    selP.onchange = () => {
      const varSel = refreshVariantUI(selP.value);
      if (varSel) varSel.onchange = autofillByProductAndVariant;
      autofillByProductAndVariant();
    };

    inpQty.oninput = recalcTotals;
    inpPrice.oninput = recalcTotals;

    const initialVarSel = refreshVariantUI(selP.value);
    if (initialVarSel) initialVarSel.onchange = autofillByProductAndVariant;

    itemsTbody.appendChild(tr);
    autofillByProductAndVariant();
    recalcTotals();
  }

  function collectItemsPayload() {
    const items = [];
    if (!itemsTbody) return items;

    const trs = itemsTbody.querySelectorAll("tr");
    for (const tr of trs) {
      const productId = tr.querySelector('[data-k="productId"]')?.value || "";
      const variantKey = tr.querySelector('[data-k="variantKey"]')?.value || "";
      const description = tr.querySelector('[data-k="description"]')?.value || "";
      const qty = parseNum(tr.querySelector('[data-k="qty"]')?.value, 0);
      const unitPrice = parseNum(tr.querySelector('[data-k="unitPrice"]')?.value, 0);

      let unitCount = 1;
      const varSel = tr.querySelector('select[data-k="variantKey"]');
      if (varSel && varSel.selectedOptions && varSel.selectedOptions[0]) {
        unitCount = Math.max(1, Math.floor(parseNum(varSel.selectedOptions[0].dataset.unitCount, 1)));
      }

      if (!productId && !description) continue;
      if (!qty || qty <= 0) continue;

      items.push({
        productId: productId || "",
        variantKey: variantKey || "",
        description: String(description || "").trim(),
        qty,
        unitPrice,
        unitCount,
      });
    }

    return items;
  }

  // =========================
  // Build payload
  // =========================
  function buildInvoicePayload() {
    const dateStr = invDate.value || todayLocalInput();

    const soldTo = {
      userId: userSelect.value || "",
      name: (soldName.value || "").trim(),
      phone: (soldPhone.value || "").trim(),
      address: (soldAddr.value || "").trim(),
    };

    const shipToSame = !!sameAsSold.checked;

    const shipTo = {
      userId: shipToSame ? (soldTo.userId || "") : "",
      name: (shipName.value || "").trim(),
      phone: (shipPhone.value || "").trim(),
      address: (shipAddr.value || "").trim(),
    };

    return {
      invoiceNo: (invNo.value || "").trim(),
      date: dateStr,
      accountNo: (accountNo.value || "").trim(),
      salesRep: (salesRep.value || "").trim(),
      terms: (terms.value || "").trim(),
      soldTo,
      shipTo,
      shipToSameAsSoldTo: shipToSame,
      items: collectItemsPayload(),
    };
  }

  // =========================
  // Save / Print
  // =========================
  async function saveInvoice() {
    const payload = buildInvoicePayload();

    if (!payload.items || payload.items.length === 0) {
      alert("请至少添加 1 行商品（qty>0）。");
      return;
    }

    if (!payload.invoiceNo) {
      payload.invoiceNo = genInvoiceNoPreview(payload.date);
    }

    btnSave && (btnSave.disabled = true);
    setHint("⏳ 正在保存发票…（保存成功会扣库存）");

    try {
      const url = currentInvoiceId ? `/api/admin/invoices/${currentInvoiceId}` : `/api/admin/invoices`;
      const method = currentInvoiceId ? "PUT" : "POST";

      const { res, data } = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });

      if (!res.ok || !data?.success) {
        alert("保存失败：" + (data?.message || res.status));
        setHint("❌ 保存失败");
        return;
      }

      const inv = data.invoice || data.data || data.item || null;
      currentInvoiceId = inv?._id || data?._id || currentInvoiceId;

      if (inv?.invoiceNo) invNo.value = inv.invoiceNo;

      if (btnPrint) btnPrint.disabled = !currentInvoiceId;
      setHint(`✅ 已保存：${invNo.value || "(no)"}（库存已按 qty*unitCount 扣减）`);
    } finally {
      btnSave && (btnSave.disabled = false);
    }
  }

  async function printInvoice() {
    if (!currentInvoiceId) {
      alert("请先保存发票，再打印。");
      return;
    }
    await authedDownloadOpen(`/api/admin/invoices/${currentInvoiceId}/pdf`);
  }

  // =========================
  // Statement
  // =========================
  async function runStatement() {
    const from = (stFrom?.value || "").trim();
    const to = (stTo?.value || "").trim();
    const uid = (stUserId?.value || "").trim();

    if (!from || !to) {
      alert("Statement 需要选择 From / To 日期。");
      return;
    }

    const qs = new URLSearchParams();
    qs.set("from", from);
    qs.set("to", to);
    if (uid) qs.set("userId", uid);

    if (stResult) stResult.textContent = "⏳ 生成中…";

    const { res, data } = await apiFetch(`/api/admin/invoices/statements?${qs.toString()}`);
    if (!res.ok || !data?.success) {
      if (stResult) stResult.textContent = "❌ 失败：" + (data?.message || res.status);
      return;
    }

    const invoices = data.invoices || data.list || data.items || [];
    const out = {
      from: data.from || from,
      to: data.to || to,
      userId: data.userId || uid || "",
      count: data.count ?? invoices.length,
      total: data.total ?? null,
      invoices: Array.isArray(invoices)
        ? invoices.map((x) => ({
            invoiceNo: x.invoiceNo || x.no || "",
            date: x.date || x.createdAt || "",
            total: x.total || x.amount || x.grandTotal || 0,
            soldTo: x.soldTo?.name || x.customerName || "",
          }))
        : [],
    };

    if (stResult) stResult.textContent = JSON.stringify(out, null, 2);
  }

  async function printStatementPdf() {
    const from = (stFrom?.value || "").trim();
    const to = (stTo?.value || "").trim();
    const uid = (stUserId?.value || "").trim();

    if (!from || !to) {
      alert("Statement 需要选择 From / To 日期。");
      return;
    }

    const qs = new URLSearchParams();
    qs.set("from", from);
    qs.set("to", to);
    if (uid) qs.set("userId", uid);

    // ✅ 用 fetch+token，避免 requireLogin 拦截
    await authedDownloadOpen(`/api/admin/invoices/statements/pdf?${qs.toString()}`);
  }

  // =========================
  // Search invoices (optional UI)
  // =========================
  function setSearchHint(msg) {
    if (!searchHint) return;
    searchHint.textContent = msg || "";
  }

  function clearSearchList() {
    if (!searchList) return;
    searchList.innerHTML = "";
  }

  function addSearchItem(inv) {
    if (!searchList) return;

    const id = inv?._id || "";
    const invoiceNoX = inv?.invoiceNo || "";
    const name = inv?.soldTo?.name || "";
    const phone = inv?.soldTo?.phone || "";
    const date = inv?.date || inv?.createdAt || "";
    const total = money(inv?.total || 0);

    const row = document.createElement("div");
    row.className = "result-item";

    const left = document.createElement("div");
    left.className = "result-left";

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = `${invoiceNoX || "(no)"}  ·  ${total}`;

    const sub = document.createElement("div");
    sub.className = "result-sub";
    sub.textContent = `${name} ${phone}  ·  ${date}`;

    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "result-right";

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn btn-ghost";
    btnOpen.textContent = "打开详情";
    btnOpen.onclick = () => window.open(`/api/admin/invoices/${id}`, "_blank");

    const btnPdf = document.createElement("button");
    btnPdf.className = "btn btn-dark";
    btnPdf.textContent = "打印PDF";
    btnPdf.onclick = () => authedDownloadOpen(`/api/admin/invoices/${id}/pdf`);

    right.appendChild(btnOpen);
    right.appendChild(btnPdf);

    row.appendChild(left);
    row.appendChild(right);
    searchList.appendChild(row);
  }

  async function runSearchInvoices() {
    if (!btnSearch) return;

    const q = (sQ?.value || "").trim();
    const from = (sFrom?.value || "").trim();
    const to = (sTo?.value || "").trim();
    const uid = (sUserId?.value || "").trim();

    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (uid) qs.set("userId", uid);

    setSearchHint("⏳ 搜索中...");
    clearSearchList();

    const { res, data } = await apiFetch(`/api/admin/invoices?${qs.toString()}`);
    if (!res.ok || !data?.success) {
      setSearchHint("❌ 搜索失败：" + (data?.message || res.status));
      return;
    }

    const list = data.invoices || data.list || data.items || [];
    setSearchHint(`✅ 找到 ${list.length} 条`);
    for (const inv of list) addSearchItem(inv);
  }

  function resetSearchInvoices() {
    if (sQ) sQ.value = "";
    if (sFrom) sFrom.value = "";
    if (sTo) sTo.value = "";
    if (sUserId) sUserId.value = "";
    setSearchHint("");
    clearSearchList();
  }

  // =========================
  // Init / Reset
  // =========================
  function resetForm() {
    currentInvoiceId = "";
    if (btnPrint) btnPrint.disabled = true;

    if (invDate) invDate.value = todayLocalInput();
    if (invNo) invNo.value = genInvoiceNoPreview(invDate?.value);

    if (accountNo) accountNo.value = "";
    if (salesRep) salesRep.value = "";
    if (terms) terms.value = "";

    if (userSelect) userSelect.value = "";
    if (soldName) soldName.value = "";
    if (soldPhone) soldPhone.value = "";
    if (soldAddr) soldAddr.value = "";

    if (sameAsSold) sameAsSold.checked = true;
    setShipDisabled(true);
    if (shipName) shipName.value = "";
    if (shipPhone) shipPhone.value = "";
    if (shipAddr) shipAddr.value = "";

    if (itemsTbody) {
      itemsTbody.innerHTML = "";
      addRow({ qty: 1, unitPrice: 0 });
    }

    // statement 默认区间：本月到今天
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    if (stFrom) stFrom.value = toDateInputValue(first);
    if (stTo) stTo.value = toDateInputValue(now);
    if (stUserId) stUserId.value = "";
    if (stResult) stResult.textContent = "";

    recalcTotals();
  }

  // =========================
  // Events
  // =========================
  if (userSelect) {
    userSelect.onchange = () => {
      const opt = userSelect.selectedOptions && userSelect.selectedOptions[0];
      if (!opt || !userSelect.value) return;

      soldName.value = opt.dataset.name || "";
      soldPhone.value = opt.dataset.phone || "";
      soldAddr.value = opt.dataset.addr || "";

      syncShipFromSold();
      if (stUserId) stUserId.value = userSelect.value || "";
    };
  }

  if (sameAsSold) {
    sameAsSold.onchange = () => {
      if (sameAsSold.checked) {
        setShipDisabled(true);
        syncShipFromSold();
      } else {
        setShipDisabled(false);
      }
    };
  }

  if (soldName) soldName.oninput = syncShipFromSold;
  if (soldPhone) soldPhone.oninput = syncShipFromSold;
  if (soldAddr) soldAddr.oninput = syncShipFromSold;

  if (btnAddRow) btnAddRow.onclick = () => addRow({ qty: 1, unitPrice: 0 });
  if (btnSave) btnSave.onclick = saveInvoice;
  if (btnPrint) btnPrint.onclick = printInvoice;
  if (btnNew) btnNew.onclick = resetForm;
  if (btnStatement) btnStatement.onclick = runStatement;

  // ✅ 绑定 Statement 打印按钮
  if (btnStatementPdf) btnStatementPdf.onclick = printStatementPdf;

  if (btnSearch) btnSearch.onclick = runSearchInvoices;
  if (btnSearchReset) btnSearchReset.onclick = resetSearchInvoices;

  if (invDate) {
    invDate.onchange = () => {
      const cur = (invNo?.value || "").trim();
      const auto = genInvoiceNoPreview(invDate.value);
      if (!cur || /^\d{8}-\d{3}$/.test(cur)) {
        invNo.value = auto;
      }
    };
  }

  // Enter 触发搜索
  [sQ, sFrom, sTo, sUserId].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearchInvoices();
    });
  });

  // =========================
  // Boot
  // =========================
  (async function init() {
    resetForm();
    setHint("⏳ 正在加载用户/商品…");

    await loadProducts("");
    if (itemsTbody) {
      itemsTbody.innerHTML = "";
      addRow({ qty: 1, unitPrice: 0 });
    }

    await loadUsers("");
    setHint("✅ 已加载用户/商品。可选择用户、选择商品/规格，保存后扣库存，打印 PDF。");
  })();
})();
