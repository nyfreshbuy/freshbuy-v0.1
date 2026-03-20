// ===========================================================
// 在鲜购拼好货 · 后台商品管理 products.js（完整版 + 小修复）
// ✅ 新增：整箱规格在前台展示 p_boxVisibleOnFrontend
// ✅ 新增：售价低于成本价时弹窗提示
// ===========================================================

// 全局状态
let currentEditingId = null;
let productsCache = [];
let currentEditorTab = "basic"; // basic | purchase

// 默认分类（会自动填充到 datalist）
const defaultCategories = [
  "生鲜果蔬",
  "肉禽海鲜",
  "零食饮品",
  "粮油主食",
  "调味酱料",
  "冷冻食品",
  "日用清洁",
  "其他",
];
const defaultSubCategories = [];

// ===========================================================
// 工具
// ===========================================================
function toLocalInputValue(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  const pad = (n) => (n < 10 ? "0" + n : n);
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

function findProductAnyId(anyId) {
  const key = String(anyId || "").trim();
  if (!key) return null;
  return (
    productsCache.find((x) => String(x?._id || "") === key) ||
    productsCache.find((x) => String(x?.id || "") === key) ||
    null
  );
}

function confirmIfSellPriceBelowCost({ originPrice, cost }) {
  const sellPrice = Number(originPrice);
  const costPrice = Number(cost);

  if (!Number.isFinite(sellPrice) || sellPrice <= 0) return true;
  if (!Number.isFinite(costPrice) || costPrice <= 0) return true;
  if (sellPrice >= costPrice) return true;

  return window.confirm(
    `检测到售价低于成本价：\n售价 $${sellPrice.toFixed(2)}，成本价 $${costPrice.toFixed(2)}。\n\n确定继续保存吗？`
  );
}

// ===========================================================
// 🌟 重置商品编辑表单 resetForm（纯原生 JS 版）
// ===========================================================
function resetForm() {
  // 基本
  document.getElementById("p_name").value = "";
  document.getElementById("p_originPrice").value = "";
  document.getElementById("p_specialPrice").value = "";
  document.getElementById("p_specialFrom").value = "";
  document.getElementById("p_specialTo").value = "";

  const hasSpecial = document.getElementById("p_hasSpecial");
  const specialArea = document.getElementById("specialArea");
  if (hasSpecial) hasSpecial.checked = false;
  if (specialArea) {
    specialArea.style.opacity = "0.4";
    specialArea
      .querySelectorAll("input")
      .forEach((el) => (el.disabled = true));
  }

  const autoCancel = document.getElementById("p_autoCancelSpecial");
  const autoCancelThreshold = document.getElementById(
    "p_autoCancelSpecialThreshold"
  );
  if (autoCancel) autoCancel.checked = false;
  if (autoCancelThreshold) {
    autoCancelThreshold.value = "";
    autoCancelThreshold.disabled = true;
    autoCancelThreshold.style.opacity = "0.5";
  }

  document.getElementById("p_internalCompanyId").value = "";
  document.getElementById("p_sku").value = "";

  document.getElementById("p_imageUrl").value = "";
  const fileInput = document.getElementById("p_imageFile");
  if (fileInput) fileInput.value = "";
  const preview = document.getElementById("p_imagePreview");
  if (preview) {
    preview.src = "";
    preview.style.display = "none";
  }

  document.getElementById("p_images").value = "";

  document.getElementById("p_tag").value = "";
  document.getElementById("p_type").value = "normal";

  document.getElementById("p_stock").value = "";
  document.getElementById("p_minStock").value = "";
  document.getElementById("p_allowZeroStock").checked = true;

  // ✅ 整箱前台展示默认开启
  const boxVisibleEl = document.getElementById("p_boxVisibleOnFrontend");
  if (boxVisibleEl) boxVisibleEl.checked = true;

  // ⭐ 导航大类（你新加的字段）
  const topCat = document.getElementById("p_topCategoryKey");
  if (topCat) topCat.value = "";
  document.getElementById("p_category").value = "";
  document.getElementById("p_subCategory").value = "";
  document.getElementById("p_sortOrder").value = "";

  document.getElementById("p_isFlashDeal").checked = false;
  document.getElementById("p_isActive").checked = true;

  document.getElementById("p_activeFrom").value = "";
  document.getElementById("p_activeTo").value = "";

  document.getElementById("p_desc").value = "";

  // 清除当前编辑 ID
  currentEditingId = null;

  // 编辑提示更新
  const hint = document.getElementById("editHint");
  if (hint) hint.textContent = "当前模式：新增商品";

  const info = document.getElementById("currentEditingInfo");
  if (info) info.style.display = "none";

  // 进货面板锁定
  lockPurchasePanelNoProduct();

  console.log("表单已重置");
}

// ===========================================================
// 分类 datalist
// ===========================================================
function rebuildCategoryOptions() {
  const catList = document.getElementById("categoryList");
  const subList = document.getElementById("subCategoryList");
  if (!catList || !subList) return;

  const catSet = new Set(defaultCategories);
  const subSet = new Set(defaultSubCategories);

  productsCache.forEach((p) => {
    if (p.category) catSet.add(p.category);
    if (p.subCategory) subSet.add(p.subCategory);
  });

  catList.innerHTML = "";
  subList.innerHTML = "";

  catSet.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    catList.appendChild(opt);
  });
  subSet.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    subList.appendChild(opt);
  });
}

