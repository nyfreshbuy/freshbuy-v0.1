// frontend/user/assets/js/auth_client.js
(function () {
  const KEY = "token";

  // ✅ 统一要清理的缓存 key（解决：没登录却显示地址/钱包）
  const CLEAR_KEYS = [
    // token 相关（你当前只用 KEY，但为了兼容旧代码/其它模块）
    "token",
    "freshbuy_token",
    "jwt",
    "auth_token",
    "access_token",

    // 登录态/用户信息（如果别的页面写过）
    "freshbuy_is_logged_in",
    "freshbuy_login_phone",
    "freshbuy_login_nickname",
    "freshbuy_user",
    "user",

    // 地址/钱包缓存（你这次截图问题的核心）
    "freshbuy_default_address",
    "default_address",
    "freshbuy_wallet_balance",
    "wallet_balance",

    // 购物车/其它可能影响 UI 的缓存（可保留也可清）
    "fresh_cart",
    "cart",
  ];

  function clearLocalStorageKeys() {
    for (const k of CLEAR_KEYS) localStorage.removeItem(k);
  }

  window.Auth = {
    getToken() {
      return localStorage.getItem(KEY) || "";
    },

    setToken(t) {
      if (t) localStorage.setItem(KEY, t);
    },

    // ✅ 你原来的 clear() 只删 token，导致地址/钱包等缓存还在
    // ✅ 现在改成：退出时硬清理（推荐）
    clear() {
      clearLocalStorageKeys();
      try {
        sessionStorage.clear();
      } catch (e) {}
    },

    // ✅ 可选：如果你以后想更明确地调用“清空所有”
    clearAll() {
      this.clear();
    },

    async me() {
      const token = this.getToken();
      if (!token) return null;

      const res = await fetch("/api/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });

      // ✅ 如果 token 失效：顺便清掉，避免“假登录”
      if (!res.ok) {
        // 401/403/500 都当作登录态无效
        this.clear();
        return null;
      }

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

      // ✅ 如果你注册后也会自动登录（有 token），可加：
      // if (data.token) this.setToken(data.token);

      return data.user;
    },
  };
})();
// ===============================
// ✅ iOS 输入框 focus 防止页面滚动（终极方案）
// ===============================
(function () {
  const backdrop = document.getElementById("authBackdrop");
  if (!backdrop) return;

  let locked = false;
  let scrollY = 0;

  function lockPage() {
    if (locked) return;
    locked = true;

    scrollY = window.scrollY || window.pageYOffset || 0;

    document.documentElement.style.height = "100%";
    document.documentElement.style.overflow = "hidden";

    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function unlockPage() {
    if (!locked) return;
    locked = false;

    document.documentElement.style.height = "";
    document.documentElement.style.overflow = "";

    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";

    window.scrollTo(0, scrollY);
  }

  // ✅ 弹窗打开 / 关闭时锁页面
  new MutationObserver(() => {
    if (backdrop.classList.contains("active")) {
      lockPage();
    } else {
      unlockPage();
    }
  }).observe(backdrop, { attributes: true, attributeFilter: ["class"] });

  // ✅ 核心：input focus 时，强制阻止 Safari 滚动
  backdrop.addEventListener(
    "focusin",
    (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        lockPage();
        // ❗关键：把滚动强行拉回 0
        requestAnimationFrame(() => {
          window.scrollTo(0, 0);
        });
      }
    },
    true
  );
})();
