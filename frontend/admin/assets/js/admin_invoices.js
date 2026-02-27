// frontend/admin/assets/js/admin_invoices.js
// ✅ 发票开具（后台）完整前端脚本（PRODUCTION SAFE）
// - 选用户自动带出 name/phone/address
// - 商品/规格自动填描述/价格，并携带 unitCount（扣库存用）
// - 保存：POST /api/admin/invoices（后端扣库存）
// - 打印（手机/电脑通用）：打开 /admin/print_invoice.html?id=xxx
// - Statement：
//    JSON: GET /api/admin/invoices/statements?from&to&userId
//    打印（手机/电脑通用）：打开 /admin/print_statement.html?from&to&userId
// - 搜索发票：GET /api/admin/invoices?q&from&to&userId
//
// ✅ Fixes:
// - 修复 btnPdf 未定义导致 search list 不渲染
// - 搜索/statement 的 user 输入支持：userId / 手机 / 姓名（前端解析）
// - searchList 若不存在，自动创建到 #searchHint 后面

(function () {
  console.log("admin_invoices.js LOADED ✅ VERSION=2026-02-24-FULLFIX");

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
  // =========================
  // UserId resolver (name / phone / userId)
  // =========================
  function isObjectId(s) {
    return /^[a-fA-F0-9]{24}$/.test(String(s || "").trim());
  }
  async function fetchNextInvoiceNo(dateStr) {
  const qs = new URLSearchParams();
  if (dateStr) qs.set("date", dateStr);

  const { res, data } = await apiFetch(`/api/admin/invoices/next-no?${qs.toString()}`);
  if (!res.ok || !data?.success) return "";
  return String(data.nextNo || "").trim();
}
  function normPhoneDigits(s) {
    const d = String(s || "").replace(/\D/g, "");
    // 兼容：1xxxxxxxxxx / xxxxxxxxxx
    if (d.length === 11 && d.startsWith("1")) return d.slice(1);
    return d;
  }

  async function resolveUserId(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";                // 为空 = 全部客户
    if (isObjectId(raw)) return raw;    // 已是 userId 直接返回

    // 尝试当手机号处理
    const digits = normPhoneDigits(raw);
    const isPhone = digits.length >= 7; // 你也可以改成 10 更严格
    const keyword = isPhone ? digits : raw;

    // 用后台用户列表接口做 keyword 搜索（你后端已有 /api/admin/users?keyword=）
    const qs = new URLSearchParams();
    qs.set("page", "1");
    qs.set("pageSize", "20");
    qs.set("keyword", keyword);

    const { res, data } = await apiFetch(`/api/admin/users?${qs.toString()}`);
    if (!res.ok || !data?.success) return ""; // 解析失败：当作不筛选/或提示

    const list = data.users || data.list || data.items || data.data || [];
    const usersList = Array.isArray(list) ? list : [];

    if (usersList.length === 0) return "";

    // 优先精确匹配：电话包含 / 姓名包含
    const lowerRaw = raw.toLowerCase();
    const digitsRaw = normPhoneDigits(raw);

    const normalized = usersList.map((u) => ({
      _id: u?._id || u?.id || "",
      name: String(u?.name || ""),
      phone: String(u?.phone || ""),
    })).filter((x) => x._id);

    // 精确手机号匹配
    if (digitsRaw && digitsRaw.length >= 7) {
      const hitPhone = normalized.find((x) => normPhoneDigits(x.phone).includes(digitsRaw));
      if (hitPhone) return hitPhone._id;
    }

    // 姓名匹配
    const hitName = normalized.find((x) => x.name.toLowerCase().includes(lowerRaw));
    if (hitName) return hitName._id;

    // 只有一个结果就直接用
    if (normalized.length === 1) return normalized[0]._id;

    // 多个结果：提示你用更精确的电话或直接粘贴 userId
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

  const stUserHint = document.getElementById("stUserHint"); // 可选（你的新版 html 有）
  const sUserHint = document.getElementById("sUserHint");   // 可选（你的新版 html 有）

  // 搜索区
  const sQ = document.getElementById("sQ");
  const sFrom = document.getElementById("sFrom");
  const sTo = document.getElementById("sTo");
  const sUserId = document.getElementById("sUserId");
  const btnSearch = document.getElementById("btnSearch");
  const btnSearchReset = document.getElementById("btnSearchReset");
  const searchHint = document.getElementById("searchHint");
  let searchList = document.getElementById("searchList"); // 可能不存在

  // ✅ searchList 兜底创建（防止“找到1条但不显示”）
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
    return String(s || "")
      .replace(/[^\d]/g, ""); // 只保留数字
  }

  function looksLikeMongoId(s) {
    return /^[a-fA-F0-9]{24}$/.test(String(s || "").trim());
  }

  // 返回 { userId, user, reason } 或 null
  function resolveUserInput(raw) {
    const input = normStr(raw);
    if (!input) return null;

    // 1) 直接就是 userId
    if (looksLikeMongoId(input)) {
      const u = users.find(x => String(x?._id || "") === input) || null;
      return { userId: input, user: u, reason: u ? "userId" : "userId(unknown)" };
    }

    const phoneDigits = normPhone(input);

    // 2) 看起来像手机号（>=7位）
    if (phoneDigits.length >= 7) {
      const hit = users.find(u => normPhone(u.phone).includes(phoneDigits));
      if (hit) return { userId: hit._id, user: hit, reason: "phone" };
    }

    // 3) 姓名包含匹配
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
    // 把 userId 写回输入框（你希望后端永远收到 userId）
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
    qs.set("pageSize", "200"); // ✅ 多拉点，方便姓名/电话匹配
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
    tr.dataset.manualPrice = "0"; // ✅ 默认没手动改价
    const tdP = document.createElement("td");
    const selP = makeProductSelect();
    selP.value = preset.productId || "";
    tdP.appendChild(selP);
    tr.appendChild(tdP);

    const tdV = document.createElement("td");
    tdV.dataset.k = "variantCell";
    tr.appendChild(tdV);

    const tdD = document.createElement("td");
    const inpDesc = document.createElement("input");
    inpDesc.dataset.k = "description";
    inpDesc.placeholder = "可手填";
    inpDesc.value = preset.description || "";
    tdD.appendChild(inpDesc);
    tr.appendChild(tdD);

    const tdQ = document.createElement("td");
    const inpQty = document.createElement("input");
    inpQty.type = "number";
    inpQty.step = "1";
    inpQty.min = "0";
    inpQty.dataset.k = "qty";
    inpQty.value = preset.qty != null ? String(preset.qty) : "1";
    tdQ.appendChild(inpQty);
    tr.appendChild(tdQ);

    const tdU = document.createElement("td");
    const inpPrice = document.createElement("input");
    inpPrice.type = "number";
    inpPrice.step = "0.01";
    inpPrice.min = "0";
    inpPrice.dataset.k = "unitPrice";
    inpPrice.value = preset.unitPrice != null ? String(preset.unitPrice) : "0";
    tdU.appendChild(inpPrice);
    tr.appendChild(tdU);

    const tdT = document.createElement("td");
    const lineEl = document.createElement("div");
    lineEl.dataset.k = "lineTotal";
    lineEl.textContent = "$0.00";
    tdT.appendChild(lineEl);
    tr.appendChild(tdT);

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

      const manual = tr.dataset.manualPrice === "1"; // ✅ 是否手动改过价

if (varSel && varSel.selectedOptions && varSel.selectedOptions[0]) {
  const opt = varSel.selectedOptions[0];
  const vp = opt.dataset.variantPrice;
  const auto = vp !== "" ? parseNum(vp, p.price) : p.price;

  if (!manual) inpPrice.value = String(auto || 0); // ✅ 没手动改价就覆盖
} else {
  if (!manual) inpPrice.value = String(p.price || 0);
}
      recalcTotals();
    }

    selP.onchange = () => {
  tr.dataset.manualPrice = "0"; // ✅ 换商品后默认用自动价格
  const varSel = refreshVariantUI(selP.value);
  if (varSel) varSel.onchange = autofillByProductAndVariant;
  autofillByProductAndVariant();
};
    inpQty.oninput = recalcTotals;
    inpPrice.oninput = () => {
  tr.dataset.manualPrice = "1"; // ✅ 手动改过价
  recalcTotals();
};
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
let variantLabel = ""; // ✅ 一定要定义

const varSel = tr.querySelector('select[data-k="variantKey"]');
if (varSel && varSel.selectedOptions && varSel.selectedOptions[0]) {
  const opt = varSel.selectedOptions[0];
  unitCount = Math.max(1, Math.floor(parseNum(opt.dataset.unitCount, 1)));
  variantLabel = String(opt.textContent || "").trim(); // ✅ 规格文字，例如“整箱(1)”
}

// ✅ 没选商品或没选规格时，variantLabel 为空也没问题
items.push({
  productId: productId || "",
  variantKey: variantKey || "",
  variantLabel, // ✅ 现在不会报错了
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

  // ✅ 统一用打印页（手机/电脑都稳定）
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

    // ✅ 支持 userId / 手机 / 姓名（远程解析成 userId）
let uid = "";
if (raw) {
  uid = await resolveUserId(raw); // 关键：远程搜索解析
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

    // ✅ user 输入支持 userId / 手机 / 姓名（远程解析）
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
if (invNo) invNo.value = ""; // 先清空

// ✅ 新建时直接显示下一张号（002/003...）
(async () => {
  const nextNo = await fetchNextInvoiceNo(invDate?.value);
  if (nextNo && invNo) invNo.value = nextNo;
})();
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

      // ✅ Statement 默认带 userId
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
  invDate.onchange = async () => {
    if (!invNo) return;
    invNo.value = "";
    const nextNo = await fetchNextInvoiceNo(invDate.value);
    if (nextNo) invNo.value = nextNo;
  };
}
  // Enter 触发搜索
  [sQ, sFrom, sTo, sUserId].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearchInvoices();
    });
  });

  // 输入框失焦时也尝试解析（更顺手）
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
    setHint("✅ 已加载用户/商品。保存后扣库存；打印/打开走 print 页面（手机/电脑都稳定）。");
  })();
})();