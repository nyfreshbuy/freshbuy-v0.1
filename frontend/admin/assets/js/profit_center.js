// frontend/admin/assets/js/profit_center.js
(function () {
  const $ = (id) => document.getElementById(id);

  function money(v) {
    const n = Number(v || 0);
    return "$" + n.toFixed(2);
  }

  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
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

  function setLoading(loading) {
    const root = $("profitPage");
    if (!root) return;
    root.classList.toggle("loading", !!loading);
  }

  function getRangeParams() {
    const startDate = ($("startDate")?.value || "").trim();
    const endDate = ($("endDate")?.value || "").trim();
    const p = new URLSearchParams();

    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);

    return p;
  }

  function updateRangeBadge() {
    const startDate = ($("startDate")?.value || "").trim();
    const endDate = ($("endDate")?.value || "").trim();
    const quick = $("quickRange")?.value || "";

    let text = "统计区间：全部";

    if (quick === "today") text = "统计区间：今天";
    else if (quick === "last7") text = "统计区间：最近7天";
    else if (quick === "thisMonth") text = "统计区间：本月";
    else if (quick === "last30") text = "统计区间：最近30天";
    else if (startDate || endDate) {
      text = `统计区间：${startDate || "开始"} ~ ${endDate || "结束"}`;
    }

    $("rangeBadge").textContent = text;
  }

  function applyQuickRange(val) {
    const today = new Date();
    const fmt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const start = new Date(today);
    const end = new Date(today);

    if (val === "today") {
      $("startDate").value = fmt(start);
      $("endDate").value = fmt(end);
    } else if (val === "last7") {
      start.setDate(start.getDate() - 6);
      $("startDate").value = fmt(start);
      $("endDate").value = fmt(end);
    } else if (val === "thisMonth") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      $("startDate").value = fmt(first);
      $("endDate").value = fmt(end);
    } else if (val === "last30") {
      start.setDate(start.getDate() - 29);
      $("startDate").value = fmt(start);
      $("endDate").value = fmt(end);
    }
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

  function renderSummary(data) {
    const d = data?.data || {};

    $("kpiRevenue").textContent = money(d.revenue);
    $("kpiCost").textContent = money(d.cost);
    $("kpiGrossProfit").textContent = money(d.grossProfit);
    $("kpiCommission").textContent = money(d.commission);
    $("kpiTax").textContent = money(d.tax);
    $("kpiNetProfit").textContent = money(d.netProfit);

    $("sumOrderCount").textContent = String(d.orderCount || 0);
    $("sumRevenue").textContent = money(d.revenue);
    $("sumCost").textContent = money(d.cost);
    $("sumGrossProfit").textContent = money(d.grossProfit);
    $("sumCommission").textContent = money(d.commission);
    $("sumTax").textContent = money(d.tax);
    $("sumNetProfit").textContent = money(d.netProfit);

    $("kpiGrossProfit").className = "kpi-value " + (safeNum(d.grossProfit) >= 0 ? "positive" : "negative");
    $("kpiNetProfit").className = "kpi-value " + (safeNum(d.netProfit) >= 0 ? "positive" : "negative");

    $("sumGrossProfit").className = "summary-val " + (safeNum(d.grossProfit) >= 0 ? "positive" : "negative");
    $("sumNetProfit").className = "summary-val " + (safeNum(d.netProfit) >= 0 ? "positive" : "negative");
  }

  function renderProducts(data) {
    const list = Array.isArray(data?.data) ? data.data : [];
    const tbody = $("productsTbody");

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">暂无商品利润数据</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((it, idx) => {
      const marginPct = safeNum(it.margin) * 100;
      const profit = safeNum(it.profit);

      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(it.name || "-")}</td>
          <td class="num">${safeNum(it.qty)}</td>
          <td class="num">${money(it.revenue)}</td>
          <td class="num">${money(it.cost)}</td>
          <td class="num ${profit >= 0 ? "positive" : "negative"}">${money(profit)}</td>
          <td class="num ${marginPct >= 0 ? "positive" : "negative"}">${marginPct.toFixed(2)}%</td>
        </tr>
      `;
    }).join("");
  }

  function renderLeaders(data) {
    const list = Array.isArray(data?.data) ? data.data : [];
    const tbody = $("leadersTbody");

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">暂无团长利润数据</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(it.leaderId || "unknown")}</td>
        <td class="num">${safeNum(it.orderCount)}</td>
        <td class="num">${money(it.revenue)}</td>
        <td class="num">${money(it.commission)}</td>
      </tr>
    `).join("");
  }

  function renderLowProfit(data) {
    const list = Array.isArray(data?.data) ? data.data : [];
    const tbody = $("lowProfitTbody");

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">暂无低利润订单数据</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((it, idx) => {
      const profit = safeNum(it.profit);
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(it._id || "-")}</td>
          <td class="num">${money(it.revenue)}</td>
          <td class="num">${money(it.cost)}</td>
          <td class="num">${money(it.commission)}</td>
          <td class="num ${profit >= 0 ? "positive" : "negative"}">${money(profit)}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadAll() {
    setLoading(true);
    updateRangeBadge();

    try {
      const params = getRangeParams();
      const qs = params.toString() ? "?" + params.toString() : "";

      const [summary, products, leaders, lowProfit] = await Promise.all([
        getJSON("/api/admin/profit/summary" + qs),
        getJSON("/api/admin/profit/products" + qs),
        getJSON("/api/admin/profit/leaders" + qs),
        getJSON("/api/admin/profit/low-profit" + qs),
      ]);

      renderSummary(summary);
      renderProducts(products);
      renderLeaders(leaders);
      renderLowProfit(lowProfit);
    } catch (err) {
      console.error("利润中心加载失败：", err);
      alert(err.message || "利润中心加载失败");
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    $("startDate").value = "";
    $("endDate").value = "";
    $("quickRange").value = "";
    updateRangeBadge();
  }

  function bindEvents() {
    $("btnLoad")?.addEventListener("click", loadAll);

    $("btnReset")?.addEventListener("click", () => {
      resetFilters();
      loadAll();
    });

    $("quickRange")?.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val) applyQuickRange(val);
      updateRangeBadge();
    });

    $("startDate")?.addEventListener("change", () => {
      if ($("quickRange")) $("quickRange").value = "";
      updateRangeBadge();
    });

    $("endDate")?.addEventListener("change", () => {
      if ($("quickRange")) $("quickRange").value = "";
      updateRangeBadge();
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