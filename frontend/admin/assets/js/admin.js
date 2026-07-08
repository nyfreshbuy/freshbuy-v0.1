// 简单的 sidebar 开关（移动端）
(function () {
  function initLegacySidebarFallback() {
    if (window.FBAdminSidebarDrawer) return;

    const sidebar =
      document.querySelector(".admin-layout > .admin-sidebar") ||
      document.querySelector("aside.admin-sidebar") ||
      document.querySelector(".admin-sidebar, .sidebar, #adminSidebar");
    const toggleBtn = document.querySelector(
      "#mobileMenuBtn, .mobile-menu-btn, .hamburger, .menu-toggle, [data-sidebar-toggle], [data-toggle-sidebar], .admin-topbar-toggle"
    );

    if (!toggleBtn || !sidebar) return;

    toggleBtn.addEventListener("click", () => {
      const willOpen = !(sidebar.classList.contains("open") || sidebar.classList.contains("is-open"));
      sidebar.classList.toggle("is-open", willOpen);
      sidebar.classList.toggle("open", willOpen);
      document.body.classList.toggle("sidebar-open", willOpen);
      document.body.classList.toggle("admin-sidebar-open", willOpen);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLegacySidebarFallback);
  } else {
    setTimeout(initLegacySidebarFallback, 0);
  }
})();

// 根据 body data-page 自动高亮菜单
(function () {
  const currentPage = document.body.dataset.page; // 比如 "dashboard" / "products"
  if (!currentPage) return;

  const links = document.querySelectorAll("[data-link]");
  links.forEach((link) => {
    if (link.dataset.link === currentPage) {
      link.classList.add("active");
    }
  });
})();

// 预留：不同页面的初始化（如果以后要加页面专属 JS）
window.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;

  if (page === "dashboard") {
    // initDashboard();
  }
  if (page === "products") {
    // initProducts();
  }
  if (page === "orders") {
    // initOrders();
  }
});
