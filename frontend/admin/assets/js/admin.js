// Shared admin page behavior. The drawer is owned by admin_sidebar.js; this
// file only keeps a fallback for pages that do not load the shared drawer.
(function () {
  function initLegacySidebarFallback() {
    if (window.FBAdminSidebarDrawer) return;

    const sidebar =
      document.querySelector(".admin-layout > .admin-sidebar") ||
      document.querySelector("aside.admin-sidebar") ||
      document.querySelector(".admin-sidebar, .sidebar, #adminSidebar");
    const toggleBtn = document.querySelector(
      "[data-sidebar-toggle], [data-toggle-sidebar], button.admin-topbar-toggle, .admin-topbar-toggle, #mobileMenuBtn, .mobile-menu-btn, .menu-toggle, .hamburger"
    );

    if (!toggleBtn || !sidebar) return;

    toggleBtn.addEventListener("click", () => {
      const willOpen = !(sidebar.classList.contains("open") || sidebar.classList.contains("is-open"));
      sidebar.classList.toggle("open", willOpen);
      sidebar.classList.toggle("is-open", willOpen);
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

(function () {
  const currentPage = document.body.dataset.page;
  if (!currentPage) return;

  const links = document.querySelectorAll("[data-link]");
  links.forEach((link) => {
    if (link.dataset.link === currentPage) {
      link.classList.add("active");
    }
  });
})();

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
