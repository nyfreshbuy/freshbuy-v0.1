console.log("📘 order_detail.js (API版) 已加载");

// ✅ 兼容：优先用 ?id= 其次兼容 ?orderId=
function getOrderIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || params.get("orderId");
}

// ✅ 兼容你项目里不同 token key
function getToken() {
  return (
    localStorage.getItem("freshbuy_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("auth_token") ||
    ""
  );
}

function money(n) {
  return "$" + Number(n || 0).toFixed(2);
}

function fmtTime(ts) {
  if (!ts) return "--";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function statusText(status) {
  const s = String(status || "").toLowerCase();
  if (["pending", "unpaid", "created"].includes(s)) return "待配送";
  if (["shipping", "assigned", "dispatching", "delivering", "packing"].includes(s)) return "配送中";
  if (["done", "delivered", "completed", "finished"].includes(s)) return "已完成";
  if (["cancel", "cancelled", "canceled"].includes(s)) return "已取消";
  return status || "未知";
}

function modeTextFromOrder(o) {
  // 你后端 orderType: area_group / normal
  if (o.orderType === "area_group") return "区域团购";
  // 你后端 deliveryType: home
  if (o.deliveryType === "home") return "送货上门";
  return o.deliveryType || o.orderType || "--";
}

async function fetchOrderDetail(orderId) {
  const token = getToken();
  if (!token) throw new Error("未登录：缺少 token");

  const res = await fetch("/api/orders/" + encodeURIComponent(orderId), {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

  // ✅ 你后端是 { success: true, data: {...} }
  if (!data.success || !data.data) throw new Error(data.message || "找不到订单");
  return data.data;
}

function renderNotFound(container, msg) {
  container.innerHTML = `
    <div class="od-notfound">
      ${msg || "找不到该订单"}<br>
      请返回 <a href="/user/user_center.html">我的订单</a> 重新查看。
    </div>
  `;
}

function renderOrderDetailToDOM(order) {
  const container = document.getElementById("orderDetailContainer");
  if (!container) return;

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsRows = items
    .map(
      (it) => `
      <tr>
        <td>${window.FBNames.html(it)}</td>
        <td>${Number(it.qty || 0)}</td>
        <td>${money(it.price)}</td>
        <td>${money(it.lineTotal ?? (Number(it.price || 0) * Number(it.qty || 0)))}</td>
      </tr>
    `
    )
    .join("");

  container.innerHTML = `
    <div class="order-detail-card">
      <div class="od-header">
        <div>
          <div class="od-row"><span class="label">订单号：</span>${order.orderNo || order.id || "--"}</div>
          <div class="od-row"><span class="label">下单时间：</span>${fmtTime(order.createdAt)}</div>
        </div>
        <div>
          <span class="od-status">${statusText(order.status)}</span>
        </div>
      </div>

      <div class="od-section-title">配送信息</div>
      <div class="od-row"><span class="label">配送方式：</span>${modeTextFromOrder(order)}</div>
      <div class="od-row"><span class="label">收货地址：</span>${order.addressText || "--"}</div>
      ${order.note ? `<div class="od-row"><span class="label">备注：</span>${order.note}</div>` : ""}

      <div class="od-section-title">商品明细</div>
      <table class="od-items">
        <thead>
          <tr><th>商品</th><th>数量</th><th>单价</th><th>小计</th></tr>
        </thead>
        <tbody>
          ${itemsRows || `<tr><td colspan="4" style="color:#9ca3af;">无商品明细</td></tr>`}
        </tbody>
      </table>

            <div class="od-summary">
        <div>商品小计：${money(order.subtotal)}</div>

        ${
          Number(order.platformFee || 0) > 0
            ? `<div>平台服务费：${money(order.platformFee)}</div>`
            : ""
        }
        ${
          Number(order.depositTotal || 0) > 0
            ? `<div>押金：${money(order.depositTotal)}</div>`
            : ""
        }
        ${
          Number(order.salesTax || 0) > 0
            ? `<div>消费税：${money(order.salesTax)}</div>`
            : ""
        }

        <div>运费：${money(order.deliveryFee)}</div>
                ${
          Number(order.tipFee || 0) > 0
            ? `<div>小费：${money(order.tipFee)}</div>`
            : ""
        }
        <div>优惠：${money(order.discount)}</div>
        <div class="total">订单总金额：${money(order.totalAmount)}</div>
      </div>
    </div>
  `;
}

async function main() {
  const container = document.getElementById("orderDetailContainer");
  const orderId = getOrderIdFromUrl();

  if (!container) return;
  if (!orderId) {
    renderNotFound(container, "URL 缺少订单参数（id）");
    return;
  }

  try {
    // 先显示加载中（可选）
    container.innerHTML = `<div class="od-notfound">加载中…</div>`;

    const order = await fetchOrderDetail(orderId);
    renderOrderDetailToDOM(order);
  } catch (e) {
    console.error("load order detail error:", e);
    renderNotFound(container, e.message || "加载失败");
  }
}

document.addEventListener("DOMContentLoaded", main);