// ===========================================================
// Panel 显示、隐藏 + Tab 切换
// ===========================================================
function showEditorPanel() {
  const panel = document.getElementById("productEditorPanel");
  if (!panel) return;
  panel.style.display = "block";
  panel.scrollIntoView({ behavior: "smooth" });
}

function hideEditorPanel() {
  const panel = document.getElementById("productEditorPanel");
  if (panel) panel.style.display = "none";
  currentEditingId = null;

  const info = document.getElementById("currentEditingInfo");
  if (info) info.style.display = "none";

  resetForm();
  resetPurchaseForm();
  clearPurchaseBatchesTable();
}

function switchEditorTab(tab) {
  currentEditorTab = tab === "purchase" ? "purchase" : "basic";
  const basic = document.getElementById("editorTabBasic");
  const purchase = document.getElementById("editorTabPurchase");
  const btnBasic = document.getElementById("tabBtnBasic");
  const btnPurchase = document.getElementById("tabBtnPurchase");

  if (!basic || !purchase || !btnBasic || !btnPurchase) return;

  if (currentEditorTab === "basic") {
    basic.style.display = "block";
    purchase.style.display = "none";
    btnBasic.classList.add("active");
    btnPurchase.classList.remove("active");
  } else {
    basic.style.display = "none";
    purchase.style.display = "block";
    btnPurchase.classList.add("active");
    btnBasic.classList.remove("active");
  }
}

// ===========================================================
// 表格状态渲染
// ===========================================================
function renderStatus(p) {
  const now = new Date();
  const active = p.isActive !== false;
  const from = p.activeFrom ? new Date(p.activeFrom) : null;
  const to = p.activeTo ? new Date(p.activeTo) : null;

  if (!active || (p.status || "").toLowerCase() === "off") {
    return `<span class="admin-tag">已下架</span>`;
  }
  if (from && now < from) {
    return `<span class="admin-tag admin-tag-warning">待开始</span>`;
  }
  if (to && now > to) {
    return `<span class="admin-tag">已结束</span>`;
  }
  return `<span class="admin-tag admin-tag-success">上架中</span>`;
}

function renderType(type) {
  if (!type) return `<span class="type-pill">normal</span>`;
  return `<span class="type-pill">${type}</span>`;
}

function renderFlags(p) {
  const flags = [];
  if (p.isFamilyMustHave) flags.push("家庭必备");
  if (p.isBestSeller) flags.push("畅销");
  if (p.isNewArrival) flags.push("新品");

  if (!flags.length) return "—";
  return flags
    .map((f) => `<span class="tag-pill" style="margin-right:4px">${f}</span>`)
    .join("");
}

// ===========================================================
// 加载商品列表
// ===========================================================
async function loadProducts() {
  const tbody = document.getElementById("productTableBody");
  if (!tbody) return;

  const keyword = document.getElementById("searchKeyword").value.trim();
  const params = new URLSearchParams();
  if (keyword) params.append("keyword", keyword);

  tbody.innerHTML = `<tr><td colspan="11">正在加载商品...</td></tr>`;

  try {
    const res = await fetch("/api/admin/products?" + params.toString(), {
      cache: "no-store",
    });
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="11">加载失败：${
        data.message || "未知错误"
      }</td></tr>`;
      return;
    }

    const list = data.list || data.products || [];
    productsCache = list;
    rebuildCategoryOptions();

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="11">暂无商品，请点击上方「新增 / 编辑商品」</td></tr>`;
      document.getElementById("productSummary").textContent = "共 0 个商品";
      document.getElementById("productCountText").textContent = "共 0 条";
      return;
    }

    tbody.innerHTML = "";
    list.forEach((p) => {
      const imgHtml = p.image
        ? `<img src="${p.image}" style="height:40px;border-radius:6px;object-fit:cover;">`
        : `<span style="font-size:11px;color:#9ca3af">无</span>`;

      const rowId = String(p._id || p.id || "");

      tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.id || "—"}</td>
        <td>${imgHtml}</td>
        <td>${p.name || "—"}</td>
        <td>${p.category || "—"}</td>
        <td>${renderType(p.type)}</td>
        <td>
          ${p.tag ? `<span class="tag-pill">${p.tag}</span>` : ""}
          ${renderFlags(p)}
        </td>
        <td>${
          p.specialEnabled && p.specialPrice
            ? "￥" + Number(p.specialPrice).toFixed(2)
            : "—"
        }</td>
        <td>￥${Number(p.originPrice || 0).toFixed(2)}</td>
        <td>${p.stock || 0}</td>
        <td>${renderStatus(p)}</td>
        <td>
          <button class="admin-btn admin-btn-ghost" onclick="editProduct('${rowId}')">编辑</button>
          <button class="admin-btn admin-btn-ghost" onclick="toggleProductStatus('${rowId}','${p.status || "on"}')">
            ${(p.status || "on") === "off" ? "上架" : "下架"}
          </button>
          <button class="admin-btn admin-btn-ghost" onclick="goToPurchase('${rowId}')">进货/成本</button>
          <button class="admin-btn admin-btn-ghost" onclick="deleteProduct('${rowId}')">删除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("productSummary").textContent =
      "共 " + list.length + " 个商品";
    document.getElementById("productCountText").textContent =
      "共 " + list.length + " 条";
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11">请求失败，请检查 /api/admin/products</td></tr>`;
    console.error(err);
  }
}

