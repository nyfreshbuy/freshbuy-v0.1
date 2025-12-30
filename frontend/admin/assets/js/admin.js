// 简单的 sidebar 开关（移动端）
const sidebar = document.querySelector(".admin-sidebar");
const toggleBtn = document.querySelector("[data-toggle-sidebar]");

if (toggleBtn && sidebar) {
  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("is-open");
  });
}

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