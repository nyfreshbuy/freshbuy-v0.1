// /admin/assets/js/admin_guard.js
(() => {
  // =========================
  // 0) 配置：哪些页面不拦截
  // =========================
  const WHITELIST = [
    "/admin/login.html",
    "/admin/assets/", // 静态资源
  ];

  function isWhitelisted(pathname) {
    const p = String(pathname || "");
    return WHITELIST.some((x) => p.includes(x));
  }

  // =========================
  // 1) Token 统一读取/清理
  // =========================
  function getToken() {
    return (
      localStorage.getItem("freshbuy_token") ||
      localStorage.getItem("admin_token") ||
      localStorage.getItem("adminToken") ||
      localStorage.getItem("token") ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("jwt") ||
      ""
    );
  }

  function clearToken() {
    localStorage.removeItem("freshbuy_token");
    localStorage.removeItem("admin_token");
    localStorage.removeItem("adminToken");
    localStorage.removeItem("token");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("jwt");
  }

  // =========================
  // 2) 统一跳转到登录页（带 next）
  // =========================
  function gotoLogin(extraQuery) {
    const next = encodeURIComponent(location.pathname + location.search);
    const qs = new URLSearchParams();
    qs.set("next", next);
    if (extraQuery && typeof extraQuery === "object") {
      Object.entries(extraQuery).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      });
    }
    location.replace("/admin/login.html?" + qs.toString());
  }

  // =========================
  // 3) 调 /api/auth/me 校验 token + role
  // =========================
  async function fetchMe() {
    const token = getToken();
    if (!token) return { ok: false, reason: "NO_TOKEN" };

    let res, text, data;
    try {
      res = await fetch("/api/auth/me", {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        credentials: "include",
      });
      text = await res.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
    } catch (e) {
      return { ok: false, reason: "NETWORK_ERROR", error: e };
    }

    if (!res.ok || data.success === false) {
      return { ok: false, reason: "BAD_TOKEN", status: res.status, data };
    }

    // 兼容：{user} / {data} / {data:{user}}
    const user =
      data.user ||
      data.data?.user ||
      data.data ||
      data;

    return { ok: true, user, raw: data };
  }

  // =========================
  // 4) UI：填充右上角信息（可选）
  // =========================
  function fillAdminUI(user) {
    const name = user?.nickname || user?.name || user?.phone || "Admin";
    const role = "管理员";

    const nameEl = document.querySelector(".admin-user-name");
    const roleEl = document.querySelector(".admin-user-role");
    const avatarEl = document.querySelector(".admin-user-avatar");

    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;

    // 头像：优先首字母/首汉字
    if (avatarEl) {
      const c = String(name || "A").trim().charAt(0) || "A";
      avatarEl.textContent = c.toUpperCase();
    }
  }

  // =========================
  // 5) 主守卫逻辑
  // =========================
  async function guard() {
    const path = location.pathname || "";

    // login / 静态资源不拦
    if (isWhitelisted(path)) return;

    // 只保护 /admin 路径（防止你在用户端也引用到这个脚本）
    // 如果你确定只会在 /admin 引用，可以删掉这段
    if (!path.startsWith("/admin")) return;

    const r = await fetchMe();

    if (!r.ok) {
      // token 缺失或无效：清理 + 去登录
      if (r.reason === "BAD_TOKEN" || r.reason === "NO_TOKEN") {
        clearToken();
      }
      gotoLogin({ reason: r.reason || "NEED_LOGIN" });
      return;
    }

    // ✅ 必须 admin（统一转小写比较）
    const role = String(r.user?.role || "").toLowerCase();
    if (role !== "admin") {
      clearToken();
      gotoLogin({ reason: "NOT_ADMIN" });
      return;
    }

    // ✅ 通过：填充 UI
    fillAdminUI(r.user);
  }

  document.addEventListener("DOMContentLoaded", guard);
})();