// ===========================================================
// 保存商品（新增 / 编辑）
// ===========================================================
async function saveProduct() {
  const name = document.getElementById("p_name").value.trim();
  const originPriceRaw = document.getElementById("p_originPrice").value;

  const sku = document.getElementById("p_sku").value.trim();
  const internalCompanyId = document
    .getElementById("p_internalCompanyId")
    .value.trim();

  const tag = document.getElementById("p_tag").value.trim();
  const type = document.getElementById("p_type").value || "normal";
  const stock = document.getElementById("p_stock").value;
  const desc = document.getElementById("p_desc").value.trim();
  let image = document.getElementById("p_imageUrl").value.trim();

  const minStock = document.getElementById("p_minStock").value;
  const allowZeroStock = document.getElementById("p_allowZeroStock").checked;
  const boxVisibleOnFrontend =
    document.getElementById("p_boxVisibleOnFrontend")?.checked !== false;

  const topCategoryKey =
    document.getElementById("p_topCategoryKey").value || "";

  const category = document.getElementById("p_category").value;
  const subCategory = document.getElementById("p_subCategory").value.trim();
  const sortOrder = document.getElementById("p_sortOrder").value;

  const isFlashDeal = document.getElementById("p_isFlashDeal").checked;
  const isFamilyMustHave =
    document.getElementById("p_isFamilyMustHave").checked;
  const isBestSeller = document.getElementById("p_isBestSeller").checked;
  const isNewArrival = document.getElementById("p_isNewArrival").checked;

  const isActive = document.getElementById("p_isActive").checked;
  const activeFromVal = document.getElementById("p_activeFrom").value;
  const activeToVal = document.getElementById("p_activeTo").value;

  const imagesStr = document.getElementById("p_images").value.trim();
  const images = imagesStr
    ? imagesStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const hasSpecial = document.getElementById("p_hasSpecial").checked;
  const specialPriceRaw = document.getElementById("p_specialPrice").value;
  const specialFromVal = document.getElementById("p_specialFrom").value;
  const specialToVal = document.getElementById("p_specialTo").value;

  const autoCancelSpecial =
    document.getElementById("p_autoCancelSpecial").checked;
  const autoCancelSpecialThresholdRaw = document.getElementById(
    "p_autoCancelSpecialThreshold"
  ).value;
  const autoCancelSpecialThreshold =
    Number(autoCancelSpecialThresholdRaw) || 0;

  // 校验
  if (!name || !originPriceRaw) {
    alert("商品名称和原价必须填写");
    return;
  }

  const originPrice = Number(originPriceRaw);
  if (Number.isNaN(originPrice) || originPrice <= 0) {
    alert("原价必须是大于 0 的数字");
    return;
  }

  let specialPrice = null;
  if (hasSpecial) {
    if (!specialPriceRaw) {
      alert("启用特价后，特价金额必须填写");
      return;
    }
    specialPrice = Number(specialPriceRaw);
    if (specialPrice <= 0 || specialPrice >= originPrice) {
      alert("特价必须大于 0 且低于原价");
      return;
    }
  }

  if (autoCancelSpecial && autoCancelSpecialThreshold <= 0) {
    alert("库存低自动取消特价：阈值必须大于 0");
    return;
  }

  // ✅ 售价低于成本价提示
  const editingProduct = currentEditingId ? findProductAnyId(currentEditingId) : null;
  const currentCost =
    editingProduct && editingProduct.cost != null && editingProduct.cost !== ""
      ? Number(editingProduct.cost)
      : null;

  if (
    !confirmIfSellPriceBelowCost({
      originPrice,
      cost: currentCost,
    })
  ) {
    return;
  }

  // 图片上传（本地文件）
  const fileInput = document.getElementById("p_imageFile");
  const file = fileInput && fileInput.files[0];
  if (file) {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const up = await fetch("/api/admin/products/upload-image", {
        method: "POST",
        body: fd,
      });
      const upData = await up.json();
      if (!upData.success) {
        alert("图片上传失败：" + (upData.message || "未知错误"));
        return;
      }
      image = upData.url;
      document.getElementById("p_imageUrl").value = image;
    } catch (err) {
      console.error(err);
      alert("图片上传请求失败");
      return;
    }
  }

  // 数字字段统一转数字，避免字符串进库
  const stockNum = Number(stock);
  const minStockNum = Number(minStock);
  const sortOrderNum = Number(sortOrder);

  const body = {
    name,
    // 后端老版本用 price，这里兼容一下：
    price: hasSpecial && specialPrice ? specialPrice : originPrice,
    originPrice,
    sku,
    internalCompanyId,
    tag,
    type,
    stock: Number.isFinite(stockNum) && stockNum >= 0 ? stockNum : 0,
    desc,
    image,
    minStock: Number.isFinite(minStockNum) && minStockNum >= 0 ? minStockNum : 0,
    allowZeroStock,
    boxVisibleOnFrontend,
    // ⭐ 新增：首页导航大类
    topCategoryKey,
    category,
    subCategory,
    sortOrder: Number.isFinite(sortOrderNum) ? sortOrderNum : 0,
    isFlashDeal,
    isFamilyMustHave,
    isBestSeller,
    isNewArrival,
    isActive,
    activeFrom: activeFromVal ? new Date(activeFromVal).toISOString() : null,
    activeTo: activeToVal ? new Date(activeToVal).toISOString() : null,
    images,
    specialEnabled: hasSpecial,
    specialPrice,
    specialFrom: specialFromVal ? new Date(specialFromVal).toISOString() : null,
    specialTo: specialToVal ? new Date(specialToVal).toISOString() : null,
    autoCancelSpecialOnLowStock: autoCancelSpecial,
    autoCancelSpecialThreshold,
  };

  const isEdit = !!currentEditingId;

  try {
    const res = await fetch(
      isEdit
        ? "/api/admin/products/" + currentEditingId
        : "/api/admin/products",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json();
    if (!data.success) {
      alert("保存失败：" + (data.message || "未知错误"));
      return;
    }

    const saved = data.product || data;
    currentEditingId = saved._id || saved.id || currentEditingId;

    alert(isEdit ? "商品已更新" : "商品已新增");

    await loadProducts();
    bindPurchasePanelToProduct(saved);

    const hint = document.getElementById("editHint");
    if (hint)
      hint.textContent =
        "当前模式：编辑商品（ID = " + currentEditingId + "）";
    const btn = document.getElementById("btnSaveProduct");
    if (btn) btn.textContent = "💾 保存修改";
    const info = document.getElementById("currentEditingInfo");
    if (info) {
      info.textContent = "当前商品 ID：" + currentEditingId;
      info.style.display = "inline-flex";
    }
  } catch (err) {
    console.error(err);
    alert("请求失败，请检查 /api/admin/products 接口");
  }
}

