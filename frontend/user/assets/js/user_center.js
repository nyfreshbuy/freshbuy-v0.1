// frontend/user/assets/js/user_center.js
// 用户中心（与当前 user_center.html 匹配）
// ✅ 地址：可新增 POST + 可编辑 PUT（支持 Places 强制选择）

(() => {
  const API_BASE = ""; // 同域留空

  // =========================
  // AUTH
  // =========================
  const AUTH = {
    tokenKey: "freshbuy_token",
    phoneKey: "freshbuy_login_phone",
    nickKey: "freshbuy_login_nickname",
    getToken() {
      return (
        localStorage.getItem(this.tokenKey) ||
        localStorage.getItem("token") ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("jwt") ||
        ""
      );
    },
    clear() {
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.phoneKey);
      localStorage.removeItem(this.nickKey);
      localStorage.removeItem("freshbuy_is_logged_in");
    },
  };

  // =========================
  // DOM refs（按你当前HTML的id）
  // =========================
  const menuList = document.getElementById("menuList");
  const sections = document.querySelectorAll(".content-section");

  const topUserName = document.getElementById("topUserName");
  const topAvatar = document.getElementById("topAvatar");
  const mainAvatar = document.getElementById("mainAvatar");
  const nicknameDisplay = document.getElementById("nicknameDisplay");
  const phoneDisplay = document.getElementById("phoneDisplay");
  const settingsNickname = document.getElementById("settingsNickname");
  const settingsPhone = document.getElementById("settingsPhone");

  const walletMiniBalance = document.getElementById("walletMiniBalance");
  const overviewBalance = document.getElementById("overviewBalance");
  const overviewOrders = document.getElementById("overviewOrders");
  const overviewCoupons = document.getElementById("overviewCoupons");

  const walletBalance = document.getElementById("walletBalance");
  const walletTotalRecharge = document.getElementById("walletTotalRecharge");

  const recentOrderTbody = document.querySelector("#recentOrderTable tbody");
  const orderTbody = document.querySelector("#orderTable tbody");

  const addressListEl = document.getElementById("addressList");

  const rechargeTbody = document.querySelector("#rechargeTable tbody");
  const couponListEl = document.getElementById("couponList");

  // =========================
  // utils
  // =========================
  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getAvatarText(nameOrPhone) {
    if (!nameOrPhone) return "U";
    const s = String(nameOrPhone).trim();
    return s ? s.slice(0, 1).toUpperCase() : "U";
  }

  function formatMoney(n) {
    const num = Number(n);
    if (!isFinite(num)) return "$0.00";
    return "$" + num.toFixed(2);
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

  function setBalance(amount) {
    const text = formatMoney(amount);
    if (overviewBalance) overviewBalance.textContent = text;
    if (walletBalance) walletBalance.textContent = text;
    if (walletMiniBalance) walletMiniBalance.textContent = "余额 " + text;
  }

  function renderOrderStatusBadge(status) {
    const s = String(status || "").toLowerCase();
    let text = "未知";
    let cls = "pending";

    if (["pending", "unpaid", "created"].includes(s)) {
      text = "待配送";
      cls = "pending";
    } else if (["shipping", "assigned", "dispatching", "delivering"].includes(s)) {
      text = "配送中";
      cls = "pending";
    } else if (["done", "delivered", "completed", "finished"].includes(s)) {
      text = "已完成";
      cls = "done";
    } else if (["cancel", "cancelled", "canceled"].includes(s)) {
      text = "已取消";
      cls = "cancel";
    } else if (s) {
      text = status;
      cls = "pending";
    }
    return `<span class="badge-status ${cls}">${text}</span>`;
  }

  function setAddrHint(msg, ok = false) {
    const el = document.getElementById("addrHint");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = ok ? "#16a34a" : "#ef4444";
  }

  // =========================
  // apiFetch（带token）
  // =========================
  async function apiFetch(path, options = {}) {
    const token = AUTH.getToken();
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", "Bearer " + token);
    if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(API_BASE + path, { ...options, headers });

    if (res.status === 401) {
      AUTH.clear();
      alert("登录已过期，请重新登录");
      window.location.replace("/user/index.html?v=" + Date.now());
      throw new Error("Unauthorized");
    }

    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }

    if (!res.ok) {
      throw new Error(json.message || json.error || `请求失败(${res.status})`);
    }
    if (json && json.success === false) {
      throw new Error(json.message || json.msg || json.error || "请求失败");
    }
    return json;
  }

  // =========================
  // 顶部 & 退出
  // =========================
  document.getElementById("backHome")?.addEventListener("click", () => {
    window.location.href = "/user/index.html";
  });

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    if (!confirm("确定要退出登录吗？")) return;
    AUTH.clear();
    alert("已退出登录");
    window.location.replace("/user/index.html?v=" + Date.now());
  });

  // =========================
  // 菜单切换（你现在HTML用 active class）
  // =========================
  function showTab(tabKey) {
    menuList?.querySelectorAll(".menu-item").forEach((item) => item.classList.remove("active"));
    const activeItem = menuList?.querySelector(`.menu-item[data-tab="${tabKey}"]`);
    if (activeItem) activeItem.classList.add("active");

    sections.forEach((sec) => sec.classList.remove("active"));
    const target = document.getElementById("tab-" + tabKey);
    if (target) target.classList.add("active");

    // 切换后按需刷新
    if (tabKey === "orders") loadOrdersList();
    if (tabKey === "address") loadAddresses();
    if (tabKey === "wallet") {
      loadWallet();
      loadRechargeHistory();
    }
    if (tabKey === "coupon") loadCoupons();
  }

  // 绑定菜单点击
  function bindMenu() {
    if (!menuList) return;
    if (menuList.__bound) return;
    menuList.__bound = true;

    menuList.addEventListener("click", (e) => {
      const li = e.target.closest(".menu-item");
      if (!li) return;
      const tab = li.dataset.tab;
      if (!tab) return;
      showTab(tab);
    });
  }

  // =========================
  // 用户信息
  // =========================
  async function loadUserInfo() {
    const token = AUTH.getToken();
    if (!token) {
      window.location.replace("/user/index.html?v=" + Date.now());
      return null;
    }

    // 先用本地
    const phoneLocal = localStorage.getItem(AUTH.phoneKey) || "";
    const nickLocal = localStorage.getItem(AUTH.nickKey) || "";

    const nick0 = nickLocal || "在鲜购用户";
    const phone0 = phoneLocal || "";
    const av0 = getAvatarText(nick0 || phone0);

    nicknameDisplay && (nicknameDisplay.textContent = nick0);
    topUserName && (topUserName.textContent = nick0);
    phoneDisplay && (phoneDisplay.textContent = phone0 ? "手机号：" + phone0 : "手机号：--");
    settingsNickname && (settingsNickname.value = nick0);
    settingsPhone && (settingsPhone.value = phone0);

    topAvatar && (topAvatar.textContent = av0);
    mainAvatar && (mainAvatar.textContent = av0);

    // 再请求后端
    try {
      const r = await apiFetch("/api/users/me", { method: "GET" });
      const u = r.user || r.data || r || {};
      const nick = u.nickname || u.name || nick0;
      const phone = u.phone || phone0;
      const av = getAvatarText(nick || phone);

      nicknameDisplay && (nicknameDisplay.textContent = nick);
      topUserName && (topUserName.textContent = nick);
      phoneDisplay && (phoneDisplay.textContent = phone ? "手机号：" + phone : "手机号：--");
      settingsNickname && (settingsNickname.value = nick);
      settingsPhone && (settingsPhone.value = phone);

      topAvatar && (topAvatar.textContent = av);
      mainAvatar && (mainAvatar.textContent = av);

      return u;
    } catch (e) {
      console.warn("⚠️ /api/auth/me 失败:", e.message);
      return { name: nick0, phone: phone0 };
    }
  }

  // =========================
  // 订单（你的HTML用表格）
  // =========================
  function normalizeOrdersPayload(r) {
    const orders = r.orders || r.list || r.items || r.data?.orders || r.data || [];
    const total = r.total ?? r.data?.total ?? (Array.isArray(orders) ? orders.length : 0);
    return { orders: Array.isArray(orders) ? orders : [], total };
  }

  function renderRecentOrders(orders) {
    if (!recentOrderTbody) return;
    recentOrderTbody.innerHTML = "";
    const list = (orders || []).slice(0, 5);

    if (!list.length) {
      recentOrderTbody.innerHTML = `<tr><td colspan="5" style="color:#9ca3af;">暂无订单</td></tr>`;
      return;
    }

    list.forEach((o) => {
      const oid = o.id || o._id || o.orderId || "";
      const orderNo = o.orderNo || o.no || o.order_number || oid || "--";
      const time = fmtTime(o.createdAt || o.created_at || o.time);
      const amount = formatMoney(o.totalAmount ?? o.grand ?? o.pricing?.grand ?? o.total ?? o.amount ?? 0);
      const mode = escapeHtml(o.deliveryType || o.delivery_type || o.mode || "--");
      const status = renderOrderStatusBadge(o.status);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(String(orderNo))}</td>
        <td>${escapeHtml(String(time))}</td>
        <td>${amount}</td>
        <td>${mode}</td>
        <td>${status}</td>
      `;
      recentOrderTbody.appendChild(tr);
    });
  }

  function renderOrderTable(list, totalForOverview) {
    if (!orderTbody) return;
    orderTbody.innerHTML = "";
    const orders = Array.isArray(list) ? list : [];

    if (overviewOrders) overviewOrders.textContent = (totalForOverview ?? orders.length) + " 单";

    if (!orders.length) {
      orderTbody.innerHTML = `<tr><td colspan="7" style="color:#9ca3af;">暂无订单</td></tr>`;
      return;
    }

    orders.forEach((o) => {
      const detailId = o.id || o._id || o.data?.id || o.data?._id;
      const showNo = o.orderNo || o.order_number || o.no || detailId || "--";
      const time = fmtTime(o.createdAt || o.created_at || o.time);

      const itemsCount =
        (typeof o.itemsCount === "number" ? o.itemsCount : null) ??
        (typeof o.items_count === "number" ? o.items_count : null) ??
        (Array.isArray(o.items) ? o.items.length : 0);

      const amount = formatMoney(o.totalAmount ?? o.total ?? o.amount ?? 0);
      const mode = escapeHtml(o.deliveryType || o.delivery_type || o.mode || "--");
      const status = renderOrderStatusBadge(o.status);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(String(showNo))}</td>
        <td>${escapeHtml(String(time))}</td>
        <td>${escapeHtml(String(itemsCount))}</td>
        <td>${amount}</td>
        <td>${mode}</td>
        <td>${status}</td>
        <td>
          ${
            detailId
              ? `<a class="link-small" href="/user/order_detail.html?id=${encodeURIComponent(detailId)}">查看详情</a>`
              : `<span style="color:#9ca3af;">无详情</span>`
          }
        </td>
      `;
      orderTbody.appendChild(tr);
    });
  }

  async function loadOrdersRecent() {
    try {
      const r = await apiFetch("/api/orders/my?limit=5", { method: "GET" });
      const { orders, total } = normalizeOrdersPayload(r);
      renderRecentOrders(orders);
      if (overviewOrders) overviewOrders.textContent = (r.total30 ?? total ?? orders.length) + " 单";
    } catch (e) {
      console.warn("loadOrdersRecent fail:", e.message);
      renderRecentOrders([]);
      if (overviewOrders) overviewOrders.textContent = "0 单";
    }
  }

  async function loadOrdersList() {
    try {
      const status = document.getElementById("orderStatusFilter")?.value || "";
      const days = document.getElementById("orderTimeFilter")?.value || "30";
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (days && days !== "all") qs.set("days", days);

      const r = await apiFetch("/api/orders/my" + (qs.toString() ? "?" + qs.toString() : ""), { method: "GET" });
      const { orders, total } = normalizeOrdersPayload(r);
      renderOrderTable(orders, total);
    } catch (e) {
      console.warn("loadOrdersList fail:", e.message);
      renderOrderTable([], 0);
    }
  }

  document.getElementById("orderFilterBtn")?.addEventListener("click", () => loadOrdersList());

  // =========================
  // 钱包（没有接口也不炸）
  // =========================
  async function loadWallet() {
    try {
      const r = await apiFetch("/api/wallet/my", { method: "GET" });
      const bal = r.balance ?? r.data?.balance ?? r.wallet?.balance ?? 0;
      setBalance(bal);
    } catch (e) {
      console.warn("loadWallet fail:", e.message);
      setBalance(0);
    }
  }

  // =========================
  // 充值记录（没有接口也不炸）
  // =========================
  function renderRechargeTable(list) {
    if (!rechargeTbody) return;
    rechargeTbody.innerHTML = "";
    const rows = Array.isArray(list) ? list : [];
    let totalRecharge = 0;

    if (!rows.length) {
      rechargeTbody.innerHTML = `<tr><td colspan="5" style="color:#9ca3af;">暂无充值记录</td></tr>`;
      if (walletTotalRecharge) walletTotalRecharge.textContent = "$0.00";
      return;
    }

    rows.forEach((r) => {
      const time = fmtTime(r.createdAt || r.created_at || r.time);
      const amount = Number(r.amount ?? r.money ?? 0) || 0;
      totalRecharge += amount;

      const bonus = r.bonus || r.promo || r.gift || "--";
      const payMethod = r.payMethod || r.method || "--";
      const status = r.status || "done";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(String(time))}</td>
        <td>${formatMoney(amount)}</td>
        <td>${escapeHtml(String(bonus))}</td>
        <td>${escapeHtml(String(payMethod))}</td>
        <td>${escapeHtml(status === "done" ? "成功" : "处理中")}</td>
      `;
      rechargeTbody.appendChild(tr);
    });

    if (walletTotalRecharge) walletTotalRecharge.textContent = formatMoney(totalRecharge);
  }

  async function loadRechargeHistory() {
    try {
      const r = await apiFetch("/api/recharge/my", { method: "GET" });
      const list = r.records || r.list || r.items || r.data || [];
      renderRechargeTable(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("loadRechargeHistory fail:", e.message);
      renderRechargeTable([]);
    }
  }

  document.getElementById("rechargeBtn")?.addEventListener("click", () => {
    const amount = Number(document.getElementById("rechargeAmount")?.value) || 0;
    if (amount <= 0) return alert("请输入要充值的金额");
    window.location.href = "/user/recharge.html?amount=" + encodeURIComponent(amount);
  });

  // =========================
  // 优惠券（没有接口也不炸）
  // =========================
  function renderCouponList(list) {
    if (!couponListEl) return;
    couponListEl.innerHTML = "";
    const rows = Array.isArray(list) ? list : [];

    if (overviewCoupons) overviewCoupons.textContent = rows.length + " 张";

    if (!rows.length) {
      couponListEl.innerHTML = '<div style="font-size:12px;color:#9ca3af;">暂无优惠券</div>';
      return;
    }

    rows.forEach((c) => {
      const value = c.value ?? c.amount ?? 0;
      const condition = c.condition || c.rule || "无门槛";
      const desc = c.desc || c.title || "优惠券";
      const deadline = c.deadline || c.expireAt || c.expiredAt || "";
      const tag = c.tag || (c.scope ? String(c.scope) : "可用");

      const div = document.createElement("div");
      div.className = "coupon-card";
      div.innerHTML = `
        <div class="coupon-main-value">$${Number(value) || 0}</div>
        <div class="coupon-condition">${escapeHtml(String(condition))}</div>
        <div class="coupon-meta">${escapeHtml(String(desc))}</div>
        <div class="coupon-meta">${deadline ? "有效期至 " + escapeHtml(String(deadline)) : ""}</div>
        <div class="coupon-tag">${escapeHtml(String(tag))}</div>
      `;
      couponListEl.appendChild(div);
    });
  }

  async function loadCoupons() {
    try {
      const r = await apiFetch("/api/coupons/my", { method: "GET" });
      const list = r.coupons || r.list || r.items || r.data || [];
      renderCouponList(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("loadCoupons fail:", e.message);
      renderCouponList([]);
    }
  }

  // =========================
// 账号设置：昵称（✅ 写入后端 + 本地缓存）
// 依赖后端：PATCH /api/users/me {nickname}
// =========================
async function saveNicknameToServer(nickname) {
  const r = await apiFetch("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify({ nickname }),
  });
  return r.user || r.data || r;
}

function applyNicknameUI(nick, phoneForAvatar = "") {
  const showNick = nick || "在鲜购用户";

  nicknameDisplay && (nicknameDisplay.textContent = showNick);
  topUserName && (topUserName.textContent = showNick);
  settingsNickname && (settingsNickname.value = showNick);

  const avatarText = getAvatarText(showNick || phoneForAvatar);
  topAvatar && (topAvatar.textContent = avatarText);
  mainAvatar && (mainAvatar.textContent = avatarText);
}

document.getElementById("saveNicknameBtn")?.addEventListener("click", async () => {
  const newNick = document.getElementById("settingsNickname")?.value?.trim() || "";
  if (!newNick) return alert("昵称不能为空");

  try {
    // ✅ 写入后端
    const u = await saveNicknameToServer(newNick);

    // ✅ 用后端返回为准（避免前端和DB不一致）
    const nickSaved = u.nickname || u.name || newNick;
    const phoneSaved = u.phone || localStorage.getItem(AUTH.phoneKey) || "";

    // ✅ 本地也存一份做缓存（可选，但建议保留）
    localStorage.setItem(AUTH.nickKey, nickSaved);

    // ✅ 刷新UI
    applyNicknameUI(nickSaved, phoneSaved);

    alert("昵称已保存（已写入账号）");
  } catch (e) {
    alert("保存失败：" + (e.message || ""));
  }
});
  // =========================
  // ✅ Places Autocomplete（强制下拉选择）
  // =========================
  let STREET_SELECTED = false;

  function initStreetAutocomplete() {
    const input = document.getElementById("addrStreet1");
    if (!input) return;

    if (!window.google?.maps?.places) {
      console.warn("Google Places not loaded yet");
      return;
    }

    const ac = new google.maps.places.Autocomplete(input, {
      types: ["address"],
      componentRestrictions: { country: "us" },
      fields: ["address_components", "geometry", "place_id"],
    });

    input.addEventListener("input", () => {
      STREET_SELECTED = false;
      input.dataset.placeId = "";
      input.dataset.lat = "";
      input.dataset.lng = "";
    });

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place?.address_components || !place?.geometry?.location || !place.place_id) {
        STREET_SELECTED = false;
        setAddrHint("请从下拉提示中选择地址", false);
        return;
      }

      const comps = place.address_components;
      const getLong = (t) => comps.find((c) => c.types.includes(t))?.long_name || "";
      const getShort = (t) => comps.find((c) => c.types.includes(t))?.short_name || "";

      const streetNumber = getLong("street_number");
      const route = getLong("route");
      const city = getLong("locality") || getLong("sublocality") || getLong("postal_town");
      const state = getShort("administrative_area_level_1");
      const zip = getLong("postal_code");

      input.value = [streetNumber, route].filter(Boolean).join(" ");

      const cityEl = document.getElementById("addrCity");
      const stateEl = document.getElementById("addrState");
      const zipEl = document.getElementById("addrZip");

      if (cityEl) cityEl.value = city || "";
      if (stateEl) stateEl.value = state || "";
      if (zipEl) zipEl.value = zip || "";

      input.dataset.placeId = place.place_id;
      input.dataset.lat = String(place.geometry.location.lat());
      input.dataset.lng = String(place.geometry.location.lng());

      STREET_SELECTED = true;
      setAddrHint("✅ 地址已验证（Places）", true);
    });
  }

  // Google script callback 会调用这个
  window._initPlaces = function () {
    initStreetAutocomplete();
  };

  // =========================
  // ✅ 地址：可新增 POST + 可编辑 PUT
  // =========================
  let editingAddressId = null; // null=新增；有值=编辑

  function updateAddrButtons() {
    const saveBtn = document.getElementById("addrSaveBtn");
    const clearBtn = document.getElementById("addrClearBtn");
    if (!saveBtn) return;

    const isEdit = !!editingAddressId;
    saveBtn.disabled = false;
    saveBtn.textContent = isEdit ? "更新地址" : "新增地址";

    if (clearBtn) clearBtn.textContent = isEdit ? "取消编辑" : "清空";
  }

  function clearAddrForm(keepHint = false) {
    ["addrFirstName", "addrLastName", "addrPhone", "addrStreet1", "addrApt", "addrCity", "addrZip"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    const stateEl = document.getElementById("addrState");
    if (stateEl) stateEl.value = "";
    const defEl = document.getElementById("addrDefault");
    if (defEl) defEl.checked = false;

    editingAddressId = null;

    STREET_SELECTED = false;
    const streetEl = document.getElementById("addrStreet1");
    if (streetEl) {
      streetEl.dataset.placeId = "";
      streetEl.dataset.lat = "";
      streetEl.dataset.lng = "";
    }

    updateAddrButtons();
    if (!keepHint) setAddrHint("", true);
  }

  function normalizeAddressesPayload(r) {
    const list = r.addresses || r.list || r.items || r.data?.addresses || r.data || [];
    return Array.isArray(list) ? list : [];
  }

  function getAddrFormData() {
    const streetEl = document.getElementById("addrStreet1");
    const placeId = streetEl?.dataset?.placeId || "";
    const lat = streetEl?.dataset?.lat || "";
    const lng = streetEl?.dataset?.lng || "";

    return {
      firstName: (document.getElementById("addrFirstName")?.value || "").trim(),
      lastName: (document.getElementById("addrLastName")?.value || "").trim(),
      phone: (document.getElementById("addrPhone")?.value || "").trim(),
      street1: (streetEl?.value || "").trim(),
      apt: (document.getElementById("addrApt")?.value || "").trim(),
      city: (document.getElementById("addrCity")?.value || "").trim(),
      state: (document.getElementById("addrState")?.value || "").trim(),
      zip: (document.getElementById("addrZip")?.value || "").trim(),
      isDefault: !!document.getElementById("addrDefault")?.checked,
      placeId: placeId || "",
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
    };
  }

  // ✅ 校验：新增必须下拉选择；编辑如果已有 placeId/lat/lng 可直接保存
  function validateAddr(a) {
    if (!a.firstName) return "请填写名 (First Name)";
    if (!a.lastName) return "请填写姓 (Last Name)";
    if (!a.street1) return "请填写街道地址 (Street Address)";
    if (!a.city) return "请填写城市 (City)";
    if (!a.state) return "请选择州 (State)";
    if (!a.zip) return "请填写邮编 (ZIP)";
    if (!/^\d{5}(-\d{4})?$/.test(a.zip)) return "邮编格式不正确（应为 11365 或 11365-1234）";

    const hasPlace =
      !!a.placeId &&
      typeof a.lat === "number" && isFinite(a.lat) &&
      typeof a.lng === "number" && isFinite(a.lng);

    if (!hasPlace) {
      if (!STREET_SELECTED) return "请从下拉提示中选择正确街道地址（不要手动输入）";
      return "地址未验证（缺少 placeId/坐标），请重新选择";
    }

    return "";
  }

  function renderAddressList(list) {
    if (!addressListEl) return;
    addressListEl.innerHTML = "";

    const rows = Array.isArray(list) ? list : [];
    if (!rows.length) {
      addressListEl.innerHTML =
        '<div style="font-size:12px;color:#9ca3af;">暂无地址：请在上方填写后点击「新增地址」。</div>';
      return;
    }

    rows.forEach((a) => {
      const id = a._id || a.id;
      const fullName = `${a.firstName || ""} ${a.lastName || ""}`.trim() || "收货人";
      const phone = a.phone || "--";
      const line1 = [a.street1, a.apt].filter(Boolean).join(", ");
      const line2 = [a.city, a.state, a.zip].filter(Boolean).join(", ");
      const isDefault = !!a.isDefault;

      const div = document.createElement("div");
      div.className = "address-card";
      div.dataset.id = id || "";

      div.innerHTML = `
        <div class="address-name">${escapeHtml(fullName)} · ${escapeHtml(phone)}</div>
        <div>${escapeHtml(line1 || "--")}</div>
        <div>${escapeHtml(line2 || "--")}</div>
        <div class="address-tag-row">
          ${isDefault ? '<span class="tag-pill">默认地址</span>' : ""}
          <span class="small-pill">点击编辑</span>
        </div>
      `;

      // 点击进入编辑（PUT）
      div.addEventListener("click", () => {
        if (!id) return setAddrHint("该地址缺少 id，无法编辑", false);

        editingAddressId = String(id);

        document.getElementById("addrFirstName").value = a.firstName || "";
        document.getElementById("addrLastName").value = a.lastName || "";
        document.getElementById("addrPhone").value = a.phone || "";
        document.getElementById("addrStreet1").value = a.street1 || "";
        document.getElementById("addrApt").value = a.apt || "";
        document.getElementById("addrCity").value = a.city || "";
        document.getElementById("addrState").value = a.state || "";
        document.getElementById("addrZip").value = a.zip || "";
        document.getElementById("addrDefault").checked = !!a.isDefault;

        const streetEl = document.getElementById("addrStreet1");
        streetEl.dataset.placeId = a.placeId || "";
        streetEl.dataset.lat = typeof a.lat === "number" ? String(a.lat) : "";
        streetEl.dataset.lng = typeof a.lng === "number" ? String(a.lng) : "";

        // 老数据没 place：要求重新下拉选一次
        if (!a.placeId || typeof a.lat !== "number" || typeof a.lng !== "number") {
          STREET_SELECTED = false;
          setAddrHint("⚠️ 该地址缺少 Places 验证信息：请重新从下拉选择街道地址后再点“更新地址”", false);
        } else {
          STREET_SELECTED = true; // ✅ 有 place 就允许直接保存
          setAddrHint("✅ 已进入编辑模式：点击“更新地址”保存修改", true);
        }

        updateAddrButtons();
      });

      addressListEl.appendChild(div);
    });
  }

  async function loadAddresses() {
    try {
      const r = await apiFetch("/api/addresses/my", { method: "GET" });
      const list = normalizeAddressesPayload(r);
      renderAddressList(list);
      updateAddrButtons();
    } catch (e) {
      console.warn("loadAddresses fail:", e.message);
      renderAddressList([]);
      setAddrHint("读取地址失败：" + (e.message || ""), false);
    }
  }

  // ✅ 新增
  async function createAddressToDb(addr) {
    // 如果你的后端新增不是这个路径，就改这里：
    await apiFetch(`/api/addresses`, {
      method: "POST",
      body: JSON.stringify(addr),
    });
  }

  // ✅ 更新
  async function updateAddressToDb(id, addr) {
    await apiFetch(`/api/addresses/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(addr),
    });
  }

  async function saveAddressSmart(addr) {
    if (editingAddressId) return updateAddressToDb(editingAddressId, addr);
    return createAddressToDb(addr);
  }

  function bindAddressButtonsOnce() {
    const btnSave = document.getElementById("addrSaveBtn");
    const btnClear = document.getElementById("addrClearBtn");

    if (btnSave && !btnSave.__bound) {
      btnSave.__bound = true;
      btnSave.addEventListener("click", async () => {
        try {
          setAddrHint("");

          const data = getAddrFormData();
          const err = validateAddr(data);
          if (err) return setAddrHint(err, false);

          const isEdit = !!editingAddressId;
          await saveAddressSmart(data);

          setAddrHint(isEdit ? "✅ 地址已更新（PUT）" : "✅ 地址已新增（POST）", true);

          // 保存后回到“新增模式”
          clearAddrForm(true);
          await loadAddresses();
        } catch (e) {
          setAddrHint("保存失败：" + (e.message || ""), false);
        }
      });
    }

    if (btnClear && !btnClear.__bound) {
      btnClear.__bound = true;
      btnClear.addEventListener("click", () => {
        const wasEditing = !!editingAddressId;
        clearAddrForm(true);
        setAddrHint(wasEditing ? "已取消编辑（现在可以新增地址）" : "已清空，可填写新增地址", true);
      });
    }

    updateAddrButtons();
  }

  // =========================
  // 初始化
  // =========================
  window.addEventListener("DOMContentLoaded", async () => {
    // 1) 菜单
    bindMenu();

    // 2) 地址按钮
    bindAddressButtonsOnce();

    // 3) 初始值
    setBalance(0);
    if (overviewCoupons) overviewCoupons.textContent = "0 张";
    if (overviewOrders) overviewOrders.textContent = "0 单";

    // 4) 用户信息
    await loadUserInfo();

    // 5) 首屏数据（不炸）
    await Promise.allSettled([
      loadWallet(),
      loadOrdersRecent(),
      loadOrdersList(),
      loadAddresses(),
      loadRechargeHistory(),
      loadCoupons(),
    ]);

    // hash跳转
    if (location.hash === "#orders") showTab("orders");
  });
})();
// ✅ 强制加载 orders.js（防止用户中心页面没引入）
(function ensureOrdersJsLoaded() {
  // 如果已经有函数就不重复加载
  if (typeof window.__reloadUserOrders === "function") return;

  const s = document.createElement("script");
  s.src = "/user/assets/js/orders.js?v=" + Date.now(); // ✅ 关键：防缓存
  s.onload = () => console.log("✅ orders.js injected");
  s.onerror = (e) => console.error("❌ orders.js inject failed", e);
  document.head.appendChild(s);
})();
// ===== 修改密码（新增）=====
(function () {
  const $ = (id) => document.getElementById(id);

  function getToken() {
    // 兼容你项目里常见 token key
    const keys = ["freshbuy_token", "token", "jwt", "access_token", "auth_token"];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  async function changePassword() {
    const oldPassword = ($("ucOldPwd")?.value || "").trim();
    const newPassword = ($("ucNewPwd")?.value || "").trim();
    const newPassword2 = ($("ucNewPwd2")?.value || "").trim();
    const msg = $("ucPwdMsg");

    if (!msg) return;

    msg.textContent = "";
    msg.style.color = "#6b7280";

    if (!oldPassword) {
      msg.textContent = "请输入当前密码";
      msg.style.color = "#ef4444";
      return;
    }
    if (newPassword.length < 6) {
      msg.textContent = "新密码至少 6 位";
      msg.style.color = "#ef4444";
      return;
    }
    if (newPassword !== newPassword2) {
      msg.textContent = "两次输入的新密码不一致";
      msg.style.color = "#ef4444";
      return;
    }

    const token = getToken();
    if (!token) {
      msg.textContent = "未登录或 token 丢失，请重新登录后再修改密码";
      msg.style.color = "#ef4444";
      return;
    }

    const btn = $("btnChangePwd");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.7";
      btn.textContent = "提交中...";
    }

    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        credentials: "include",
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        msg.textContent = data.message || "修改失败，请检查当前密码是否正确";
        msg.style.color = "#ef4444";
        return;
      }

      msg.textContent = "✅ 密码修改成功，请用新密码下次登录";
      msg.style.color = "#16a34a";

      $("ucOldPwd").value = "";
      $("ucNewPwd").value = "";
      $("ucNewPwd2").value = "";
    } catch (e) {
      msg.textContent = "网络错误，稍后再试";
      msg.style.color = "#ef4444";
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.textContent = "修改密码";
      }
    }
  }

  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "btnChangePwd") {
      e.preventDefault();
      changePassword();
    }
  });
})();
