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
})();