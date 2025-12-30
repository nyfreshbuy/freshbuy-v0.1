// frontend/admin/dashboard.js

// ===== 小工具：时间 & 金额格式化 =====
function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function money(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0.00";
  return "$" + Number(n).toFixed(2);
}

function statusText(status) {
  if (status === "done") return "已完成";
  if (status === "pending") return "待处理";
  return "未知";
}

function modeShort(mode) {
  if (mode === "single") return "普通";
  if (mode === "friend") return "好友拼单";
  if (mode === "area") return "区域团购";
  if (mode === "pickup") return "自提点";
  return "-";
}

function shippingModeText(mode, groupSize) {
  if (mode === "single") return "普通配送：一户一单，当前示例运费固定 4.99。";
  if (mode === "friend")
    return `好友拼单：${groupSize || 2} 人同一地址拼运费，用来测试「拼的是运费」玩法。`;
  if (mode === "area")
    return "区域团购：同一小区集中发车，一趟送完，当前测试期可设为免运费。";
  if (mode === "pickup")
    return "自提点：团长自提，平台收取少量服务费（例如 0.99 / 单）。";
  return "-";
}

// ===== TAB 切换 =====
function initTabs() {
  const navItems = document.querySelectorAll(".nav-item");
  const tabPanels = document.querySelectorAll(".tab-panel");

  function activateTab(tabName) {
    navItems.forEach((item) => {
      item.classList.toggle(
        "active",
        item.getAttribute("data-tab") === tabName
      );
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${tabName}`);
    });
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const tab = item.getAttribute("data-tab");
      activateTab(tab);

      if (tab === "dashboard") loadDashboardStats();
      if (tab === "products") loadProducts();
      if (tab === "orders") loadOrders();
    });
  });

  // 仪表盘 “去订单管理”
  document.querySelectorAll("[data-tab-jump='orders']").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateTab("orders");
      loadOrders();
    });
  });
}

// ===== 仪表盘 =====
async function loadDashboardStats() {
  try {
    const res = await fetch("/api/admin/stats");
    if (!res.ok) throw new Error("stats 请求失败");
    const data = await res.json();

    document.getElementById("statTodayOrders").textContent =
      data.todayOrders ?? 0;
    document.getElementById("statTodayOrdersDesc").textContent =
      (data.todayOrders || 0) > 0
        ? "已产生测试订单，可以用来估算毛利结构。"
        : "今日暂无订单记录";

    document.getElementById("statTodayGMV").textContent = money(data.todayGMV);
    document.getElementById("statTodayGMVDesc").textContent =
      "包含商品小计 + 运费，仅用于结构分析";

    document.getElementById("statGrossProfit").textContent = money(
      data.todayGrossProfit
    );
    document.getElementById("statGrossProfitDesc").textContent =
      "后端可配置统一毛利率做粗略估算";

    const mix = data.shippingMix || {};
    const mixText = `普通：${mix.single || 0} · 拼单：${mix.friend || 0} · 区域：${
      mix.area || 0
    } · 自提：${mix.pickup || 0}`;
    document.getElementById("statShippingMix").textContent = mixText;

    renderDashboardRecentOrders(data.recentOrders || []);
  } catch (err) {
    console.warn("loadDashboardStats 出错:", err);
    renderDashboardRecentOrders([]);
  }
}

function renderDashboardRecentOrders(list) {
  const tbody = document.getElementById("dashboardRecentOrdersBody");
  tbody.innerHTML = "";

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td colspan="7" class="text-center text-muted">暂无订单记录</td>';
    tbody.appendChild(tr);
    return;
  }

  list.forEach((o) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${o.orderId}</td>
      <td>${formatTime(o.createdAt)}</td>
      <td><span class="badge shipping">${modeShort(o.shippingMode)}</span></td>
      <td class="text-right">${money(o.subtotal)}</td>
      <td class="text-right">${money(o.shipping)}</td>
      <td class="text-right">${money(o.total)}</td>
      <td class="text-center">
        <span class="badge ${
          o.status === "done"
            ? "success"
            : o.status === "pending"
            ? "warning"
            : "gray"
        }">
          ${statusText(o.status)}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ===== 商品管理 =====
let editingProductId = null;

async function loadProducts() {
  const tbody = document.getElementById("productsTableBody");
  tbody.innerHTML =
    '<tr><td colspan="6" class="text-center text-muted">加载中...</td></tr>';

  try {
    const res = await fetch("/api/admin/products");
    if (!res.ok) throw new Error("产品请求失败");
    const products = await res.json();

    if (!Array.isArray(products) || !products.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-center text-muted">暂无商品，请先在上方新增</td></tr>';
      return;
    }

    tbody.innerHTML = "";
    products.forEach((p) => {
      const tr = document.createElement("tr");
      const labelsText = Array.isArray(p.labels) ? p.labels.join(" / ") : "";
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>
          <span class="badge ${
            p.type === "hot" ? "warning" : "gray"
          }">${p.type || "normal"}</span>
        </td>
        <td>${p.tag || ""}${labelsText ? " · " + labelsText : ""}</td>
        <td class="text-right">${money(p.price)}</td>
        <td class="text-right">${
          p.originPrice ? money(p.originPrice) : "-"
        }</td>
        <td class="text-center">
          <button class="btn btn-sm" data-edit-id="${p.id}">编辑</button>
          <button class="btn btn-sm" data-del-id="${p.id}">删除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("[data-edit-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-edit-id");
        const product = products.find((p) => p.id === id);
        if (product) fillProductForm(product);
      });
    });

    tbody.querySelectorAll("[data-del-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del-id");
        if (!confirm("确定要删除这个商品吗？")) return;
        await deleteProduct(id);
        loadProducts();
      });
    });
  } catch (err) {
    console.error("loadProducts 出错:", err);
    tbody.innerHTML =
      '<tr><td colspan="6" class="text-center text-muted">加载失败，请检查 /api/admin/products</td></tr>';
  }
}

function fillProductForm(p) {
  editingProductId = p.id;
  document.getElementById("productFormTitle").textContent =
    "编辑商品：" + p.name;

  document.getElementById("prodId").value = p.id;
  document.getElementById("prodName").value = p.name || "";
  document.getElementById("prodPrice").value = p.price ?? "";
  document.getElementById("prodOriginPrice").value = p.originPrice ?? "";
  document.getElementById("prodTag").value = p.tag || "";
  document.getElementById("prodType").value = p.type || "normal";
  document.getElementById("prodDesc").value = p.desc || "";

  const labelsInput = document.getElementById("prodLabels");
  labelsInput.value = Array.isArray(p.labels) ? p.labels.join(",") : "";
}

async function deleteProduct(id) {
  try {
    const res = await fetch(`/api/admin/products/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("删除失败");
  } catch (err) {
    console.error("deleteProduct 出错:", err);
    alert("删除失败，请检查 /api/admin/products/:id");
  }
}

function clearProductForm() {
  editingProductId = null;
  document.getElementById("productFormTitle").textContent = "新增商品";
  document.getElementById("prodId").value = "";
  document.getElementById("prodName").value = "";
  document.getElementById("prodPrice").value = "";
  document.getElementById("prodOriginPrice").value = "";
  document.getElementById("prodTag").value = "";
  document.getElementById("prodType").value = "normal";
  document.getElementById("prodDesc").value = "";
  document.getElementById("prodLabels").value = "";
}

function initProductForm() {
  document
    .getElementById("productForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const payload = {
        id: document.getElementById("prodId").value || undefined,
        name: document.getElementById("prodName").value.trim(),
        price: parseFloat(document.getElementById("prodPrice").value || "0"),
        originPrice: parseFloat(
          document.getElementById("prodOriginPrice").value || "0"
        ),
        tag: document.getElementById("prodTag").value.trim(),
        type: document.getElementById("prodType").value,
        desc: document.getElementById("prodDesc").value.trim(),
        labels: document
          .getElementById("prodLabels")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      try {
        let url = "/api/admin/products";
        let method = "POST";
        if (editingProductId) {
          url = `/api/admin/products/${encodeURIComponent(editingProductId)}`;
          method = "PUT";
        }
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("保存失败");
        clearProductForm();
        loadProducts();
      } catch (err) {
        console.error("保存商品失败:", err);
        alert("保存商品失败，请检查 /api/admin/products 后端");
      }
    });

  document
    .getElementById("btnProductFormClear")
    .addEventListener("click", () => clearProductForm());

  document.getElementById("btnProductNew").addEventListener("click", () => {
    clearProductForm();
  });

  document
    .getElementById("btnProductReset")
    .addEventListener("click", async () => {
      if (!confirm("确定要重置为默认商品？这会清掉当前自定义列表。")) return;
      try {
        const res = await fetch("/api/admin/products/reset", {
          method: "POST",
        });
        if (!res.ok) throw new Error("重置失败");
        loadProducts();
      } catch (err) {
        console.error("重置商品失败:", err);
        alert("重置失败，请检查 /api/admin/products/reset");
      }
    });
}

// ===== 订单管理 =====
let currentOrderStatusFilter = "all";

async function loadOrders() {
  const tbody = document.getElementById("ordersTableBody");
  tbody.innerHTML =
    '<tr><td colspan="7" class="text-center text-muted">加载中...</td></tr>';

  try {
    const res = await fetch(
      `/api/admin/orders?status=${encodeURIComponent(currentOrderStatusFilter)}`
    );
    if (!res.ok) throw new Error("订单请求失败");
    const data = await res.json();
    const orders = Array.isArray(data) ? data : data.orders || [];
    renderOrdersTable(orders);
  } catch (err) {
    console.error("loadOrders 出错:", err);
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center text-muted">加载失败，请检查 /api/admin/orders</td></tr>';
    renderOrderDetail(null);
  }
}

function renderOrdersTable(list) {
  const tbody = document.getElementById("ordersTableBody");
  tbody.innerHTML = "";

  if (!list.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center text-muted">暂无订单</td></tr>';
    renderOrderDetail(null);
    return;
  }

  list.forEach((o, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${o.orderId}</td>
      <td>${formatTime(o.createdAt)}</td>
      <td><span class="badge shipping">${modeShort(o.shippingMode)}</span></td>
      <td class="text-right">${money(o.subtotal)}</td>
      <td class="text-right">${money(o.shipping)}</td>
      <td class="text-right">${money(o.total)}</td>
      <td class="text-center">
        <span class="badge ${
          o.status === "done"
            ? "success"
            : o.status === "pending"
            ? "warning"
            : "gray"
        }">
          ${statusText(o.status)}
        </span>
      </td>
    `;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => {
      renderOrderDetail(o);
    });

    if (idx === 0) {
      renderOrderDetail(o);
    }

    tbody.appendChild(tr);
  });
}

function renderOrderDetail(order) {
  const idEl = document.getElementById("detailOrderId");
  const timeEl = document.getElementById("detailOrderTime");
  const statusBadge = document.getElementById("detailOrderStatusBadge");
  const itemsEl = document.getElementById("detailOrderItems");
  const summaryEl = document.getElementById("detailOrderSummary");
  const shippingTextEl = document.getElementById("detailShippingText");

  if (!order) {
    idEl.textContent = "未选中订单";
    timeEl.textContent = "请选择左侧一行订单";
    statusBadge.textContent = "-";
    statusBadge.className = "badge gray";
    itemsEl.innerHTML = "";
    summaryEl.innerHTML =
      '<div class="text-xs text-muted">商品小计 / 运费 / 总额 会显示在这里。</div>';
    shippingTextEl.textContent = "-";
    return;
  }

  idEl.textContent = order.orderId;
  timeEl.textContent = `下单时间：${formatTime(order.createdAt)}`;
  statusBadge.textContent = statusText(order.status);
  statusBadge.className =
    "badge " +
    (order.status === "done"
      ? "success"
      : order.status === "pending"
      ? "warning"
      : "gray");

  const items = order.items || [];
  itemsEl.innerHTML = "";
  if (!items.length) {
    itemsEl.innerHTML =
      '<div class="text-xs text-muted">该订单没有明细（可能是测试数据结构）</div>';
  } else {
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "order-detail-items-row";
      row.innerHTML = `
        <div>${it.name} × ${it.qty}</div>
        <div>${money(it.lineTotal || it.price * it.qty)}</div>
      `;
      itemsEl.appendChild(row);
    });
  }

  summaryEl.innerHTML = `
    <div class="order-detail-items-row">
      <div class="text-xs text-muted">商品小计</div>
      <div>${money(order.subtotal)}</div>
    </div>
    <div class="order-detail-items-row">
      <div class="text-xs text-muted">运费</div>
      <div>${money(order.shipping)}</div>
    </div>
    <div class="order-detail-items-row">
      <div class="text-xs text-muted">订单总额</div>
      <div class="text-green">${money(order.total)}</div>
    </div>
  `;

  shippingTextEl.textContent = shippingModeText(
    order.shippingMode,
    order.groupSize
  );
}

function initOrdersFilters() {
  const btns = document.querySelectorAll("[data-order-status]");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentOrderStatusFilter = btn.getAttribute("data-order-status") || "all";
      loadOrders();
    });
  });

  document
    .getElementById("btnOrdersRefresh")
    .addEventListener("click", () => loadOrders());
}

// ===== 运费配置弹窗 =====
function openShippingModal() {
  const backdrop = document.getElementById("shippingModalBackdrop");
  backdrop.classList.add("active");
  loadShippingConfig();
}

function closeShippingModal() {
  const backdrop = document.getElementById("shippingModalBackdrop");
  backdrop.classList.remove("active");
}

async function loadShippingConfig() {
  try {
    const res = await fetch("/api/admin/shipping-config");
    if (!res.ok) throw new Error("运费配置请求失败");
    const cfg = await res.json();
    document.getElementById("shipSingleFee").value = cfg.singleFee ?? 4.99;
    document.getElementById("shipFriend2").value = cfg.friend2 ?? 2.5;
    document.getElementById("shipFriend3").value = cfg.friend3 ?? 2.0;
    document.getElementById("shipFriend4").value = cfg.friend4 ?? 1.5;
    document.getElementById("shipArea").value = cfg.areaFee ?? 0;
    document.getElementById("shipPickup").value = cfg.pickupFee ?? 0.99;
  } catch (err) {
    console.warn("loadShippingConfig 出错:", err);
    // 用默认值兜底
    document.getElementById("shipSingleFee").value = 4.99;
    document.getElementById("shipFriend2").value = 2.5;
    document.getElementById("shipFriend3").value = 2.0;
    document.getElementById("shipFriend4").value = 1.5;
    document.getElementById("shipArea").value = 0;
    document.getElementById("shipPickup").value = 0.99;
  }
}

async function saveShippingConfig() {
  const payload = {
    singleFee: parseFloat(
      document.getElementById("shipSingleFee").value || "4.99"
    ),
    friend2: parseFloat(
      document.getElementById("shipFriend2").value || "2.5"
    ),
    friend3: parseFloat(
      document.getElementById("shipFriend3").value || "2.0"
    ),
    friend4: parseFloat(
      document.getElementById("shipFriend4").value || "1.5"
    ),
    areaFee: parseFloat(document.getElementById("shipArea").value || "0"),
    pickupFee: parseFloat(
      document.getElementById("shipPickup").value || "0.99"
    ),
  };

  try {
    const res = await fetch("/api/admin/shipping-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("保存运费失败");
    alert("运费配置已保存（测试环境）");
    closeShippingModal();
  } catch (err) {
    console.error("saveShippingConfig 出错:", err);
    alert("保存运费失败，请检查 /api/admin/shipping-config");
  }
}

function resetShippingDefault() {
  document.getElementById("shipSingleFee").value = 4.99;
  document.getElementById("shipFriend2").value = 2.5;
  document.getElementById("shipFriend3").value = 2.0;
  document.getElementById("shipFriend4").value = 1.5;
  document.getElementById("shipArea").value = 0;
  document.getElementById("shipPickup").value = 0.99;
}

function initShippingModal() {
  document
    .getElementById("btnOpenShippingModal")
    .addEventListener("click", () => openShippingModal());
  document
    .getElementById("btnCloseShippingModal")
    .addEventListener("click", () => closeShippingModal());
  document
    .getElementById("btnShippingSave")
    .addEventListener("click", () => saveShippingConfig());
  document
    .getElementById("btnShippingReset")
    .addEventListener("click", () => resetShippingDefault());

  // 点击遮罩关闭（只点空白区域才关）
  const backdrop = document.getElementById("shippingModalBackdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeShippingModal();
    }
  });
}

// ===== 全局初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initProductForm();
  initOrdersFilters();
  initShippingModal();

  const btnRefreshAll = document.getElementById("btnRefreshAll");
  if (btnRefreshAll) {
    btnRefreshAll.addEventListener("click", () => {
      loadDashboardStats();
      loadProducts();
      loadOrders();
    });
  }

  // 默认加载仪表盘
  loadDashboardStats();
});
