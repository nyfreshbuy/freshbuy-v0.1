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
        // ✅ 你要新增的：派单与路线
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
        // ✅ 你要新增的：配送方式说明
        { text: "配送方式说明", href: "/admin/delivery_settings.html", icon: "📝" },
      ],
    },

    { section: "系统", items: [{ text: "系统设置", href: "/admin/settings.html", icon: "⚙" }] },
  ];

  function safeText(s) {
    return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  function normalizePath(p) {
    // 只比对 pathname，避免 ?xxx 干扰
    try {
      const u = new URL(p, location.origin);
      return u.pathname;
    } catch {
      return p;
    }
  }

  function renderSidebar() {
    const host =
      document.getElementById("adminSidebar") ||
      document.querySelector(".admin-sidebar") ||
      document.querySelector("#sidebar") ||
      document.querySelector(".sidebar");

    if (!host) return; // 页面没侧边栏容器就跳过

    host.classList.add("admin-sidebar");

    const cur = location.pathname;

    const html = LINKS.map((sec) => {
      const itemsHtml = sec.items
        .map((it) => {
          const active = normalizePath(it.href) === cur ? "active" : "";
          return `
            <a class="nav-item ${active}" href="${safeText(it.href)}">
              <span class="nav-ic">${safeText(it.icon)}</span>
              <span class="nav-t">${safeText(it.text)}</span>
            </a>
          `;
        })
        .join("");

      return `
        <div class="nav-section">
          <div class="nav-title">${safeText(sec.section)}</div>
          <div class="nav-list">${itemsHtml}</div>
        </div>
      `;
    }).join("");

    host.innerHTML = `
      <button type="button" class="fb-admin-sidebar-close" data-close-sidebar aria-label="Close admin menu">
        <span aria-hidden="true">&times;</span>
      </button>
      ${html}
    `;
  }

  function setupMobileDrawer() {
    const sidebar =
      document.querySelector(".admin-sidebar") ||
      document.getElementById("adminSidebar") ||
      document.querySelector("#sidebar") ||
      document.querySelector(".sidebar");
    if (!sidebar) return;

    sidebar.classList.add("admin-sidebar");

    let backdrop = document.querySelector(".fb-admin-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "fb-admin-backdrop";
      document.body.appendChild(backdrop);
    }

    let toggle =
      document.querySelector("[data-toggle-sidebar]") ||
      document.querySelector(".admin-topbar-toggle") ||
      document.querySelector(".fb-admin-menu-button");

    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "fb-admin-menu-button";
      toggle.dataset.toggleSidebar = "true";
      toggle.setAttribute("aria-label", "Open admin menu");
      toggle.innerHTML = "&#9776;";
      document.body.insertBefore(toggle, document.body.firstChild);
    }

    toggle.classList.add("fb-admin-menu-button");
    if (toggle.dataset.fbDrawerBound === "true") return;
    toggle.dataset.fbDrawerBound = "true";

    const close = () => {
      sidebar.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      document.body.classList.remove("admin-sidebar-open");
      toggle.setAttribute("aria-expanded", "false");
    };

    const open = () => {
      sidebar.classList.add("is-open");
      backdrop.classList.add("is-open");
      document.body.classList.add("admin-sidebar-open");
      toggle.setAttribute("aria-expanded", "true");
    };

    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      sidebar.classList.contains("is-open") ? close() : open();
    });

    backdrop.addEventListener("click", close);
    sidebar.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-sidebar]") || e.target.closest("a")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // ✅ 给没有统一样式的页面，补一份最低限度的 sidebar 样式
  function injectStyleIfNeeded() {
    if (document.getElementById("adminSidebarStyle")) return;
    const style = document.createElement("style");
    style.id = "adminSidebarStyle";
    style.textContent = `
      .nav-section{margin:14px 0}
      .fb-admin-backdrop{
        position:fixed;inset:0;z-index:9998;
        display:none;background:rgba(15,23,42,.48);
      }
      .fb-admin-backdrop.is-open{display:block}
      .fb-admin-menu-button{
        display:none;
        min-width:44px;min-height:44px;
        border:0;border-radius:12px;
        background:#111827;color:#fff;
        font-size:22px;line-height:1;
        box-shadow:0 8px 24px rgba(15,23,42,.18);
      }
      .fb-admin-sidebar-close{
        display:none;
        width:100%;min-height:44px;
        margin:0 0 10px;
        border:1px solid rgba(255,255,255,.14);
        border-radius:12px;
        background:rgba(255,255,255,.08);
        color:inherit;
        font-size:26px;line-height:1;
      }
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
      @media (max-width:768px){
        .fb-admin-menu-button{
          position:fixed;top:10px;left:10px;z-index:10000;
          display:inline-flex;align-items:center;justify-content:center;
        }
        .fb-admin-sidebar-close{
          position:sticky;top:0;z-index:2;
          display:flex;align-items:center;justify-content:center;
          backdrop-filter:blur(12px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  injectStyleIfNeeded();
  renderSidebar();
  setupMobileDrawer();
})();
