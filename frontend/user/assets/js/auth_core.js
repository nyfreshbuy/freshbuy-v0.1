// frontend/user/assets/js/auth_core.js
(function () {
  const AUTH_TOKEN_KEYS = ["token", "freshbuy_token", "jwt", "auth_token", "access_token"];

  function normalizeUSPhone(phone) {
    const raw = String(phone || "").trim();
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length === 10) return "+1" + digits;
    if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
    if (raw.startsWith("+")) return "+" + raw.replace(/[^\d]/g, "");
    return raw;
  }

  function getToken() {
    for (const k of AUTH_TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function setToken(token) {
    const t = String(token || "").trim();
    if (!t) return;
    localStorage.setItem("token", t);
    localStorage.setItem("freshbuy_token", t);
  }

  function clearToken() {
    for (const k of AUTH_TOKEN_KEYS) localStorage.removeItem(k);

    [
      "freshbuy_is_logged_in",
      "freshbuy_login_phone",
      "freshbuy_login_nickname",
      "freshbuy_default_address",
      "freshbuy_wallet_balance",
      "user",
      "freshbuy_user",
    ].forEach((k) => localStorage.removeItem(k));
  }

  async function apiFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const token = getToken();
    if (token) headers.Authorization = "Bearer " + token;

    const res = await fetch(url, { ...options, headers });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (
      res.status === 401 ||
      (data &&
        data.success === false &&
        (data.msg === "未登录" || data.message === "未登录"))
    ) {
      clearToken();
    }

    return { res, data };
  }

  async function apiLogin(phone, password) {
    const p = normalizeUSPhone(phone);
    const { res, data } = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: p, password }),
    });

    const ok =
      data?.success === true ||
      data?.ok === true ||
      typeof data?.token === "string";

    if (!res.ok || !ok)
      throw new Error(data?.msg || data?.message || "登录失败");

    if (data?.token) setToken(data.token);

    return data.user || null;
  }

  // ✅ 已修改为走 /api/auth/send-code（带60秒冷却 + 已注册拦截）
  async function apiSendSmsCode(phone) {
    const p = normalizeUSPhone(phone);
    const { res, data } = await apiFetch("/api/auth/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: p }),
    });

    if (!res.ok || !data?.success)
      throw new Error(data?.msg || data?.message || "发送验证码失败");

    return data;
  }

  async function apiVerifyRegister({ phone, code, password, name }) {
    const p = normalizeUSPhone(phone);
    const { res, data } = await apiFetch("/api/auth/verify-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: p,
        code,
        password,
        name,
        autoLogin: true,
      }),
    });

    const ok =
      data?.success === true &&
      typeof data?.token === "string";

    if (!res.ok || !ok)
      throw new Error(data?.msg || data?.message || "注册失败");

    setToken(data.token);

    return data.user || null;
  }

  async function apiMe() {
    const token = getToken();
    if (!token) return null;

    const { res, data } = await apiFetch("/api/auth/me");

    if (!res.ok || !data?.success) return null;

    return data.user || null;
  }

  async function apiGetDefaultAddress() {
    const token = getToken();
    if (!token) return null;

    try {
      const { res, data } = await apiFetch("/api/addresses/my", {
        cache: "no-store",
      });

      if (!res.ok || !data?.success) return null;

      return data.defaultAddress || null;
    } catch {
      return null;
    }
  }

   window.FreshAuth = {
    normalizeUSPhone,
    getToken,
    setToken,
    clearToken,
    apiFetch,
    apiLogin,
    apiSendSmsCode,
    apiVerifyRegister,
    apiMe,
    apiGetDefaultAddress,
  };

  // ================================
  // ✅ UI fallback: bind Login/Register buttons to open modal
  // (support both id styles: loginBtn/registerBtn and btnLogin/btnRegister)
  // ================================
  function $(id) {
    return document.getElementById(id);
  }

  function openAuth(mode) {
    const back = $("authBackdrop");
    const title = $("authTitle");
    const tabLogin = $("tabLogin");
    const tabRegister = $("tabRegister");
    const loginPanel = $("loginPanel");
    const registerPanel = $("registerPanel");
    const forgotPanel = $("forgotPanel");

    if (!back || !loginPanel || !registerPanel) return;

    back.classList.add("active");
    if (forgotPanel) forgotPanel.style.display = "none";

    const isReg = mode === "register";
    loginPanel.style.display = isReg ? "none" : "";
    registerPanel.style.display = isReg ? "" : "none";

    if (title) title.textContent = isReg ? "注册" : "登录";

    if (tabLogin) {
      tabLogin.classList.toggle("active", !isReg);
      tabLogin.setAttribute("aria-selected", String(!isReg));
    }
    if (tabRegister) {
      tabRegister.classList.toggle("active", isReg);
      tabRegister.setAttribute("aria-selected", String(isReg));
    }
  }

  function closeAuth() {
    const back = $("authBackdrop");
    if (back) back.classList.remove("active");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btnLogin = $("loginBtn") || $("btnLogin");
    const btnRegister = $("registerBtn") || $("btnRegister");

    if (btnLogin) {
      btnLogin.addEventListener("click", (e) => {
        e.preventDefault();
        openAuth("login");
      });
    }

    if (btnRegister) {
      btnRegister.addEventListener("click", (e) => {
        e.preventDefault();
        openAuth("register");
      });
    }

    const tabLogin = $("tabLogin");
    const tabRegister = $("tabRegister");
    if (tabLogin) tabLogin.addEventListener("click", () => openAuth("login"));
    if (tabRegister) tabRegister.addEventListener("click", () => openAuth("register"));

    const closeBtn = $("authCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeAuth);

    const back = $("authBackdrop");
    if (back) {
      back.addEventListener("click", (e) => {
        if (e.target === back) closeAuth();
      });
    }
  });
})();