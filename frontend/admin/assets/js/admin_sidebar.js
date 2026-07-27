// frontend/admin/assets/js/admin_sidebar.js
(function () {
  const LINKS = [
    { section: "总览", items: [{ text: "仪表盘", href: "/admin/dashboard.html", icon: "◎" }] },
    {
      section: "业务管理",
      items: [
        { text: "订单管理", href: "/admin/orders.html", icon: "□" },
        { text: "发票管理", href: "/admin/invoices.html", icon: "🧾" },
        { text: "商品管理", href: "/admin/products.html", icon: "◆" },
        { text: "用户管理", href: "/admin/users.html", icon: "👤" },
        { text: "团长管理", href: "/admin/leaders.html", icon: "团" },
        { text: "司机管理", href: "/admin/drivers.html", icon: "🚚" },
        { text: "配送区域 Zone", href: "/admin/zones.html", icon: "🗺️" },
        { text: "自提点管理", href: "/admin/pickups.html", icon: "⛳" },
        { text: "自提点审核", href: "/admin/pickup_change_requests.html", icon: "审" },
        { text: "配货批次", href: "/admin/packing.html", icon: "📦" },
        { text: "派单与路线", href: "/admin/dispatch.html", icon: "🧭" },
      ],
    },
    {
      section: "运营",
      items: [
        { text: "营销中心", href: "/admin/marketing.html", icon: "%" },
        { text: "横幅广告", href: "/admin/banner_edit.html", icon: "🖼️" },
        { text: "结算管理", href: "/admin/settlements.html", icon: "$" },
        { text: "库存净资产", href: "/admin/inventory_assets.html", icon: "💰" },
        { text: "利润中心", href: "/admin/profit_center.html", icon: "📊" },
        { text: "后台充值", href: "/admin/recharge.html", icon: "💰" },
        { text: "Zelle充值审核", href: "/admin/recharge_audit.html", icon: "✅" },
        { text: "充值对账", href: "/admin/recharge_reconcile.html", icon: "📒" },
        { text: "配送方式说明", href: "/admin/delivery_settings.html", icon: "📝" },
      ],
    },
    { section: "系统", items: [{ text: "系统设置", href: "/admin/settings.html", icon: "⚙" }] },
  ];

  const TOGGLE_SELECTOR = [
    "[data-sidebar-toggle]",
    "[data-toggle-sidebar]",
    "button.admin-topbar-toggle",
    ".admin-topbar-toggle",
    "#mobileMenuBtn",
    ".mobile-menu-btn",
    ".menu-toggle",
    ".hamburger",
    ".fb-admin-menu-button",
  ].join(", ");

  function safeText(value) {
    return String(value ?? "").replace(/[<>&"]/g, (c) => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
    }[c]));
  }

  function normalizePath(path) {
    try {
      return new URL(path, location.origin).pathname;
    } catch {
      return path;
    }
  }

  function getSidebarHost() {
    return (
      document.getElementById("adminSidebar") ||
      document.querySelector(".admin-sidebar") ||
      document.querySelector("#sidebar") ||
      document.querySelector(".sidebar")
    );
  }

  function getSidebar() {
    const host = getSidebarHost();
    if (!host) return null;
    return host.closest(".admin-sidebar, .sidebar") || host;
  }

  function renderSidebar() {
    const host = getSidebarHost();
    if (!host) return null;

    const sidebar = host.closest(".admin-sidebar, .sidebar") || host;
    sidebar.classList.add("admin-sidebar");
    if (host !== sidebar) host.classList.add("admin-sidebar-content");

    const currentPath = location.pathname;
    const html = LINKS.map((section) => {
      const itemsHtml = section.items.map((item) => {
        const active = normalizePath(item.href) === currentPath ? "active" : "";
        return `
          <a class="nav-item ${active}" href="${safeText(item.href)}">
            <span class="nav-ic">${safeText(item.icon)}</span>
            <span class="nav-t">${safeText(item.text)}</span>
          </a>
        `;
      }).join("");

      return `
        <div class="nav-section">
          <div class="nav-title">${safeText(section.section)}</div>
          <div class="nav-list">${itemsHtml}</div>
        </div>
      `;
    }).join("");

    host.innerHTML = `
      <button type="button" class="fb-admin-sidebar-close sidebar-close" data-sidebar-close aria-label="Close admin menu">
        <span aria-hidden="true">&times;</span>
      </button>
      ${html}
    `;

    return sidebar;
  }

  function ensureBackdrop() {
    let backdrop = document.querySelector(".sidebar-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "sidebar-backdrop";
      document.body.appendChild(backdrop);
    }
    return backdrop;
  }

  function findMenuButton() {
    return document.querySelector(TOGGLE_SELECTOR);
  }

  function ensureMenuButton() {
    let button = findMenuButton();
    if (button) {
      button.setAttribute("data-sidebar-toggle", "true");
      button.classList.add("fb-admin-menu-button");
      return button;
    }

    button = document.createElement("button");
    button.type = "button";
    button.className = "fb-admin-menu-button";
    button.setAttribute("data-sidebar-toggle", "true");
    button.setAttribute("aria-label", "Open admin menu");
    button.innerHTML = "&#9776;";
    document.body.insertBefore(button, document.body.firstChild);
    return button;
  }

  function setSidebarOpen(open) {
    const sidebar = getSidebar();
    const backdrop = ensureBackdrop();

    if (!sidebar) {
      console.error("[sidebar] sidebar element not found");
      return;
    }

    document.body.classList.toggle("sidebar-open", open);
    document.body.classList.toggle("admin-sidebar-open", open);
    sidebar.classList.toggle("open", open);
    sidebar.classList.toggle("is-open", open);
    backdrop.classList.toggle("open", open);

    const button = findMenuButton();
    if (button) button.setAttribute("aria-expanded", open ? "true" : "false");

    console.log(open ? "[sidebar] opened" : "[sidebar] closed");
  }

  function toggleSidebar() {
    const sidebar = getSidebar();
    if (!sidebar) {
      console.error("[sidebar] sidebar element not found");
      return;
    }

    const isOpen =
      document.body.classList.contains("sidebar-open") ||
      sidebar.classList.contains("open") ||
      sidebar.classList.contains("is-open");

    setSidebarOpen(!isOpen);
    console.log("[sidebar] toggled:", !isOpen);
  }

  function injectStyleIfNeeded() {
    if (document.getElementById("adminSidebarStyle")) return;

    const style = document.createElement("style");
    style.id = "adminSidebarStyle";
    style.textContent = `
      .nav-section{margin:14px 0}
      .nav-title{opacity:.7;font-size:12px;margin:10px 12px}
      .nav-list{display:flex;flex-direction:column;gap:6px;padding:0 8px}
      .nav-item{
        display:flex;align-items:center;gap:10px;
        padding:10px 10px;border-radius:12px;
        text-decoration:none;color:inherit;
        border:1px solid rgba(255,255,255,.06);
        background:rgba(255,255,255,.02);
      }
      .nav-item:hover{border-color:rgba(255,255,255,.14);transform:translateY(-1px)}
      .nav-item.active{
        border-color:rgba(59,130,246,.45);
        background:rgba(59,130,246,.10);
      }
      .nav-ic{width:22px;text-align:center;opacity:.9}
      .nav-t{font-weight:700;font-size:14px}
      .fb-admin-sidebar-close{
        display:none;
        width:100%;min-height:44px;
        margin:0 0 10px;
        border:1px solid rgba(255,255,255,.14);
        border-radius:12px;
        background:rgba(255,255,255,.08);
        color:inherit;
        font-size:26px;line-height:1;
        cursor:pointer;
      }
      .sidebar-backdrop{display:none;pointer-events:none}
      @media (max-width:768px){
        html,body{width:100%;max-width:100%;overflow-x:hidden!important}
        body.sidebar-open{overflow:hidden!important}
        .admin-layout{display:block!important}
        #adminSidebar,
        .admin-sidebar,
        .sidebar{
          position:fixed!important;
          top:0!important;
          left:0!important;
          width:min(82vw,320px)!important;
          max-width:320px!important;
          height:100dvh!important;
          max-height:100dvh!important;
          overflow-y:auto!important;
          overflow-x:hidden!important;
          -webkit-overflow-scrolling:touch;
          transform:translateX(-105%)!important;
          transition:transform .25s ease!important;
          z-index:9999!important;
          visibility:visible!important;
          padding:12px 10px calc(32px + env(safe-area-inset-bottom,0px))!important;
          margin:0!important;
          background:#020617;
          color:#e5e7eb;
          box-shadow:18px 0 42px rgba(15,23,42,.28);
        }
        body.sidebar-open #adminSidebar,
        body.sidebar-open .admin-sidebar,
        body.sidebar-open .sidebar,
        #adminSidebar.open,
        .admin-sidebar.open,
        .sidebar.open{
          transform:translateX(0)!important;
        }
        .sidebar-backdrop{
          display:none;
          pointer-events:none;
        }
        body.sidebar-open .sidebar-backdrop,
        .sidebar-backdrop.open{
          display:block!important;
          position:fixed;
          inset:0;
          background:rgba(0,0,0,.45);
          z-index:9998;
          pointer-events:auto;
        }
        ${TOGGLE_SELECTOR}{
          position:relative!important;
          z-index:10001!important;
          pointer-events:auto!important;
          touch-action:manipulation;
        }
        .fb-admin-sidebar-close{
          position:sticky;
          top:0;
          z-index:2;
          display:flex;
          align-items:center;
          justify-content:center;
          backdrop-filter:blur(12px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setupSidebarEvents() {
    const sidebar = getSidebar();
    const backdrop = ensureBackdrop();
    const menuButton = ensureMenuButton();

    console.log("[sidebar] menu button:", menuButton);
    console.log("[sidebar] sidebar:", sidebar);

    if (document.body.dataset.sidebarDelegateBound === "true") return;
    document.body.dataset.sidebarDelegateBound = "true";

    document.addEventListener("click", function (event) {
      const toggle = event.target.closest(TOGGLE_SELECTOR);
      if (!toggle) return;

      console.log("[sidebar] menu clicked");
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      toggleSidebar();
    }, true);

    backdrop.addEventListener("click", function () {
      setSidebarOpen(false);
    });

    document.addEventListener("click", function (event) {
      const closeButton = event.target.closest("[data-sidebar-close], [data-close-sidebar], .sidebar-close");
      if (closeButton) {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }

      if (!document.body.classList.contains("sidebar-open")) return;

      const link = event.target.closest(".admin-sidebar a, #adminSidebar a, .sidebar a");
      if (link && window.matchMedia("(max-width: 768px)").matches) {
        setSidebarOpen(false);
      }
    });

    window.FBAdminSidebarDrawer = {
      open: () => setSidebarOpen(true),
      close: () => setSidebarOpen(false),
      toggle: toggleSidebar,
    };
  }

  function initAdminSidebar() {
    try {
      console.log("[sidebar] script loaded");
      injectStyleIfNeeded();
      renderSidebar();
      setupSidebarEvents();
    } catch (error) {
      console.error("[sidebar] init failed", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminSidebar);
  } else {
    initAdminSidebar();
  }
})();