// ===========================================================
// 编辑商品（列表按钮 / 进货按钮）
// ===========================================================
function editProduct(id, tab) {
  const p = findProductAnyId(id);
  if (!p) {
    alert("未找到商品：" + id);
    return;
  }

  currentEditingId = String(p._id || p.id || id || "");

  // 基本字段
  document.getElementById("p_name").value = p.name || "";
  document.getElementById("p_originPrice").value =
    p.originPrice != null ? p.originPrice : "";
  document.getElementById("p_tag").value = p.tag || "";
  document.getElementById("p_type").value = p.type || "normal";
  document.getElementById("p_stock").value =
    p.stock != null ? p.stock : "";
  document.getElementById("p_desc").value = p.desc || "";

  // 图片
  document.getElementById("p_imageUrl").value = p.image || "";
  const fileInput = document.getElementById("p_imageFile");
  if (fileInput) fileInput.value = "";
  const preview = document.getElementById("p_imagePreview");
  if (preview) {
    if (p.image) {
      preview.src = p.image;
      preview.style.display = "inline-block";
    } else {
      preview.src = "";
      preview.style.display = "none";
    }
  }

  // 内部信息
  document.getElementById("p_sku").value = p.sku || "";
  document.getElementById("p_internalCompanyId").value =
    p.internalCompanyId || "";
  document.getElementById("p_minStock").value =
    p.minStock != null ? p.minStock : "";
  document.getElementById("p_allowZeroStock").checked =
    p.allowZeroStock !== false;

  // ✅ 回填整箱前台展示
  const boxVisibleEl = document.getElementById("p_boxVisibleOnFrontend");
  if (boxVisibleEl) {
    boxVisibleEl.checked = p.boxVisibleOnFrontend !== false;
  }

  // 分类
  document.getElementById("p_topCategoryKey").value = p.topCategoryKey || "";
  document.getElementById("p_category").value = p.category || "";
  document.getElementById("p_subCategory").value = p.subCategory || "";
  document.getElementById("p_sortOrder").value =
    p.sortOrder != null ? p.sortOrder : "";

  // 前台展示标签
  document.getElementById("p_isFlashDeal").checked = !!p.isFlashDeal;
  document.getElementById("p_isFamilyMustHave").checked =
    !!p.isFamilyMustHave;
  document.getElementById("p_isBestSeller").checked = !!p.isBestSeller;
  document.getElementById("p_isNewArrival").checked = !!p.isNewArrival;

  // 上下架状态
  document.getElementById("p_isActive").checked =
    p.isActive !== false && (p.status || "on") !== "off";

  document.getElementById("p_activeFrom").value =
    toLocalInputValue(p.activeFrom);
  document.getElementById("p_activeTo").value =
    toLocalInputValue(p.activeTo);

  // 多图
  document.getElementById("p_images").value = Array.isArray(p.images)
    ? p.images.join(",")
    : "";

  // 特价
  document.getElementById("p_hasSpecial").checked = !!p.specialEnabled;
  document.getElementById("p_specialPrice").value =
    p.specialPrice != null ? p.specialPrice : "";
  document.getElementById("p_specialFrom").value =
    toLocalInputValue(p.specialFrom);
  document.getElementById("p_specialTo").value =
    toLocalInputValue(p.specialTo);
  updateSpecialArea();

  // 库存保护
  document.getElementById("p_autoCancelSpecial").checked =
    !!p.autoCancelSpecialOnLowStock;
  document.getElementById("p_autoCancelSpecialThreshold").value =
    p.autoCancelSpecialThreshold != null
      ? p.autoCancelSpecialThreshold
      : "";
  updateAutoCancelSpecialArea();

  // 顶部提示
  const hint = document.getElementById("editHint");
  if (hint) hint.textContent = "当前模式：编辑商品（ID = " + currentEditingId + "）";
  const btn = document.getElementById("btnSaveProduct");
  if (btn) btn.textContent = "💾 保存修改";
  const info = document.getElementById("currentEditingInfo");
  if (info) {
    info.textContent = "当前商品 ID：" + currentEditingId;
    info.style.display = "inline-flex";
  }

  // 绑定进货面板
  bindPurchasePanelToProduct(p);

  // tab 控制
  if (tab === "purchase") {
    switchEditorTab("purchase");
  } else {
    switchEditorTab("basic");
  }

  showEditorPanel();
}

