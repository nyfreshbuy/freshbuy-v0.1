(function () {
  "use strict";

  const path = location.pathname || "";
  const bodyReady = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  };

  function setViewportHeight() {
    const vv = window.visualViewport;
    const h = vv && vv.height ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--fb-app-vh", `${Math.round(h)}px`);
    document.documentElement.style.setProperty("--vvh", `${Math.round(h)}px`);
  }

  function setScopeClass() {
    if (!document.body) return;
    const scope =
      path.startsWith("/admin/") ? "admin" :
      path.startsWith("/leader/") ? "leader" :
      path.startsWith("/driver/") ? "driver" :
      path.startsWith("/user/") ? "user" : "public";
    document.body.classList.add(`fb-scope-${scope}`);
    document.documentElement.classList.add(`fb-scope-${scope}`);
  }

  function svg(name) {
    const icons = {
      home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
      grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h7v7H4z"/><path d="M13 4h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M13 13h7v7h-7z"/></svg>',
      cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 6h16l-2 9H7L5 3H2"/><path d="M8 20h.01"/><path d="M18 20h.01"/></svg>',
      orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>',
      user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21a8 8 0 0 0-16 0"/><path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>',
    };
    return icons[name] || "";
  }

  function getCartQty() {
    try {
      const apiQty = window.FreshCart?.getState?.()?.items?.reduce((n, it) => n + Number(it.qty || 0), 0);
      if (Number.isFinite(apiQty)) return apiQty;
    } catch {}
    try {
      const raw = localStorage.getItem("fresh_cart_v1");
      const data = raw ? JSON.parse(raw) : null;
      const items = Array.isArray(data?.items) ? data.items : [];
      return items.reduce((n, it) => n + Number(it.qty || 0), 0);
    } catch {
      return 0;
    }
  }

  function updateTabCartCount() {
    const el = document.querySelector("[data-fb-tab-cart-count]");
    if (!el) return;
    const n = getCartQty();
    el.textContent = n > 0 ? String(n > 99 ? "99+" : n) : "";
  }

  function setupUserTabs() {
    if (!path.startsWith("/user/")) return;
    if (!document.body || document.body.dataset.hideAppTabs === "true") return;
    if (/(offline|terms|privacy|refund|support|about|recharge_success|recharge_cancel|wallet_test)\.html$/i.test(path)) return;
    if (document.querySelector(".fb-app-tabbar")) return;

    const tabs = [
      { key: "home", label: "首页", href: "/user/index.html", icon: "home", match: /\/user\/(index|newcomer|hot|DailySpecial|New|Best|Normal)?\.?html?$/i },
      { key: "category", label: "分类", href: "/user/category.html", icon: "grid", match: /\/user\/category\.html/i },
      { key: "cart", label: "购物车", href: "/user/cart.html", icon: "cart", match: /\/user\/cart|checkout|product_detail/i },
      { key: "orders", label: "订单", href: "/user/orders.html", icon: "orders", match: /\/user\/orders|order_detail/i },
      { key: "mine", label: "我的", href: "/user/user_center.html", icon: "user", match: /\/user\/user_center|recharge|forgot_password/i },
    ];

    const nav = document.createElement("nav");
    nav.className = "fb-app-tabbar";
    nav.setAttribute("aria-label", "Freshbuy app tabs");
    nav.innerHTML = tabs.map((tab) => {
      const active = tab.match.test(path) ? " is-active" : "";
      const badge = tab.key === "cart" ? '<span class="fb-app-tab-count" data-fb-tab-cart-count></span>' : "";
      return `<a class="fb-app-tab${active}" href="${tab.href}">
        <span class="fb-app-tab-icon">${svg(tab.icon)}</span>
        <span>${tab.label}</span>
        ${badge}
      </a>`;
    }).join("");
    document.body.appendChild(nav);
    document.body.classList.add("fb-has-app-tabs");
    updateTabCartCount();
  }

  function enhanceTables() {
    const tables = Array.from(document.querySelectorAll("table"));
    tables.forEach((table) => {
      if (table.dataset.mobileReady === "true") return;
      if (table.closest(".print-only") || table.closest("[data-no-mobile-card]")) return;
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
      if (!headers.length) {
        const firstRow = table.querySelector("tr");
        if (firstRow) {
          Array.from(firstRow.children).forEach((cell, idx) => {
            if (cell.tagName === "TH") headers[idx] = cell.textContent.trim();
          });
        }
      }
      if (!headers.length) return;
      Array.from(table.querySelectorAll("tbody tr")).forEach((tr) => {
        Array.from(tr.children).forEach((td, idx) => {
          if (td.tagName !== "TD") return;
          if (!td.dataset.label) td.dataset.label = headers[idx] || "";
        });
      });
      table.dataset.mobileCard = "true";
      table.dataset.mobileReady = "true";
    });
  }

  function setupAdminDrawer() {
    if (!path.startsWith("/admin/")) return;
    const sidebar = document.querySelector(".admin-sidebar");
    if (!sidebar) return;

    let backdrop = document.querySelector(".fb-admin-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "fb-admin-backdrop";
      document.body.appendChild(backdrop);
    }

    let btn = document.querySelector("[data-toggle-sidebar], .admin-topbar-toggle");
    const topbar = document.querySelector(".admin-topbar") || document.querySelector("header");
    if (!btn && topbar) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fb-admin-menu-button";
      btn.setAttribute("aria-label", "打开后台菜单");
      btn.innerHTML = "☰";
      topbar.insertBefore(btn, topbar.firstChild);
    }
    if (btn) btn.classList.add("fb-admin-menu-button");
    if (btn?.dataset.fbDrawerBound === "true") return;
    if (btn) btn.dataset.fbDrawerBound = "true";

    const close = () => {
      sidebar.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      document.body.classList.remove("fb-admin-drawer-open");
    };
    const open = () => {
      sidebar.classList.add("is-open");
      backdrop.classList.add("is-open");
      document.body.classList.add("fb-admin-drawer-open");
    };
    const toggle = () => sidebar.classList.contains("is-open") ? close() : open();

    btn?.addEventListener("click", (e) => {
      e.preventDefault();
      toggle();
    });
    backdrop.addEventListener("click", close);
    sidebar.addEventListener("click", (e) => {
      if (e.target.closest("a")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  function setupFriendlyNetworkState() {
    const showOffline = () => {
      window.FreshbuyApp?.toast?.("网络连接异常，请稍后重试");
    };
    window.addEventListener("offline", showOffline);
    window.addEventListener("online", () => window.FreshbuyApp?.toast?.("网络已恢复"));
  }

  function setupToast() {
    if (window.FreshbuyApp?.toast) return;
    window.FreshbuyApp = window.FreshbuyApp || {};
    window.FreshbuyApp.toast = function toast(message, options = {}) {
      const text = String(message || "").trim();
      if (!text) return;
      let host = document.querySelector(".fb-mobile-toast-host");
      if (!host) {
        host = document.createElement("div");
        host.className = "fb-mobile-toast-host";
        document.body.appendChild(host);
      }
      const el = document.createElement("div");
      el.className = "fb-mobile-toast";
      el.textContent = text;
      host.appendChild(el);
      requestAnimationFrame(() => el.classList.add("is-show"));
      const ms = Number(options.duration || 2600);
      window.setTimeout(() => {
        el.classList.remove("is-show");
        window.setTimeout(() => el.remove(), 220);
      }, ms);
    };
  }

  function observeDynamicTables() {
    let pending = false;
    const obs = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        enhanceTables();
        updateTabCartCount();
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function patchFileInputsForMobileCamera() {
    document.querySelectorAll('input[type="file"]').forEach((input) => {
      if (!input.getAttribute("accept") && /photo|image|proof|file|upload/i.test(input.id + " " + input.name + " " + input.className)) {
        input.setAttribute("accept", "image/*");
      }
    });
  }

  setViewportHeight();
  window.addEventListener("resize", setViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("resize", setViewportHeight, { passive: true });

  bodyReady(() => {
    setScopeClass();
    setupToast();
    setupUserTabs();
    enhanceTables();
    setupAdminDrawer();
    setupFriendlyNetworkState();
    patchFileInputsForMobileCamera();
    observeDynamicTables();
    window.addEventListener("freshcart:updated", updateTabCartCount);
    window.addEventListener("freshbuy:cart_updated", updateTabCartCount);
    window.addEventListener("storage", updateTabCartCount);
  });
})();
