// frontend/user/assets/js/auth_client.js
(function () {
  const KEY = "token";

  // ✅ 统一要清理的缓存 key（解决：没登录却显示地址/钱包）
  const CLEAR_KEYS = [
    // token 相关
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

    // 购物车/其它可能影响 UI 的缓存
    "fresh_cart",
    "cart",
  ];

  function clearLocalStorageKeys() {
    for (const k of CLEAR_KEYS) localStorage.removeItem(k);
  }

  // =========================================================
  // ✅ 注册必勾选：服务条款/隐私政策
  // - 1) Auth.register 内强校验（就算别的 JS 忘记校验也挡住）
  // - 2) 自动绑定 UI：未勾选时注册按钮 disabled
  // =========================================================
  function getAgreeEl() {
  const backdrop = document.getElementById("authBackdrop");
  if (!backdrop) return null; // 首页如果没有弹窗 DOM，就完全不做任何事
  return backdrop.querySelector("#agreeTerms");
}

function mustAgreeOrThrow() {
  const agreeEl = getAgreeEl();
  // 没有 checkbox（比如某些页面没有注册），就不拦
  if (!agreeEl) return true;

  if (!agreeEl.checked) {
    throw new Error("请先勾选同意《服务条款》和《隐私政策》后再注册");
  }
  return true;
}

function bindAgreementUI() {
  const backdrop = document.getElementById("authBackdrop");
  if (!backdrop) return;

  const agreeEl = backdrop.querySelector("#agreeTerms");
  if (!agreeEl) return;

  // ✅ 只在弹窗里找注册按钮，绝不全局 query（避免误伤首页任何按钮）
  const btn =
    backdrop.querySelector("#btnRegister") ||
    backdrop.querySelector('[data-action="register"]') ||
    backdrop.querySelector(".btn-register") ||
    backdrop.querySelector("#registerBtn") ||
    backdrop.querySelector("#btnAuthRegister") ||
    null;

  if (!btn) return;

  const sync = () => {
    const disabled = !agreeEl.checked;
    btn.disabled = disabled;
    btn.classList.toggle("is-disabled", disabled);
    try {
      btn.setAttribute("aria-disabled", disabled ? "true" : "false");
    } catch (e) {}
  };

  sync();
  agreeEl.addEventListener("change", sync);

  btn.addEventListener(
    "click",
    (e) => {
      try {
        mustAgreeOrThrow();
      } catch (err) {
        e.preventDefault();
        e.stopPropagation();
        alert(err.message || "请先同意服务条款与隐私政策");
      }
    },
    true
  );
}

// DOM ready 后再绑定（避免元素还没渲染）
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindAgreementUI);
} else {
  bindAgreementUI();
}
  window.Auth = {
    getToken() {
      return localStorage.getItem(KEY) || "";
    },
    setToken(t) {
      if (t) localStorage.setItem(KEY, t);
    },
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
      // ✅ 注册前强校验：必须勾选条款
      mustAgreeOrThrow();

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

/* =========================================================
 * ✅ iOS Safari：弹窗打开时锁背景 + 键盘弹出不让页面滚
 *   - 背景永远不滚动
 *   - 只滚动 auth-card 内部
 * ========================================================= */
(function () {
  const backdrop = document.getElementById("authBackdrop");
  if (!backdrop) return;

  const card = backdrop.querySelector(".auth-card") || backdrop.firstElementChild;

  let locked = false;
  let savedY = 0;

  // ---- 更新 vvh（只做高度变量，不做 scrollTo，不做 lock）
  function setVVH() {
    const h =
      window.visualViewport && window.visualViewport.height
        ? window.visualViewport.height
        : window.innerHeight;
    document.documentElement.style.setProperty("--vvh", Math.round(h) + "px");
  }

  // ---- 彻底阻止背景滚动：touchmove / wheel 全拦
  function preventScroll(e) {
    // 允许弹窗内部滚（auth-card）
    if (card && card.contains(e.target)) return;
    e.preventDefault();
  }

  function lockBody() {
    if (locked) return;
    locked = true;

    setVVH();
    savedY = window.scrollY || window.pageYOffset || 0;

    // iOS 必杀：html/body 都锁
    document.documentElement.style.height = "100%";
    document.documentElement.style.overflow = "hidden";

    document.body.style.position = "fixed";
    document.body.style.top = `-${savedY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    // 全局拦截滚动（关键）
    document.addEventListener("touchmove", preventScroll, { passive: false });
    document.addEventListener("wheel", preventScroll, { passive: false });
  }

  function unlockBody() {
    if (!locked) return;
    locked = false;

    document.removeEventListener("touchmove", preventScroll);
    document.removeEventListener("wheel", preventScroll);

    document.documentElement.style.height = "";
    document.documentElement.style.overflow = "";

    const top = document.body.style.top;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";

    const y = top ? Math.abs(parseInt(top, 10) || 0) : savedY;
    window.scrollTo(0, y);
  }

  function isOpen() {
    return backdrop.classList.contains("active");
  }

  // ---- 打开/关闭时只锁一次（不抖）
  let lastOpen = null;
  function syncLock() {
    const open = isOpen();
    if (open === lastOpen) return;
    lastOpen = open;

    if (open) lockBody();
    else unlockBody();
  }

  new MutationObserver(syncLock).observe(backdrop, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // ---- 关键：input focus 时，只滚动弹窗内部，不让页面被 Safari 拉走
  function keepInputVisible(input) {
    if (!card) return;

    setVVH();

    // 可视高度：vvh - 顶部padding - 底部留一点
    const vvh = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--vvh") || "0",
      10
    );
    const safeTop = 12;
    const safeBottom = 16;
    const avail = (vvh || window.innerHeight) - safeTop - safeBottom;

    const cardRect = card.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();

    // input 在卡片里的相对位置（用 card.scrollTop 调整）
    const topInCard = inputRect.top - cardRect.top + card.scrollTop;
    const bottomInCard = inputRect.bottom - cardRect.top + card.scrollTop;

    // 如果 input 底部超出可视区域，则向下滚 card
    const currentTop = card.scrollTop;
    const viewTop = currentTop;
    const viewBottom = currentTop + Math.min(avail, card.clientHeight);

    if (bottomInCard > viewBottom - 10) {
      const delta = bottomInCard - (viewBottom - 10);
      card.scrollTo({ top: currentTop + delta, behavior: "smooth" });
    } else if (topInCard < viewTop + 10) {
      const delta = viewTop + 10 - topInCard;
      card.scrollTo({ top: currentTop - delta, behavior: "smooth" });
    }
  }

  backdrop.addEventListener(
    "focusin",
    (e) => {
      const t = e.target;
      if (!isOpen()) return;
      if (!t) return;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
        // 打开状态下确保锁住（不会反复）
        lockBody();

        // 下一帧调整弹窗内部滚动
        requestAnimationFrame(() => keepInputVisible(t));
      }
    },
    true
  );

  // visualViewport 变化：只更新高度变量 + 让输入框可见（不滚页面）
  let vvRaf = 0;
  function onVVChange() {
    if (!isOpen()) return;
    if (vvRaf) cancelAnimationFrame(vvRaf);
    vvRaf = requestAnimationFrame(() => {
      setVVH();
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        keepInputVisible(active);
      }
    });
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onVVChange, { passive: true });
    window.visualViewport.addEventListener("scroll", onVVChange, { passive: true });
  } else {
    window.addEventListener("resize", onVVChange, { passive: true });
  }

  // 初始化
  syncLock();
})();