// 从列表直接进入进货 tab
function goToPurchase(id) {
  editProduct(id, "purchase");
}

// ===========================================================
// 上下架切换
// ===========================================================
async function toggleProductStatus(id, currentStatus) {
  if (!id) return;

  const next =
    (currentStatus || "on") === "off" ? "on" : "off";
  const msg =
    next === "on"
      ? "确定要将该商品【上架】吗？"
      : "确定要将该商品【下架】吗？";

  if (!confirm(msg)) return;

  try {
    const res = await fetch(
      "/api/admin/products/" + id + "/toggle-status",
      { method: "PATCH" }
    );
    const data = await res.json();
    if (!data.success) {
      alert("切换状态失败：" + (data.message || "未知错误"));
      return;
    }
    loadProducts();
  } catch (err) {
    console.error(err);
    alert(
      "切换状态请求失败，请检查 /api/admin/products/:id/toggle-status 接口"
    );
  }
}

// ===========================================================
// 删除商品
// ===========================================================
async function deleteProduct(id) {
  if (!confirm("确定要删除这个商品吗？此操作会从数据库中删除，无法恢复。")) return;

  try {
    const res = await fetch("/api/admin/products/" + id, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!data.success) {
      alert("删除失败：" + (data.message || "未知错误"));
      return;
    }
    loadProducts();
  } catch (err) {
    console.error(err);
    alert("删除失败，请检查 /api/admin/products/:id DELETE 接口");
  }
}

// ===========================================================
// 特价 / 库存保护 UI 状态
// ===========================================================
function updateSpecialArea() {
  const hasSpecialEl = document.getElementById("p_hasSpecial");
  const area = document.getElementById("specialArea");
  if (!hasSpecialEl || !area) return;

  const enabled = hasSpecialEl.checked;
  area.style.opacity = enabled ? "1" : "0.4";
  area.querySelectorAll("input").forEach((input) => {
    input.disabled = !enabled;
  });
}

