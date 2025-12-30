(function () {
  const KEY = "token";

  window.Auth = {
    getToken() {
      return localStorage.getItem(KEY) || "";
    },
    setToken(t) {
      if (t) localStorage.setItem(KEY, t);
    },
    clear() {
      localStorage.removeItem(KEY);
    },
    async me() {
      const token = this.getToken();
      if (!token) return null;

      const res = await fetch("/api/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.user || null;
    },
    async login(phone, password) {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.msg || "登录失败");
      this.setToken(data.token);
      return data.user;
    },
    async register(name, phone, password) {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, password }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.msg || "注册失败");
      return data.user;
    },
  };
})();
