// frontend/admin/assets/js/admin_auth_ui.js
(function () {
  const TOKEN_KEY = "freshbuy_token";
  const ROLE_KEY = "freshbuy_role";
  const NICK_KEY = "freshbuy_login_nickname";

  // 自动寻找顶部容器（如果你已有 topbar/header 就塞进去；没有就自己创建一个浮动条）
  function ensureAuthBox() {
    let box = document.getElementById("adminAuthBox");
    if (box) return box;

    // 你页面里如果有 header/topbar 容器，优先插进去
    const host =
      document.querySelector(".topbar") ||
      document.querySelector("header") ||
      document.body;

    box = document.createElement("div");
    box.id = "adminAuthBox";
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.gap = "12px";

    // 如果插到 body 且没有 topbar，就做成右上角浮动
    if (host === document.body) {
      box.style.position = "fixed";
      box.style.right = "16px";
      box.style.top = "16px";
      box.style.zIndex = "9999";
      box.style.background = "#fff";
      box.style.border = "1px solid rgba(0,0,0,0.08)";
      box.style.boxShadow = "0 6px 18px rgba(0,0,0,0.08)";
      box.style.padding = "10px 12px";
      box.style.borderRadius = "12px";
    }

    box.innerHTML = `
      <span id="adminWelcome" style="display:none;color:#374151;"></span>
      <button id="btnAdminLogin" style="display:none; padding:8px 12px; border-radius:10px; border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer;">
        登录
      </button>
      <button id="btnAdminLogout" style="display:none; padding:8px 12px; border-radius:10px; border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer;">
        登出
      </button>
    `;

    host.appendChild(box);
    return box;
  }

  const box = ensureAuthBox();
  const elWelcome = box.querySelector("#adminWelcome");
  const btnLogin = box.querySelector("#btnAdminLogin");
  const btnLogout = box.querySelector("#btnAdminLogout");

  const token = localStorage.getItem(TOKEN_KEY);
  const role = localStorage.getItem(ROLE_KEY);
  const nickname = localStorage.getItem(NICK_KEY) || "管理员";

  const isAdminLoggedIn = Boolean(token && role === "admin");

  // 登录页不显示“登录”按钮也行（避免重复）
  const isLoginPage = /\/admin\/login\.html$/i.test(location.pathname) || /login\.html$/i.test(location.pathname);

  if (isAdminLoggedIn) {
    elWelcome.style.display = "inline";
    elWelcome.textContent = `你好，${nickname}`;
    btnLogout.style.display = "inline-block";
  } else {
    if (!isLoginPage) btnLogin.style.display = "inline-block";
  }

  btnLogin.addEventListener("click", () => {
    location.href = "./login.html"; // 你登录页就在同级
  });

  btnLogout.addEventListener("click", () => {
    if (!confirm("确认退出后台登录？")) return;

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(NICK_KEY);
    localStorage.removeItem("freshbuy_is_logged_in");

    location.href = "./login.html";
  });
})();
