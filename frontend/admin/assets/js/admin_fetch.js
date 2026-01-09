// frontend/admin/assets/js/admin_fetch.js
(function () {
  // 兼容你项目里可能出现过的多种 token key
  const TOKEN_KEYS = [
    "freshbuy_token",
    "adminToken",
    "admin_token",
    "token",
    "jwt",
  ];

  function getToken() {
    // localStorage 优先，其次 sessionStorage
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    for (const k of TOKEN_KEYS) {
      const v = sessionStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function mergeHeaders(h) {
    return new Headers(h || {});
  }

  async function adminFetch(url, options = {}) {
    const token = getToken();
    const headers = mergeHeaders(options.headers);

    // ✅ 永远尽量带上 Authorization（除非调用方已经显式传了）
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", "Bearer " + token);
    }

    // ✅ 常用默认值（不影响）
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    return fetch(url, {
      ...options,
      headers,
      credentials: options.credentials || "include",
      cache: options.cache || "no-store",
    });
  }

  window.adminFetch = adminFetch;

  // 调试用：你可以在 Console 输入 __adminToken() 看当前取到的 token
  window.__adminToken = getToken;
})();
