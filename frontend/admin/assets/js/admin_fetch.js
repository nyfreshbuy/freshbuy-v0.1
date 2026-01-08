// frontend/admin/assets/js/admin_fetch.js
(function () {
  const TOKEN_KEY = "freshbuy_token";

  async function adminFetch(url, options = {}) {
    const token = localStorage.getItem(TOKEN_KEY) || "";
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

  window.adminFetch = adminFetch;
})();