function updateAutoCancelSpecialArea() {
  const enableEl = document.getElementById("p_autoCancelSpecial");
  const thresholdEl = document.getElementById(
    "p_autoCancelSpecialThreshold"
  );
  if (!enableEl || !thresholdEl) return;

  const enabled = enableEl.checked;
  thresholdEl.disabled = !enabled;
  thresholdEl.style.opacity = enabled ? "1" : "0.5";
}

// ===========================================================
// 进货 / 成本管理：UI 绑定与重置
// ===========================================================
function lockPurchasePanelNoProduct() {
  const disabled = document.getElementById("purchaseDisabledHint");
  const enabled = document.getElementById("purchaseEnabledBox");
  const label = document.getElementById("purchaseProductLabel");
  if (disabled) disabled.style.display = "block";
  if (enabled) enabled.style.display = "none";
  if (label) label.textContent = "（未选择）";
}

function bindPurchasePanelToProduct(p) {
  const disabled = document.getElementById("purchaseDisabledHint");
  const enabled = document.getElementById("purchaseEnabledBox");
  const label = document.getElementById("purchaseProductLabel");

  const productId = String(p?._id || p?.id || "");
  if (!p || !productId) {
    lockPurchasePanelNoProduct();
    return;
  }
  if (disabled) disabled.style.display = "none";
  if (enabled) enabled.style.display = "block";
  if (label)
    label.textContent =
      (p.name || "未命名商品") + " （ID：" + (p.id || productId) + "）";

  loadPurchaseBatches(productId);
}

