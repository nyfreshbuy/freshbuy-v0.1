// frontend/user/assets/js/orders.js
// ✅ TABLE FINAL FIXED (based on your version) + 防重复加载

(function () {
  // =========================
  // ✅ 防重复加载：同一页面就算 orders.js 被注入两次，也不会炸
  // =========================
  if (window.__FRESHBUY_ORDERS_JS_LOADED__) {
    console.warn("⚠️ orders.js already loaded, skip re-execution");
    return;
  }
  window.__FRESHBUY_ORDERS_JS_LOADED__ = true;

  console.log("📘 orders.js 已加载（TABLE FINAL FIXED based on your version + GUARD）");

  // =========================
  // 工具
  // =========================
  function safeParse(str, fallback) {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  // ✅ 改成不容易冲突的名字（避免你其它文件也声明 TOKEN_KEYS）
  const FB_TOKEN_KEYS = [
    "freshbuy_token",
    "freshbuy_user_token",
    "token",
    "jwt",
    "access_token",
    "auth_token",
  ];

  function getToken() {
    for (const k of FB_TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function toIdString(v) {
    if (!v) return "";
    if (typeof v === "string") return v;
    try {
      if (typeof v.toString === "function") return v.toString();
    } catch {}
    return String(v);
  }

  function fmtMoney(n) {
    const x = Number(n || 0);
    return x.toFixed(2);
  }

  function fmtTime(d) {
    const dt = d ? new Date(d) : new Date();
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleString();
  }

  function safeNum(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  // =========================
  // DOM helpers
  // =========================
  function $(id) {
    return document.getElementById(id);
  }

  function getOrderTableTbody() {
    const table = $("orderTable");
    if (!table) return null;
    return table.querySelector("tbody");
  }

  function getRecentTableTbody() {
    const table = $("recentOrderTable");
    if (!table) return null;
    return table.querySelector("tbody");
  }

  // 兜底：如果页面没有表格，就创建一个卡片容器（一般不会走到）
  function ensureFallbackListContainer() {
    let el =
      $("ordersList") ||
      document.querySelector(".ordersList") ||
      document.querySelector(".orders-list");

    if (el) return el;

    const host =
      document.querySelector("#tab-orders") ||
      document.querySelector(".content-section#tab-orders") ||
      document.querySelector("main") ||
      document.body;

    el = document.createElement("div");
    el.id = "ordersList";
    el.style.cssText = "margin-top:12px; display:grid; gap:12px;";
    host.appendChild(el);

    console.warn("⚠️ 未找到 #orderTable，已创建兜底容器 #ordersList");
    return el;
  }

  // =========================
  // 订单归一化（✅ id 永远优先用 _id）
  // =========================
  function normalizeOrder(o) {
    const id = toIdString(o._id || o.id || o.orderId || "");
    const orderNo = toIdString(o.orderNo || o.order_number || o.no || "");

    const createdAt = o.createdAt || o.created_time || o.time || Date.now();

    const totalFromFields = safeNum(
      o.totalAmount ??
        o.payment?.amountTotal ??
        o.payment?.paidTotal ??
        o.pricing?.grand ??
        o.grand ??
        o.total ??
        o.amount ??
        0
    );

    const totalCalc =
      safeNum(o.subtotal, 0) +
      safeNum(o.deliveryFee, 0) +
      safeNum(o.salesTax, 0) +
      safeNum(o.platformFee, 0) +
      safeNum(o.tipFee, 0) -
      safeNum(o.discount, 0);

    const total = totalFromFields || totalCalc;

    const items = Array.isArray(o.items)
      ? o.items.map((it) => ({
          name: it.name || it.productName || "",
          qty: safeNum(it.qty || it.quantity || 1, 1),
        }))
      : [];

    const qty =
      safeNum(o.itemsCount, 0) ||
      items.reduce((s, it) => s + safeNum(it.qty, 1), 0);

    const deliveryMode = o.deliveryMode || o.mode || "";
    const deliveryType = o.deliveryType || "";
    const status = o.status || o.payment?.status || "";
    const paymentMethod = o.payment?.method || o.method || "";

    return {
      id, // ✅ 用于详情页 orderId
      orderNo: orderNo || (id ? String(id).slice(-8) : ""),
      createdAt,
      total: Number(total || 0),
      qty,
      items,
      deliveryMode,
      deliveryType,
      status,
      paymentMethod,
      raw: o,
    };
  }

  // =========================
  // 显示文案
  // =========================
  function formatPayMethod(method) {
    const m = String(method || "").toLowerCase();
    if (m === "stripe") return "信用卡";
    if (m === "wallet") return "钱包";
    if (m === "zelle") return "Zelle";
    return method || "—";
  }

  function formatDelivery(o) {
    const dm = String(o.deliveryMode || "").toLowerCase();
    const dt = String(o.deliveryType || "").toLowerCase();

    if (dm === "groupday" || dt === "groupday") return "区域团";
    if (dm === "dealsday") return "爆品日";
    if (dm === "friendgroup" || dt === "friend") return "好友拼单";
    if (dt === "nextday") return "次日达";
    return "普通配送";
  }

  function formatStatus(s) {
    const v = String(s || "").toLowerCase();
    if (v === "paid") return { text: "已支付", cls: "done" };
    if (v === "packing") return { text: "拣货中", cls: "pending" };
    if (v === "shipping") return { text: "配送中", cls: "pending" };
    if (v === "done" || v === "completed") return { text: "已完成", cls: "done" };
    if (v === "cancel" || v === "cancelled") return { text: "已取消", cls: "cancel" };
    if (v === "unpaid") return { text: "未支付", cls: "pending" };
    return { text: s || "—", cls: "pending" };
  }

  // ✅ UI筛选 -> 真实状态映射
  function statusFilterMatch(orderStatus, uiValue) {
    const os = String(orderStatus || "").toLowerCase();
    const ui = String(uiValue || "").toLowerCase();
    if (!ui) return true;

    if (ui === "pending") return ["pending", "unpaid", "paid", "packing"].includes(os);
    if (ui === "shipping") return ["shipping", "delivering"].includes(os);
    if (ui === "done") return ["done", "completed"].includes(os);
    if (ui === "cancel") return ["cancel", "cancelled"].includes(os);

    return os === ui;
  }

  // =========================
  // 渲染：表格
  // =========================
  function renderOrderTableRows(tbody, orders) {
    tbody.innerHTML = "";

    if (!orders.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" style="color:#6b7280;font-size:12px;padding:10px 4px;">暂无订单</td>`;
      tbody.appendChild(tr);
      return;
    }

    for (const o of orders) {
      const st = formatStatus(o.status);
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td style="white-space:nowrap;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">${o.orderNo || "—"}</td>
        <td style="white-space:nowrap;">${fmtTime(o.createdAt)}</td>
        <td>${o.qty || 0}</td>
        <td>$${fmtMoney(o.total)}</td>
        <td>${formatDelivery(o)} · ${formatPayMethod(o.paymentMethod)}</td>
        <td><span class="badge-status ${st.cls}">${st.text}</span></td>
        <td><button class="btn-ghost" data-order-id="${o.id}" type="button">查看</button></td>
      `;

      const go = () => {
        if (!o.id) {
          console.warn("⚠️ 该订单缺少 _id，无法跳转详情:", o.raw);
          return;
        }
        window.location.href = "order_detail.html?orderId=" + encodeURIComponent(o.id);
      };

      tr.addEventListener("click", go);

      const btn = tr.querySelector("button[data-order-id]");
      if (btn) {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          go();
        });
      }

      tbody.appendChild(tr);
    }
  }

  function renderRecentTableRows(tbody, orders) {
    tbody.innerHTML = "";

    const top5 = orders.slice(0, 5);

    if (!top5.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5" style="color:#6b7280;font-size:12px;padding:10px 4px;">暂无订单</td>`;
      tbody.appendChild(tr);
      return;
    }

    for (const o of top5) {
      const st = formatStatus(o.status);
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";

      tr.innerHTML = `
        <td style="white-space:nowrap;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">${o.orderNo || "—"}</td>
        <td style="white-space:nowrap;">${fmtTime(o.createdAt)}</td>
        <td>$${fmtMoney(o.total)}</td>
        <td>${formatDelivery(o)}</td>
        <td><span class="badge-status ${st.cls}">${st.text}</span></td>
      `;

      tr.addEventListener("click", () => {
        if (!o.id) return;
        window.location.href = "order_detail.html?orderId=" + encodeURIComponent(o.id);
      });

      tbody.appendChild(tr);
    }
  }

  // =========================
  // 渲染：兜底卡片
  // =========================
  function renderFallbackCards(container, orders) {
    container.innerHTML = "";

    if (!orders.length) {
      container.innerHTML = `<div style="color:#6b7280;font-size:12px;">暂无订单</div>`;
      return;
    }

    for (const o of orders) {
      const card = document.createElement("div");
      card.className = "order-card";
      card.style.cssText =
        "border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff;cursor:pointer";

      const st = formatStatus(o.status);

      const itemsStr = (o.items || [])
        .slice(0, 5)
        .map((it) => `${it.name} × ${it.qty}`)
        .join("<br>");

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span>订单号：${o.orderNo || "—"}</span>
          <span>${fmtTime(o.createdAt)}</span>
        </div>
        <div style="margin:8px 0;font-size:13px;color:#374151;">
          ${itemsStr || ""}
        </div>
        <div style="font-size:14px;font-weight:600;">
          总计：$${fmtMoney(o.total)}
        </div>
        <div style="margin-top:6px;font-size:12px;color:#6b7280;">
          支付方式：${formatPayMethod(o.paymentMethod)} ｜ 状态：${st.text}
        </div>
      `;

      card.addEventListener("click", () => {
        if (!o.id) return;
        window.location.href = "order_detail.html?orderId=" + encodeURIComponent(o.id);
      });

      container.appendChild(card);
    }
  }

  // =========================
  // 拉取订单：后端优先，本地兜底
  // =========================
  async function fetchOrdersFromApi(days, limit) {
    const token = getToken();
    if (!token) throw new Error("no token");

    const qs = new URLSearchParams();
    qs.set("days", String(days || "all"));
    qs.set("limit", String(limit || 50));

    const res = await fetch("/api/orders/my?" + qs.toString(), {
      credentials: "include",
      headers: { Authorization: "Bearer " + token },
    });

    const data = await res.json().catch(() => ({}));
    console.log("📦 /api/orders/my =", res.status, data);

    if (!res.ok || !data?.success || !Array.isArray(data.orders)) {
      throw new Error(data?.message || "api failed " + res.status);
    }

    return data.orders.map(normalizeOrder);
  }

  function fetchOrdersFromLocal() {
    const local1 = safeParse(localStorage.getItem("fresh_orders_v1") || "[]", []);
    const local2 = safeParse(localStorage.getItem("freshbuy_orders") || "[]", []);
    return [...local1, ...local2].map(normalizeOrder);
  }

  // =========================
  // 筛选逻辑
  // =========================
  function applyFilters(orders, statusFilter, daysFilter) {
    let out = Array.isArray(orders) ? [...orders] : [];

    if (daysFilter && daysFilter !== "all") {
      const days = Number(daysFilter);
      if (Number.isFinite(days) && days > 0) {
        const since = Date.now() - days * 24 * 60 * 60 * 1000;
        out = out.filter((o) => new Date(o.createdAt).getTime() >= since);
      }
    }

    if (statusFilter) {
      out = out.filter((o) => statusFilterMatch(o.status, statusFilter));
    }

    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return out;
  }

  // =========================
  // 主加载（同时填充两个表）
  // =========================
  async function loadAndRenderOrders() {
    const statusFilter = $("orderStatusFilter")?.value || "";
    const daysFilter = $("orderTimeFilter")?.value || "30";
    const daysForApi = daysFilter === "all" ? "all" : daysFilter;

    const tbody = getOrderTableTbody();
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:#6b7280;font-size:12px;padding:10px 4px;">加载中…</td></tr>`;
    }

    let orders = [];
    let from = "api";

    try {
      orders = await fetchOrdersFromApi(daysForApi, 50);
    } catch (e) {
      console.warn("⚠️ API 拉取失败，改用本地兜底：", e?.message || e);
      orders = fetchOrdersFromLocal();
      from = "local";
    }

    const filtered = applyFilters(orders, statusFilter, daysFilter);

    const tbody2 = getOrderTableTbody();
    if (tbody2) {
      renderOrderTableRows(tbody2, filtered);
    } else {
      const list = ensureFallbackListContainer();
      renderFallbackCards(list, filtered);
    }

    const recentTbody = getRecentTableTbody();
    if (recentTbody) {
      const recent = applyFilters(orders, "", daysFilter).slice(0, 5);
      renderRecentTableRows(recentTbody, recent);
    }

    const overviewOrders = $("overviewOrders");
    if (overviewOrders) {
      const last30 = applyFilters(orders, "", "30");
      overviewOrders.textContent = `${last30.length} 单`;
    }

    console.log(`✅ orders 渲染完成（from=${from}），总=${orders.length}，显示=${filtered.length}`);
  }

  // =========================
  // 绑定筛选按钮（✅ 强防重复绑定）
  // =========================
  function bindFilterUi() {
    const btn = $("orderFilterBtn");
    if (btn && !btn.__freshbuyBound) {
      btn.__freshbuyBound = true;
      btn.addEventListener("click", () => loadAndRenderOrders());
    }

    const s = $("orderStatusFilter");
    const t = $("orderTimeFilter");

    if (s && !s.__freshbuyBound) {
      s.__freshbuyBound = true;
      s.addEventListener("change", () => loadAndRenderOrders());
    }
    if (t && !t.__freshbuyBound) {
      t.__freshbuyBound = true;
      t.addEventListener("change", () => loadAndRenderOrders());
    }
  }

  // =========================
  // 启动（✅ 强防重复 boot）
  // =========================
  function boot() {
    if (window.__FRESHBUY_ORDERS_BOOTED__) return;
    window.__FRESHBUY_ORDERS_BOOTED__ = true;

    bindFilterUi();
    loadAndRenderOrders();

    // tab 切换弱监听：点到“订单”相关就刷新
    document.addEventListener("click", (e) => {
      const t = e.target;
      const text = (t?.innerText || "").trim();
      const id = String(t?.id || "");
      const cls = String(t?.className || "");
      if (
        text.includes("我的订单") ||
        text.includes("订单") ||
        id.toLowerCase().includes("order") ||
        cls.toLowerCase().includes("order") ||
        (t?.closest && t.closest('[data-tab="orders"]'))
      ) {
        setTimeout(loadAndRenderOrders, 200);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 调试入口
  window.__reloadUserOrders = loadAndRenderOrders;
})();
