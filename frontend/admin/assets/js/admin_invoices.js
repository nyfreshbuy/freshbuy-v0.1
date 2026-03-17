// frontend/admin/assets/js/admin_invoices.js
// ✅ 发票开具（后台）完整前端脚本（DESCRIPTION 搜索商品版）
// - Description 输入自动搜索商品
// - 下拉显示 商品 / 规格 / 库存 / 单价
// - 选中后自动带入 productId / 规格 / 单价 / 库存
// - 保存：POST /api/admin/invoices（后端扣库存）
// - 打印（手机/电脑通用）：打开 /admin/print_invoice.html?id=xxx
// - Statement：
//    JSON: GET /api/admin/invoices/statements?from&to&userId
//    打印（手机/电脑通用）：打开 /admin/print_statement.html?from&to&userId
// - 搜索发票：GET /api/admin/invoices?q&from&to&userId

(function () {
  console.log("admin_invoices.js LOADED ✅ VERSION=2026-03-16-DESC-AUTOCOMPLETE");

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
      try { data = await res.json(); } catch { data = null; }
    }
    return { res, data };
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // =========================
  // UserId resolver (name / phone / userId)
  // =========================
  function isObjectId(s) {
    return /^[a-fA-F0-9]{24}$/.test(String(s || "").trim());
  }

  function normPhoneDigits(s) {
    const d = String(s || "").replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) return d.slice(1);
    return d;
  }

  async function resolveUserId(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    if (isObjectId(raw)) return raw;

    const digits = normPhoneDigits(raw);
    const isPhone = digits.length >= 7;
    const keyword = isPhone ? digits : raw;

    const qs = new URLSearchParams();
    qs.set("page", "1");
    qs.set("pageSize", "20");
    qs.set("keyword", keyword);

    const { res, data } = await apiFetch(`/api/admin/users?${qs.toString()}`);
    if (!res.ok || !data?.success) return "";

    const list = data.users || data.list || data.items || data.data || [];
    const usersList = Array.isArray(list) ? list : [];

    if (usersList.length === 0) return "";

    const lowerRaw = raw.toLowerCase();
    const digitsRaw = normPhoneDigits(raw);

    const normalized = usersList.map((u) => ({
      _id: u?._id || u?.id || "",
      name: String(u?.name || ""),
      phone: String(u?.phone || ""),
    })).filter((x) => x._id);

    if (digitsRaw && digitsRaw.length >= 7) {
      const hitPhone = normalized.find((x) => normPhoneDigits(x.phone).includes(digitsRaw));
      if (hitPhone) return hitPhone._id;
    }

    const hitName = normalized.find((x) => x.name.toLowerCase().includes(lowerRaw));
    if (hitName) return hitName._id;

    if (normalized.length === 1) return normalized[0]._id;

    alert(
      "匹配到多个用户，请输入更精确的手机号或直接粘贴 UserId。\n" +
        normalized
          .slice(0, 8)
          .map((x) => `${x.name || "(无名)"} ${x.phone || ""}  →  ${x._id}`)
          .join("\n")
    );
    return "";
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
  const btnStatementPdf = document.getElementById("btnStatementPdf");
  const stResult = document.getElementById("stResult");

  const stUserHint = document.getElementById("stUserHint");
  const sUserHint = document.getElementById("sUserHint");

  const sQ = document.getElementById("sQ");
  const sFrom = document.getElementById("sFrom");
  const sTo = document.getElementById("sTo");
  const sUserId = document.getElementById("sUserId");
  const btnSearch = document.getElementById("btnSearch");
  const btnSearchReset = document.getElementById("btnSearchReset");
  const searchHint = document.getElementById("searchHint");
  let searchList = document.getElementById("searchList");

  function ensureSearchList() {
    if (searchList) return searchList;
    if (!searchHint) return null;
    const div = document.createElement("div");
    div.id = "searchList";
    div.className = "result-list";
    searchHint.insertAdjacentElement("afterend", div);
    searchList = div;
    return searchList;
  }

  // =========================
  // State
  // =========================
  let users = [];
  let products = [];
  let productMap = new Map();
  let currentInvoiceId = "";

  // =========================
  // Date helpers
  // =========================
  function pad2(n) { return String(n).padStart(2, "0"); }

  function toDateInputValue(d) {
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
  }

  function todayLocalInput() {
    return toDateInputValue(new Date());
  }

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
    if (shipName) shipName.disabled = disabled;
    if (shipPhone) shipPhone.disabled = disabled;
    if (shipAddr) shipAddr.disabled = disabled;
  }

  function syncShipFromSold() {
    if (!sameAsSold || !sameAsSold.checked) return;
    if (shipName) shipName.value = soldName?.value || "";
    if (shipPhone) shipPhone.value = soldPhone?.value || "";
    if (shipAddr) shipAddr.value = soldAddr?.value || "";
  }

  function setSmallHint(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
  }

  // =========================
  // User resolver (支持 userId / phone / name)
  // =========================
  function normStr(s) {
    return String(s || "").trim();
  }

  function normPhone(s) {
    return String(s || "").replace(/[^\d]/g, "");
  }

  function looksLikeMongoId(s) {
    return /^[a-fA-F0-9]{24}$/.test(String(s || "").trim());
  }

  function resolveUserInput(raw) {
    const input = normStr(raw);
    if (!input) return null;

    if (looksLikeMongoId(input)) {
      const u = users.find(x => String(x?._id || "") === input) || null;
      return { userId: input, user: u, reason: u ? "userId" : "userId(unknown)" };
    }

    const phoneDigits = normPhone(input);
    if (phoneDigits.length >= 7) {
      const hit = users.find(u => normPhone(u.phone).includes(phoneDigits));
      if (hit) return { userId: hit._id, user: hit, reason: "phone" };
    }

    const lower = input.toLowerCase();
    const hit2 = users.find(u => normStr(u.name).toLowerCase().includes(lower));
    if (hit2) return { userId: hit2._id, user: hit2, reason: "name" };

    return null;
  }

  function applyResolvedToInput(inputEl, hintEl, resolved) {
    if (!inputEl) return;
    if (!resolved) {
      setSmallHint(hintEl, "");
      return;
    }
    inputEl.value = resolved.userId;
    const u = resolved.user;
    if (u) {
      setSmallHint(hintEl, `✅ 已匹配：${u.name || ""} ${u.phone || ""} → ${resolved.userId}`);
    } else {
      setSmallHint(hintEl, `✅ 使用 userId：${resolved.userId}`);
    }
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
    qs.set("pageSize", "200");
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
  // Search products for invoice
  // =========================
  async function searchProductsForInvoice(keyword) {
    const q = String(keyword || "").trim();
    if (!q) return [];

    const { res, data } = await apiFetch(`/api/admin/products/search-lite?q=${encodeURIComponent(q)}`, {
      method: "GET",
    });

    if (!res.ok) return [];
    return Array.isArray(data?.items) ? data.items : [];
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

  function renderSuggest(dropdownEl, items, onPick) {
    if (!dropdownEl) return;

    if (!items || !items.length) {
      dropdownEl.innerHTML = `<div class="invoice-suggest-empty">无匹配商品</div>`;
      dropdownEl.style.display = "block";
      return;
    }

    dropdownEl.innerHTML = items.map((item, idx) => {
      const name = escapeHtml(item.name || "");
      const specLabel = escapeHtml(item.specLabel || "");
      const stock = Number(item.stock || 0);
      const price = Number(item.price || 0).toFixed(2);

      return `
        <button type="button" class="invoice-suggest-item" data-idx="${idx}">
          <div class="invoice-suggest-title">${name}</div>
          <div class="invoice-suggest-meta">
            <span>规格：${specLabel || "-"}</span>
            <span>库存：${stock}</span>
            <span>单价：$${price}</span>
          </div>
        </button>
      `;
    }).join("");

    dropdownEl.style.display = "block";

    [...dropdownEl.querySelectorAll(".invoice-suggest-item")].forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx || -1);
        if (idx >= 0 && items[idx]) onPick(items[idx]);
      });
    });
  }

  function makeVariantSelectWithLiteSpecs(specs, selectedId = "") {
    const sel = document.createElement("select");
    sel.dataset.k = "variantKey";

    const list = Array.isArray(specs) ? specs : [];
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "单个";
      opt.dataset.unitCount = "1";
      opt.dataset.variantPrice = "";
      opt.dataset.variantLabel = "单个";
      opt.dataset.stock = "";
      sel.appendChild(opt);
      return sel;
    }

    for (const spec of list) {
      const opt = document.createElement("option");
      opt.value = String(spec.id || "");
      opt.textContent = spec.label || "默认规格";
      opt.dataset.unitCount = String(Math.max(1, Math.floor(parseNum(spec.unitCount, 1))));
      opt.dataset.variantPrice = spec.price == null ? "" : String(parseNum(spec.price, 0));
      opt.dataset.variantLabel = spec.label || "";
      opt.dataset.stock = String(parseNum(spec.stock, 0));
      if (String(spec.id || "") === String(selectedId || "")) opt.selected = true;
      sel.appendChild(opt);
    }

    return sel;
  }

  function addRow(preset = {}) {
    if (!itemsTbody) return;

    const tr = document.createElement("tr");
    tr.dataset.manualPrice = preset.unitPrice != null ? "1" : "0";

    // hidden productId
    const hiddenProductId = document.createElement("input");
    hiddenProductId.type = "hidden";
    hiddenProductId.dataset.k = "productId";
    hiddenProductId.value = preset.productId || "";
    tr.appendChild(hiddenProductId);

    // Description
    const tdD = document.createElement("td");
    tdD.style.position = "relative";

    const inpDesc = document.createElement("input");
    inpDesc.dataset.k = "description";
    inpDesc.placeholder = "输入商品名 / 规格 / 关键字";
    inpDesc.autocomplete = "off";
    inpDesc.value = preset.description || "";

    const suggest = document.createElement("div");
    suggest.className = "invoice-suggest";
    suggest.style.display = "none";

    tdD.appendChild(inpDesc);
    tdD.appendChild(suggest);
    tr.appendChild(tdD);

    // Variant
    const tdV = document.createElement("td");
    tdV.dataset.k = "variantCell";
    tr.appendChild(tdV);

    // Stock
    const tdS = document.createElement("td");
    const stockBadge = document.createElement("div");
    stockBadge.dataset.k = "stock";
    stockBadge.className = "invoice-stock-badge";
    stockBadge.textContent = "-";
    stockBadge.dataset.stock = preset.stock != null ? String(parseNum(preset.stock, 0)) : "";
    tdS.appendChild(stockBadge);
    tr.appendChild(tdS);

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

    // Unit price
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

    // Delete
    const tdX = document.createElement("td");
    const btnDel = document.createElement("button");
    btnDel.className = "btn btn-danger";
    btnDel.textContent = "删";
    btnDel.type = "button";
    btnDel.onclick = () => {
      tr.remove();
      recalcTotals();
    };
    tdX.appendChild(btnDel);
    tr.appendChild(tdX);

    function refreshVariantUIFromLiteSpecs(specs = [], selectedId = "") {
      tdV.innerHTML = "";
      const vs = makeVariantSelectWithLiteSpecs(specs, selectedId);
      tdV.appendChild(vs);
      return vs;
    }

    function updateStockFromVariantSelect() {
      const varSel = tdV.querySelector('select[data-k="variantKey"]');
      if (!varSel || !varSel.selectedOptions || !varSel.selectedOptions[0]) {
        stockBadge.textContent = "-";
        stockBadge.dataset.stock = "";
        recalcTotals();
        return;
      }

      const opt = varSel.selectedOptions[0];
      const stock = parseNum(opt.dataset.stock, 0);
      const vp = opt.dataset.variantPrice;

      stockBadge.dataset.stock = String(stock);
      stockBadge.textContent = `库存 ${stock}`;

      if (tr.dataset.manualPrice !== "1") {
        if (vp !== "") {
          inpPrice.value = String(parseNum(vp, 0));
        }
      }

      // 限库存
      const qty = parseNum(inpQty.value, 0);
      if (stock > 0 && qty > stock) {
        inpQty.value = String(stock);
      }

      recalcTotals();
    }

    function pickLiteProduct(item) {
      hiddenProductId.value = item.id || "";
      inpDesc.value = item.specLabel ? `${item.name || ""} - ${item.specLabel}` : (item.name || "");
      tr.dataset.manualPrice = "0";

      const specs = Array.isArray(item.specs) ? item.specs : [];
      const vs = refreshVariantUIFromLiteSpecs(specs, item.defaultSpecId || "");
      if (vs) {
        vs.onchange = () => updateStockFromVariantSelect();
      }

      const price = parseNum(item.price, 0);
      inpPrice.value = String(price);

      const stock = parseNum(item.stock, 0);
      stockBadge.dataset.stock = String(stock);
      stockBadge.textContent = `库存 ${stock}`;

      suggest.style.display = "none";
      suggest.innerHTML = "";

      recalcTotals();
    }

    let searchTimer = null;

    inpDesc.addEventListener("input", () => {
      const keyword = String(inpDesc.value || "").trim();

      clearTimeout(searchTimer);
      if (!keyword) {
        suggest.style.display = "none";
        suggest.innerHTML = "";
        hiddenProductId.value = "";
        return;
      }

      searchTimer = setTimeout(async () => {
        const items = await searchProductsForInvoice(keyword);
        renderSuggest(suggest, items, pickLiteProduct);
      }, 250);
    });

    inpDesc.addEventListener("focus", async () => {
      const keyword = String(inpDesc.value || "").trim();
      if (!keyword) return;
      const items = await searchProductsForInvoice(keyword);
      renderSuggest(suggest, items, pickLiteProduct);
    });

    document.addEventListener("click", (e) => {
      if (!tr.contains(e.target)) {
        suggest.style.display = "none";
      }
    });

    inpQty.oninput = () => {
      const stock = parseNum(stockBadge.dataset.stock, 0);
      const qty = parseNum(inpQty.value, 0);
      if (stock > 0 && qty > stock) {
        inpQty.value = String(stock);
      }
      recalcTotals();
    };

    inpPrice.oninput = () => {
      tr.dataset.manualPrice = "1";
      recalcTotals();
    };

    // preset variant
    const initialSpecs = Array.isArray(preset.specs) ? preset.specs : [];
    const initialVarSel = refreshVariantUIFromLiteSpecs(initialSpecs, preset.variantKey || "");
    if (initialVarSel) {
      initialVarSel.onchange = () => updateStockFromVariantSelect();
    }

    if (preset.stock != null) {
      stockBadge.textContent = `库存 ${parseNum(preset.stock, 0)}`;
    }

    itemsTbody.appendChild(tr);
    updateStockFromVariantSelect();
    recalcTotals();
  }

  function collectItemsPayload() {
    const items = [];
    if (!itemsTbody) return items;

    const trs = itemsTbody.querySelectorAll("tr");
    for (const tr of trs) {
      const productId = tr.querySelector('[data-k="productId"]')?.value || "";
      const varSel = tr.querySelector('select[data-k="variantKey"]');
      const variantKey = varSel?.value || "";
      const description = tr.querySelector('[data-k="description"]')?.value || "";
      const qty = parseNum(tr.querySelector('[data-k="qty"]')?.value, 0);
      const unitPrice = parseNum(tr.querySelector('[data-k="unitPrice"]')?.value, 0);

      let unitCount = 1;
      let variantLabel = "";

      if (varSel && varSel.selectedOptions && varSel.selectedOptions[0]) {
        const opt = varSel.selectedOptions[0];
        unitCount = Math.max(1, Math.floor(parseNum(opt.dataset.unitCount, 1)));
        variantLabel = String(opt.dataset.variantLabel || opt.textContent || "").trim();
      }

      items.push({
        productId: productId || "",
        variantKey: variantKey || "",
        variantLabel,
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
    const dateStr = invDate?.value || todayLocalInput();

    const soldTo = {
      userId: userSelect?.value || "",
      name: (soldName?.value || "").trim(),
      phone: (soldPhone?.value || "").trim(),
      address: (soldAddr?.value || "").trim(),
    };

    const shipToSame = !!sameAsSold?.checked;

    const shipTo = {
      userId: shipToSame ? (soldTo.userId || "") : "",
      name: (shipName?.value || "").trim(),
      phone: (shipPhone?.value || "").trim(),
      address: (shipAddr?.value || "").trim(),
    };

    return {
      invoiceNo: (invNo?.value || "").trim(),
      date: dateStr,
      accountNo: (accountNo?.value || "").trim(),
      salesRep: (salesRep?.value || "").trim(),
      terms: (terms?.value || "").trim(),
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

    if (btnSave) btnSave.disabled = true;
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

      if (inv?.invoiceNo && invNo) invNo.value = inv.invoiceNo;

      if (btnPrint) btnPrint.disabled = !currentInvoiceId;
      setHint(`✅ 已保存：${invNo?.value || "(no)"}（库存已按 qty*unitCount 扣减）`);
    } finally {
      if (btnSave) btnSave.disabled = false;
    }
  }

  function openInvoicePrintPage(id) {
    if (!id) return;
    window.open(`/admin/print_invoice.html?id=${encodeURIComponent(id)}`, "_blank", "noopener");
  }

  async function printInvoice() {
    if (!currentInvoiceId) {
      alert("请先保存发票，再打印。");
      return;
    }
    openInvoicePrintPage(currentInvoiceId);
  }

  // =========================
  // Statement
  // =========================
  async function runStatement() {
    const from = (stFrom?.value || "").trim();
    const to = (stTo?.value || "").trim();
    const raw = (stUserId?.value || "").trim();

    if (!from || !to) {
      alert("Statement 需要选择 From / To 日期。");
      return;
    }

    let uid = "";
    if (raw) {
      uid = await resolveUserId(raw);
      if (!uid) {
        setSmallHint(stUserHint, "❌ 找不到该用户（请用更完整的姓名/手机号，或直接粘贴 userId）");
        alert("找不到该用户（请用更完整的姓名/手机号，或直接粘贴 userId）");
        return;
      }
      if (stUserId) stUserId.value = uid;
      setSmallHint(stUserHint, `✅ 已解析为 userId：${uid}`);
    } else {
      setSmallHint(stUserHint, "");
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

  function openStatementPrintPage(from, to, userId) {
    const qs = new URLSearchParams();
    qs.set("from", from);
    qs.set("to", to);
    if (userId) qs.set("userId", userId);
    window.open(`/admin/print_statement.html?${qs.toString()}`, "_blank", "noopener");
  }

  async function printStatementPdf() {
    const from = (stFrom?.value || "").trim();
    const to = (stTo?.value || "").trim();
    const raw = (stUserId?.value || "").trim();

    if (!from || !to) {
      alert("Statement 需要选择 From / To 日期。");
      return;
    }

    let uid = "";
    if (raw) {
      uid = await resolveUserId(raw);
      if (!uid) {
        setSmallHint(stUserHint, "❌ 找不到该用户（请用更完整的姓名/手机号，或直接粘贴 userId）");
        alert("找不到该用户（请用更完整的姓名/手机号，或直接粘贴 userId）");
        return;
      }
      if (stUserId) stUserId.value = uid;
      setSmallHint(stUserHint, `✅ 已解析为 userId：${uid}`);
    } else {
      setSmallHint(stUserHint, "");
    }

    openStatementPrintPage(from, to, uid);
  }

  // =========================
  // Search invoices
  // =========================
  function setSearchHint(msg) {
    if (!searchHint) return;
    searchHint.textContent = msg || "";
  }

  function clearSearchList() {
    const listEl = ensureSearchList();
    if (!listEl) return;
    listEl.innerHTML = "";
  }

  function addSearchItem(inv) {
    const listEl = ensureSearchList();
    if (!listEl) return;

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
    btnOpen.className = "btn btn-dark";
    btnOpen.type = "button";
    btnOpen.textContent = "打开/打印";
    btnOpen.onclick = () => openInvoicePrintPage(id);

    right.appendChild(btnOpen);

    row.appendChild(left);
    row.appendChild(right);
    listEl.appendChild(row);
  }

  async function runSearchInvoices() {
    if (!btnSearch) return;

    const q = (sQ?.value || "").trim();
    const from = (sFrom?.value || "").trim();
    const to = (sTo?.value || "").trim();
    const raw = (sUserId?.value || "").trim();

    let uid = "";
    if (raw) {
      uid = await resolveUserId(raw);
      if (!uid) {
        setSmallHint(sUserHint, "❌ 找不到该用户（请用更完整的姓名/手机号，或直接粘贴 userId）");
        alert("找不到该用户（请用更完整的姓名/手机号，或直接粘贴 userId）");
        return;
      }
      if (sUserId) sUserId.value = uid;
      setSmallHint(sUserHint, `✅ 已解析为 userId：${uid}`);
    } else {
      setSmallHint(sUserHint, "");
    }

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
    setSmallHint(sUserHint, "");
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

    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    if (stFrom) stFrom.value = toDateInputValue(first);
    if (stTo) stTo.value = toDateInputValue(now);
    if (stUserId) stUserId.value = "";
    setSmallHint(stUserHint, "");
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

      if (soldName) soldName.value = opt.dataset.name || "";
      if (soldPhone) soldPhone.value = opt.dataset.phone || "";
      if (soldAddr) soldAddr.value = opt.dataset.addr || "";

      syncShipFromSold();

      if (stUserId) stUserId.value = userSelect.value || "";
      setSmallHint(stUserHint, userSelect.value ? `✅ 已选择用户：${opt.textContent} → ${userSelect.value}` : "");
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

  if (btnNew) btnNew.onclick = resetForm;
  if (btnAddRow) btnAddRow.onclick = () => addRow({ qty: 1, unitPrice: 0 });
  if (btnSave) btnSave.onclick = saveInvoice;

  if (btnPrint) {
    btnPrint.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      printInvoice();
    });
  }

  if (btnStatement) btnStatement.onclick = runStatement;

  if (btnStatementPdf) {
    btnStatementPdf.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      printStatementPdf();
    });
  }

  if (btnSearch) btnSearch.onclick = runSearchInvoices;
  if (btnSearchReset) btnSearchReset.onclick = resetSearchInvoices;

  if (invDate) {
    invDate.onchange = () => {
      const cur = (invNo?.value || "").trim();
      const auto = genInvoiceNoPreview(invDate.value);
      if (!cur || /^\d{8}-\d{3}$/.test(cur)) {
        if (invNo) invNo.value = auto;
      }
    };
  }

  [sQ, sFrom, sTo, sUserId].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearchInvoices();
    });
  });

  if (stUserId) {
    stUserId.addEventListener("blur", () => {
      const resolved = resolveUserInput(stUserId.value);
      if (resolved) applyResolvedToInput(stUserId, stUserHint, resolved);
    });
  }
  if (sUserId) {
    sUserId.addEventListener("blur", () => {
      const resolved = resolveUserInput(sUserId.value);
      if (resolved) applyResolvedToInput(sUserId, sUserHint, resolved);
    });
  }

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
    ensureSearchList();
    setHint("✅ 已加载用户/商品。Description 支持搜索商品并显示库存。");
  })();
})();