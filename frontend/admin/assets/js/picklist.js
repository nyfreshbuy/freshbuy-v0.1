// 区域团拼单配货汇总：本周 / 上周，每个商品总下单量 + 金额

let currentPicklist = [];

// 初始化筛选下拉
function initPicklistFilters() {
  const zoneSelect = document.getElementById("picklistZone");
  const weekSelect = document.getElementById("picklistWeek");
  if (!zoneSelect || !weekSelect) return;

  // 区域（你之后可以改成从后端拉 /api/admin/zones）
  const zones = [
    { id: "", name: "全部区域" },
    { id: "zone_freshmeadows", name: "Fresh Meadows 区域团" },
    { id: "zone_flushing", name: "Flushing 区域团" },
    { id: "zone_bayside", name: "Bayside 区域团" },
  ];
  zoneSelect.innerHTML = "";
  zones.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z.id;
    opt.textContent = z.name;
    zoneSelect.appendChild(opt);
  });

  // 周次：本周截单 / 上周截单
  const weeks = [
    { value: "current", label: "本周截单" },
    { value: "last", label: "上周截单" },
  ];
  weekSelect.innerHTML = "";
  weeks.forEach((w) => {
    const opt = document.createElement("option");
    opt.value = w.value;
    opt.textContent = w.label;
    weekSelect.appendChild(opt);
  });

  // 默认：本周 + 全部区域
  weekSelect.value = "current";
  zoneSelect.value = "";
}

// 渲染表格
function renderPicklistTable() {
  const tbody = document.getElementById("picklistTbody");
  const infoSpan = document.getElementById("picklistInfo");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!currentPicklist.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.style.textAlign = "center";
    td.textContent = "暂无配货数据";
    tr.appendChild(td);
    tbody.appendChild(tr);

    if (infoSpan) {
      infoSpan.textContent = "暂无区域团订单数据";
    }
    return;
  }

  let totalQty = 0;
  let totalAmount = 0;

  currentPicklist.forEach((row) => {
    const tr = document.createElement("tr");
    const qty = Number(row.totalQty || 0);
    const amount = Number(row.totalAmount || 0);

    totalQty += qty;
    totalAmount += amount;

    tr.innerHTML = `
      <td>${row.productId || ""}</td>
      <td>${row.name || ""}</td>
      <td>${row.spec || ""}</td>
      <td>${row.unit || ""}</td>
      <td>${qty}</td>
      <td>$${amount.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });

  if (infoSpan) {
    infoSpan.textContent = `共 ${currentPicklist.length} 个商品 · 总数量 ${totalQty} · 预估金额 $${totalAmount.toFixed(
      2
    )}`;
  }
}

// 加载配货数据
async function loadPicklist() {
  const tbody = document.getElementById("picklistTbody");
  const infoSpan = document.getElementById("picklistInfo");
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;">正在加载...</td></tr>';
  }
  if (infoSpan) {
    infoSpan.textContent = "正在统计区域团拼单订单...";
  }

  const zone = document.getElementById("picklistZone")?.value || "";
  const week = document.getElementById("picklistWeek")?.value || "current";

  const params = new URLSearchParams();
  if (zone) params.append("zone", zone);
  if (week) params.append("week", week);

  try {
    const token = localStorage.getItem("adminToken");
    const res = await fetch(`/api/admin/orders/picklist?${params.toString()}`, {
      headers: token
        ? {
            Authorization: "Bearer " + token,
          }
        : {},
    });

    const data = await res.json();

    // 兼容：[{...}] 或 {success:true,items:[...]}
    let items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data.success && Array.isArray(data.items)) {
      items = data.items;
    } else if (Array.isArray(data.items)) {
      items = data.items;
    } else {
      console.warn("配货接口返回格式不符合预期:", data);
      items = [];
    }

    // 做一层兜底：如果后端只是回订单明细，这里也可以前端再汇总一次
    if (items.length && !("totalQty" in items[0])) {
      const map = new Map();
      items.forEach((order) => {
        (order.items || order.orderItems || []).forEach((it) => {
          const key = it.productId || it.product_id || it.name;
          if (!key) return;
          if (!map.has(key)) {
            map.set(key, {
              productId: it.productId || it.product_id || "",
              name: it.name || it.productName || "",
              spec: it.spec || "",
              unit: it.unit || "",
              totalQty: 0,
              totalAmount: 0,
            });
          }
          const row = map.get(key);
          const qty = Number(it.qty || it.quantity || 0);
          const price = Number(it.price || it.unitPrice || 0);
          row.totalQty += qty;
          row.totalAmount += qty * price;
        });
      });
      currentPicklist = Array.from(map.values());
    } else {
      currentPicklist = items.map((x) => ({
        productId: x.productId || x.id || "",
        name: x.name || "",
        spec: x.spec || "",
        unit: x.unit || "",
        totalQty: Number(x.totalQty || 0),
        totalAmount: Number(x.totalAmount || 0),
      }));
    }

    renderPicklistTable();
  } catch (err) {
    console.error("加载配货数据失败:", err);
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:#fca5a5;">加载失败，请稍后重试</td></tr>';
    }
    if (infoSpan) {
      infoSpan.textContent = "加载失败";
    }
  }
}

// 打印配货单
function printPicklist() {
  if (!currentPicklist.length) {
    alert("当前没有可打印的配货数据");
    return;
  }

  const rowsHtml = currentPicklist
    .map((row) => {
      const qty = Number(row.totalQty || 0);
      const amount = Number(row.totalAmount || 0);
      return `
        <tr>
          <td>${row.productId || ""}</td>
          <td>${row.name || ""}</td>
          <td>${row.spec || ""}</td>
          <td>${row.unit || ""}</td>
          <td>${qty}</td>
          <td>$${amount.toFixed(2)}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>区域团拼单配货单</title>
        <style>
          body {
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
            padding: 16px;
            color: #111827;
          }
          h3 { margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h3>在鲜购拼好货 · 区域团拼单配货单</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 120px">商品ID</th>
              <th>商品名称</th>
              <th style="width: 120px">规格</th>
              <th style="width: 80px">单位</th>
              <th style="width: 100px">总数量</th>
              <th style="width: 120px">预估金额</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) {
    alert("浏览器拦截了打印窗口，请允许弹窗后重试");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}

// 事件绑定
window.addEventListener("DOMContentLoaded", () => {
  initPicklistFilters();
  loadPicklist();

  const zoneSelect = document.getElementById("picklistZone");
  const weekSelect = document.getElementById("picklistWeek");
  const btnRefresh = document.getElementById("btnRefreshPicklist");
  const btnPrint = document.getElementById("btnPrintPicklist");

  if (zoneSelect) {
    zoneSelect.addEventListener("change", loadPicklist);
  }
  if (weekSelect) {
    weekSelect.addEventListener("change", loadPicklist);
  }
  if (btnRefresh) {
    btnRefresh.addEventListener("click", loadPicklist);
  }
  if (btnPrint) {
    btnPrint.addEventListener("click", printPicklist);
  }
});