function resetPurchaseForm() {
  const ids = [
    "pb_supplierName",
    "pb_supplierCompanyId",
    "pb_boxPrice",
    "pb_boxCount",
    "pb_unitsPerBox",
    "pb_grossMarginPercent",
    "pb_expireAt",
    "pb_unitCost",
    "pb_totalUnits",
    "pb_totalCost",
    "pb_retailPrice",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const summary = document.getElementById("purchaseCalcSummary");
  if (summary) {
    summary.innerHTML =
      '输入整箱进价、箱数和每箱数量后，会自动计算：<br />单件成本、总件数、总成本和建议零售价。';
  }
}

function clearPurchaseBatchesTable() {
  const tbody = document.getElementById("purchaseBatchTableBody");
  if (!tbody) return;
  tbody.innerHTML =
    '<tr><td colspan="13" style="text-align:center;color:#6b7280;">当前暂无进货记录</td></tr>';
}

// ===========================================================
// 进货表单自动计算（成本 & 建议零售价）
// ===========================================================
function recalcPurchaseCalc() {
  const boxPrice =
    Number(document.getElementById("pb_boxPrice").value) || 0;
  const boxCount =
    Number(document.getElementById("pb_boxCount").value) || 0;
  const unitsPerBox =
    Number(document.getElementById("pb_unitsPerBox").value) || 0;
  const grossMarginPercent =
    Number(
      document.getElementById("pb_grossMarginPercent").value
    ) || 0;

  let unitCost = 0;
  let totalUnits = 0;
  let totalCost = 0;
  let retailPrice = 0;

  if (boxPrice > 0 && unitsPerBox > 0) {
    unitCost = boxPrice / unitsPerBox;
  }
  if (boxCount > 0 && unitsPerBox > 0) {
    totalUnits = boxCount * unitsPerBox;
  }
  if (boxPrice > 0 && boxCount > 0) {
    totalCost = boxPrice * boxCount;
  }
  if (
    unitCost > 0 &&
    grossMarginPercent > 0 &&
    grossMarginPercent < 100
  ) {
    const rate = grossMarginPercent / 100;
    retailPrice = unitCost / (1 - rate);
  } else if (unitCost > 0) {
    retailPrice = unitCost;
  }

  const unitCostFixed = unitCost ? unitCost.toFixed(4) : "";
  const totalUnitsFixed = totalUnits ? String(totalUnits) : "";
  const totalCostFixed = totalCost ? totalCost.toFixed(2) : "";
  const retailPriceFixed = retailPrice ? retailPrice.toFixed(2) : "";

  const unitCostInput = document.getElementById("pb_unitCost");
  const totalUnitsInput = document.getElementById("pb_totalUnits");
  const totalCostInput = document.getElementById("pb_totalCost");
  const retailInput = document.getElementById("pb_retailPrice");

  if (unitCostInput) unitCostInput.value = unitCostFixed;
  if (totalUnitsInput) totalUnitsInput.value = totalUnitsFixed;
  if (totalCostInput) totalCostInput.value = totalCostFixed;

  if (retailInput && retailInput.value === "") {
    retailInput.value = retailPriceFixed;
  }

  const summary = document.getElementById("purchaseCalcSummary");
  if (!summary) return;

  let summaryHtml = "";
  if (!boxPrice || !boxCount || !unitsPerBox) {
    summaryHtml =
      '输入整箱进价、箱数和每箱数量后，会自动计算：<br />单件成本、总件数、总成本和建议零售价。';
  } else {
    summaryHtml = `本批次共 <b>${totalUnitsFixed ||
      "-"}</b> 件，总成本约 <b>$${totalCostFixed ||
      "-"}</b>；<br/>单件成本约 <b>$${unitCostFixed ||
      "-"}</b>，按毛利 <b>${grossMarginPercent ||
      0}%</b> 建议零售价约为 <b>$${retailPriceFixed || "-"}</b>。`;
  }
  summary.innerHTML = summaryHtml;
}

// ===========================================================
// 加载进货批次列表
// ===========================================================
async function loadPurchaseBatches(productId) {
  const tbody = document.getElementById("purchaseBatchTableBody");
  if (!productId || !tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="13" style="text-align:center;color:#6b7280;">正在加载进货批次...</td></tr>';

  try {
    const res = await fetch(
      "/api/admin/products/" + productId + "/purchase-batches"
    );
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML =
        '<tr><td colspan="13" style="text-align:center;color:#f97373;">加载失败：' +
        (data.message || "未知错误") +
        "</td></tr>";
      return;
    }

    const list = data.batches || data.list || [];
    if (!list.length) {
      clearPurchaseBatchesTable();
      return;
    }

    tbody.innerHTML = "";
    list.forEach((b) => {
      const tr = document.createElement("tr");
      const createdStr = b.createdAt
        ? new Date(b.createdAt).toLocaleString()
        : "—";
      const expireStr = b.expireAt
        ? new Date(b.expireAt).toLocaleDateString()
        : "—";

      const boxPriceVal =
        typeof b.boxPrice === "number"
          ? b.boxPrice.toFixed(2)
          : b.boxPrice;
      const unitCostVal =
        typeof b.unitCost === "number"
          ? b.unitCost.toFixed(4)
          : b.unitCost;
      const totalCostVal =
        typeof b.totalCost === "number"
          ? b.totalCost.toFixed(2)
          : b.totalCost;
      const retailVal =
        typeof b.retailPrice === "number"
          ? b.retailPrice.toFixed(2)
          : b.retailPrice;

      tr.innerHTML = `
        <td>${createdStr}</td>
        <td>${b.supplierName || "—"}</td>
        <td>${b.supplierCompanyId || "—"}</td>
        <td>$${boxPriceVal || "0.00"}</td>
        <td>${b.boxCount || 0}</td>
        <td>${b.unitsPerBox || 0}</td>
        <td>${b.totalUnits || 0}</td>
        <td>$${unitCostVal || "0.0000"}</td>
        <td>$${totalCostVal || "0.00"}</td>
        <td>${b.grossMarginPercent || 0}%</td>
        <td>$${retailVal || "0.00"}</td>
        <td>${expireStr}</td>
        <td>${
          b.remainingUnits != null
            ? b.remainingUnits
            : b.totalUnits || 0
        }</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("加载进货批次出错:", err);
    tbody.innerHTML =
      '<tr><td colspan="13" style="text-align:center;color:#f97373;">请求失败</td></tr>';
  }
}

// ===========================================================
// 保存进货批次
// ===========================================================
async function savePurchaseBatch() {
  if (!currentEditingId) {
    alert("请先在「商品信息」里保存商品，再填写进货信息。");
    return;
  }

  const supplierName = document
    .getElementById("pb_supplierName")
    .value.trim();
  const supplierCompanyId = document
    .getElementById("pb_supplierCompanyId")
    .value.trim();
  const boxPrice =
    Number(document.getElementById("pb_boxPrice").value) || 0;
  const boxCount =
    Number(document.getElementById("pb_boxCount").value) || 0;
  const unitsPerBox =
    Number(document.getElementById("pb_unitsPerBox").value) || 0;
  const grossMarginPercent =
    Number(
      document.getElementById("pb_grossMarginPercent").value
    ) || 0;
  const expireAt =
    document.getElementById("pb_expireAt").value || null;
  const retailPriceManual =
    Number(document.getElementById("pb_retailPrice").value) || 0;

  if (!boxPrice || boxPrice <= 0) {
    alert("整箱进价必须大于 0");
    return;
  }
  if (!boxCount || boxCount <= 0) {
    alert("进货箱数必须大于 0");
    return;
  }
  if (!unitsPerBox || unitsPerBox <= 0) {
    alert("每箱几包必须大于 0");
    return;
  }

  const body = {
    supplierName,
    supplierCompanyId,
    boxPrice,
    boxCount,
    unitsPerBox,
    grossMarginPercent,
    expireAt,
    retailPrice: retailPriceManual,
  };

  try {
    const res = await fetch(
      "/api/admin/products/" + currentEditingId + "/purchase-batches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json();
    if (!data.success) {
      alert("保存进货批次失败：" + (data.message || "未知错误"));
      return;
    }

    alert("进货批次已保存并叠加到库存");

    await loadProducts();
    await loadPurchaseBatches(currentEditingId);

    if (data.product) {
      document.getElementById("p_stock").value =
        data.product.stock || 0;
      document.getElementById("p_originPrice").value =
        data.product.originPrice || "";
    }

    document.getElementById("pb_boxPrice").value = "";
    document.getElementById("pb_boxCount").value = "";
    document.getElementById("pb_unitsPerBox").value = "";
    document.getElementById("pb_unitCost").value = "";
    document.getElementById("pb_totalUnits").value = "";
    document.getElementById("pb_totalCost").value = "";
    document.getElementById("pb_retailPrice").value = "";

    recalcPurchaseCalc();
  } catch (err) {
    console.error("保存进货批次出错:", err);
    alert("保存进货批次请求失败");
  }
}

// ===========================================================
// DOMContentLoaded 初始化
// ===========================================================
window.addEventListener("DOMContentLoaded", () => {
  // 初次加载商品
  loadProducts();

  // 图片预览
  const fileInput = document.getElementById("p_imageFile");
  const previewImg = document.getElementById("p_imagePreview");
  if (fileInput && previewImg) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) {
        previewImg.style.display = "none";
        previewImg.src = "";
        return;
      }
      const url = URL.createObjectURL(file);
      previewImg.src = url;
      previewImg.style.display = "inline-block";
    });
  }

  // 顶部按钮
  const btnRefresh = document.getElementById("btnRefresh");
  if (btnRefresh) btnRefresh.addEventListener("click", loadProducts);

  const btnSaveProduct = document.getElementById("btnSaveProduct");
  if (btnSaveProduct) {
    btnSaveProduct.addEventListener("click", (e) => {
      e.preventDefault();
      saveProduct();
    });
  }

  const btnResetForm = document.getElementById("btnResetForm");
  if (btnResetForm) {
    btnResetForm.addEventListener("click", (e) => {
      e.preventDefault();
      resetForm();
    });
  }

  const btnOpenNewEditor = document.getElementById("btnOpenNewEditor");
  if (btnOpenNewEditor) {
    btnOpenNewEditor.addEventListener("click", () => {
      resetForm();
      switchEditorTab("basic");
      showEditorPanel();
    });
  }

  const btnCloseEditor = document.getElementById("btnCloseEditor");
  if (btnCloseEditor) {
    btnCloseEditor.addEventListener("click", hideEditorPanel);
  }

  // 搜索回车
  const searchKeyword = document.getElementById("searchKeyword");
  if (searchKeyword) {
    searchKeyword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadProducts();
    });
  }

  // 特价 & 库存保护开关
  const hasSpecialEl = document.getElementById("p_hasSpecial");
  if (hasSpecialEl) {
    hasSpecialEl.addEventListener("change", updateSpecialArea);
  }
  updateSpecialArea();

  const autoCancelEl = document.getElementById("p_autoCancelSpecial");
  if (autoCancelEl) {
    autoCancelEl.addEventListener("change", updateAutoCancelSpecialArea);
  }
  updateAutoCancelSpecialArea();

  // tab 切换
  const tabBtnBasic = document.getElementById("tabBtnBasic");
  if (tabBtnBasic) {
    tabBtnBasic.addEventListener("click", () => {
      switchEditorTab("basic");
    });
  }

  const tabBtnPurchase = document.getElementById("tabBtnPurchase");
  if (tabBtnPurchase) {
    tabBtnPurchase.addEventListener("click", () => {
      switchEditorTab("purchase");
    });
  }

  // 进货表单实时计算
  ["pb_boxPrice", "pb_boxCount", "pb_unitsPerBox", "pb_grossMarginPercent"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", recalcPurchaseCalc);
    }
  );

  const btnSavePurchaseBatch = document.getElementById("btnSavePurchaseBatch");
  if (btnSavePurchaseBatch) {
    btnSavePurchaseBatch.addEventListener("click", (e) => {
      e.preventDefault();
      savePurchaseBatch();
    });
  }

  const btnResetPurchaseForm = document.getElementById("btnResetPurchaseForm");
  if (btnResetPurchaseForm) {
    btnResetPurchaseForm.addEventListener("click", (e) => {
      e.preventDefault();
      resetPurchaseForm();
    });
  }

  // 初始锁定进货面板
  lockPurchasePanelNoProduct();
});

// ===========================================================
// 暴露给 HTML onclick 的函数
// ===========================================================
window.editProduct = editProduct;
window.goToPurchase = goToPurchase;
window.toggleProductStatus = toggleProductStatus;
window.deleteProduct = deleteProduct;