// frontend/user/assets/js/auth_client.js

// ===============================
// ✅ Auth：token + 清缓存（解决：没登录却显示地址/钱包）
// ===============================
(function () {
  const KEY = "token";

  // ✅ 统一要清理的缓存 key（解决：没登录却显示地址/钱包）
  const CLEAR_KEYS = [
    // token 相关（兼容旧代码/其它模块）
    "token",
    "freshbuy_token",
    "jwt",
    "auth_token",
    "access_token",

    // 登录态/用户信息
    "freshbuy_is_logged_in",
    "freshbuy_login_phone",
    "freshbuy_login_nickname",
    "freshbuy_user",
    "user",

    // 地址/钱包缓存
    "freshbuy_default_address",
    "default_address",
    "freshbuy_wallet_balance",
    "wallet_balance",

    // 购物车/其它缓存
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

    // ✅ 退出：硬清理所有相关缓存
    clear() {
      clearLocalStorageKeys();
      try {
        sessionStorage.clear();
      } catch (e) {}
    },

    clearAll() {
      this.clear();
    },

    async me() {
      const token = this.getToken();
      if (!token) return null;

      const res = await fetch("/api/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });

      // ✅ token 失效：清理，避免“假登录”
      if (!res.ok) {
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

      // ✅ 如果后端注册会返回 token，可开启：
      if (data.token) this.setToken(data.token);

      return data.user;
    },
  };
})();

// ===============================
// ✅ iOS Safari：登录弹窗输入框 focus 不再把弹窗顶走/拖动（终极锁屏）
// 放在 auth_client.js 里统一接管（不要再在 index.html 里写另一套锁屏）
// ===============================
(function () {
  function initIOSModalLock() {
    const backdrop = document.getElementById("authBackdrop");
    if (!backdrop) return;

    let locked = false;
    let savedY = 0;

    function lockPage() {
      if (locked) return;
      locked = true;

      savedY = window.scrollY || window.pageYOffset || 0;

      // 锁住根滚动
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.height = "100%";

      // 锁住 body（iOS 最稳）
      document.body.style.position = "fixed";
      document.body.style.top = `-${savedY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
    }

    function unlockPage() {
      if (!locked) return;
      locked = false;

      document.documentElement.style.overflow = "";
      document.documentElement.style.height = "";

      const top = document.body.style.top;

      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";

      const y = top ? Math.abs(parseInt(top, 10) || 0) : savedY;
      window.scrollTo(0, y);
    }

    function isOpen() {
      return backdrop.classList.contains("active");
    }

    // ✅ 1) 弹窗打开/关闭时锁/解锁
    const mo = new MutationObserver(() => {
      if (isOpen()) lockPage();
      else unlockPage();
    });
    mo.observe(backdrop, { attributes: true, attributeFilter: ["class"] });

    // ✅ 2) 关键：在 focus 发生前（touchstart/pointerdown）提前锁住
    function preLockBeforeFocus(e) {
      if (!isOpen()) return;
      const t = e.target;
      if (!t) return;

      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      ) {
        lockPage();
        // 防止 iOS 已经偷偷滚了一点点
        requestAnimationFrame(() => window.scrollTo(0, 0));
      }
    }

    backdrop.addEventListener("touchstart", preLockBeforeFocus, {
      passive: true,
      capture: true,
    });
    backdrop.addEventListener("pointerdown", preLockBeforeFocus, {
      passive: true,
      capture: true,
    });

    // ✅ 3) 再兜底：focusin 时强拉回顶部（有些机型还是会动一下）
    backdrop.addEventListener(
      "focusin",
      (e) => {
        if (!isOpen()) return;
        const t = e.target;
        if (!t) return;

        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
          lockPage();
          requestAnimationFrame(() => window.scrollTo(0, 0));
        }
      },
      true
    );

    // ✅ 4) 阻止背景滚动（遮罩层 touchmove）
    backdrop.addEventListener(
      "touchmove",
      (e) => {
        if (!isOpen()) return;
        e.preventDefault();
      },
      { passive: false }
    );

    // ✅ 5) 监听 visualViewport（键盘弹出时 viewport 高度变化）
    function onVVChange() {
      if (!isOpen()) return;
      // 保持锁定状态 + 防止抖动
      lockPage();
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onVVChange, { passive: true });
      window.visualViewport.addEventListener("scroll", onVVChange, { passive: true });
    } else {
      window.addEventListener("resize", onVVChange, { passive: true });
    }

    // ✅ 初始化同步一次
    if (isOpen()) lockPage();
  }

  // 确保 DOM 已经有 authBackdrop
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIOSModalLock);
  } else {
    initIOSModalLock();
  }
})();
