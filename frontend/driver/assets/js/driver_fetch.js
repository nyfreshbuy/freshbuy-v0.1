(function () {
  const TOKEN_KEYS = [
    "driver_token",
    "freshbuy_driver_token",
    "token",
    "jwt",
    "access_token",
  ];

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  async function driverFetch(url, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", "Bearer " + token);
    }
    return fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });
  }

  window.driverFetch = driverFetch;
  window.__driverGetToken = getToken;
})();
