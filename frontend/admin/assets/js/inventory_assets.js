// frontend/admin/assets/js/inventory_assets.js
(function () {
  const $ = (id) => document.getElementById(id);

  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function money(v) {
    return "$" + safeNum(v).toFixed(2);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  function fmtDate(v) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function setLoading(loading) {
    const root = $("inventoryAssetsPage");
    if (!root) return;
    root.classList.toggle("loading", !!loading);
  }

  async function getJSON(url) {
    const res = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("接口返回不是有效 JSON：" + url);
    }

    if (!res.ok || data?.success === false) {
      throw new Error(data?.message || `请求失败：${res.status}`);
    }

    return data;
  }

  function applyViewMode() {
    const mode = $("viewMode")?.value || "all";
    const productsPanel = $("productsPanel");
    const batchesPanel = $("batchesPanel");

    if (!productsPanel || !batchesPanel) return;

    if (mode === "products") {
      productsPanel.style.display = "";
      batchesPanel.style.display = "none";
    } else if (mode === "batches") {
      productsPanel.style.display = "none";
      batchesPanel.style.display = "";
    } else {
      productsPanel.style.display = "";
      batchesPanel.style.display = "";
    }
  }

  function getKeyword() {
    return ($("keyword")?.value || "").trim().toLowerCase();
  }

  function filterProducts(list) {
    const kw = getKeyword();
    if (!kw) return list;

    return list.filter((it) => {
      const name = String(it?.name || "").toLowerCase();
      const sku = String(it?.sku || "").toLowerCase();
      return name.includes(kw) || sku.includes(kw);
    });
  }

  function filterBatches(list) {
    const kw = getKeyword();
    if (!kw) return list;

    return list.filter((it) => {
      const name = String(it?.name || "").toLowerCase();
      const sku = String(it?.sku || "").toLowerCase();
      const supplierName = String(it?.supplierName || "").toLowerCase();
      const batchNo = String(it?.batchNo || "").toLowerCase();
      return (
        name.includes(kw) ||
        sku.includes(kw) ||
        supplierName.includes(kw) ||
        batchNo.includes(kw)
      );
    });
  }

  function renderSummary(summary, products, batches) {
    const d = summary?.data || {};
    $("kpiTotalQty").textContent = String(safeNum(d.totalQty));
    $("kpiTotalAsset").textContent = money(d.totalAsset);
    $("kpiBatchCount").textContent = String(safeNum(d.batchCount));
    $("kpiProductCount").textContent = String(Array.isArray(products) ? products.length : 0);
  }

  function renderProducts(rawList) {
    const list = filterProducts(Array.isArray(rawList) ? rawList : []);
    const tbody = $("productsTbody");

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">暂无商品库存资产数据</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(it.name || "-")}</td>
        <td>${esc(it.sku || "-")}</td>
        <td class="num">${safeNum(it.qty)}</td>
        <td class="num">${money(it.asset)}</td>
      </tr>
    `).join("");
  }

  function renderBatches(rawList) {
    const list = filterBatches(Array.isArray(rawList) ? rawList : []);
    const tbody = $("batchesTbody");

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">暂无批次库存资产数据</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(it.name || "-")}</td>
        <td>${esc(it.sku || "-")}</td>
        <td>${esc(it.batchNo || "-")}</td>
        <td>${esc(it.supplierName || "-")}</td>
        <td>${fmtDate(it.purchaseDate)}</td>
        <td class="num">${safeNum(it.remainingUnits)}</td>
        <td class="num">${money(it.unitCost)}</td>
        <td class="num">${money(it.asset)}</td>
      </tr>
    `).join("");
  }

  async function loadAll() {
    setLoading(true);

    try {
      const [summaryRes, productsRes, batchesRes] = await Promise.all([
        getJSON("/api/admin/inventory/assets/summary"),
        getJSON("/api/admin/inventory/assets/products"),
        getJSON("/api/admin/inventory/assets/batches"),
      ]);

      const products = Array.isArray(productsRes?.data) ? productsRes.data : [];
      const batches = Array.isArray(batchesRes?.data) ? batchesRes.data : [];

      renderSummary(summaryRes, products, batches);
      renderProducts(products);
      renderBatches(batches);
      applyViewMode();
    } catch (err) {
      console.error("库存净资产页面加载失败：", err);
      alert(err.message || "库存净资产页面加载失败");
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    if ($("keyword")) $("keyword").value = "";
    if ($("viewMode")) $("viewMode").value = "all";
    applyViewMode();
  }

  function bindEvents() {
    $("btnLoad")?.addEventListener("click", loadAll);

    $("btnReset")?.addEventListener("click", () => {
      resetFilters();
      loadAll();
    });

    $("viewMode")?.addEventListener("change", applyViewMode);

    $("keyword")?.addEventListener("input", () => {
      loadAll();
    });
  }

  function init() {
    bindEvents();
    loadAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();