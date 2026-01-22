// frontend/user/assets/js/auth_client.js
(function () {
  const KEY = "token";

  const CLEAR_KEYS = [
    "token",
    "freshbuy_token",
    "jwt",
    "auth_token",
    "access_token",
    "freshbuy_is_logged_in",
    "freshbuy_login_phone",
    "freshbuy_login_nickname",
    "freshbuy_user",
    "user",
    "freshbuy_default_address",
    "default_address",
    "freshbuy_wallet_balance",
    "wallet_balance",
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
      // =========================================================
      // ✅ 必选框未勾选：禁止注册（前端最终兜底）
      // 依赖 index.html 中注册面板存在：<input type="checkbox" id="regAgree" />
      // =========================================================
      const agreeEl = document.getElementById("regAgree");
      if (agreeEl && !agreeEl.checked) {
        throw new Error("请先勾选并同意服务条款与隐私政策");
      }
            // =========================================================
      // ✅ 新增：确认密码校验（前端）
      // 依赖 index.html 注册面板存在：
      // - <input id="regPassword" ...>
      // - <input id="regPasswordConfirm" ...>
      // =========================================================
      const pwEl = document.getElementById("regPassword");
      const pw2El = document.getElementById("regPasswordConfirm");

      const pw1 = (pwEl ? pwEl.value : password) ? String(pwEl ? pwEl.value : password).trim() : "";
      const pw2 = pw2El ? String(pw2El.value || "").trim() : "";

      // 如果页面有确认密码框，就必须一致
      if (pw2El) {
        if (!pw2) throw new Error("请再次输入确认密码");
        if (pw1 !== pw2) throw new Error("两次输入的密码不一致");
      }
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        // ✅（推荐）把 agreeTerms 带到后端，后端也能拦截绕过
        body: JSON.stringify({
          name,
          phone,
          password,
          agreeTerms: !!(agreeEl && agreeEl.checked),
        }),
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

/* =========================================================
 * ✅ 注册必选框：未勾选不能点“注册并登录”（UI 体验更稳）
 * 依赖 index.html 存在：
 * - <input type="checkbox" id="regAgree" />
 * - <button id="registerSubmitBtn" ...>
 * ========================================================= */
(function () {
  function init() {
    const agree = document.getElementById("regAgree");
    const btn = document.getElementById("registerSubmitBtn");
    if (!agree || !btn) return;

    const sync = () => {
      const ok = !!agree.checked;
      btn.disabled = !ok;
      btn.style.opacity = ok ? "1" : "0.55";
      btn.style.cursor = ok ? "pointer" : "not-allowed";
    };

    agree.addEventListener("change", sync);
    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
/* =========================================================
 * ✅ 注册密码增强：
 * 1) 小眼睛显示/隐藏（使用 .auth-eye[data-eye-for]）
 * 2) 实时提示：两次密码一致/不一致（#regPwMatchHint）
 * ========================================================= */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  // ✅ 小眼睛：兼容你 HTML 的 data-eye-for
  function bindEyes() {
    document.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".auth-eye") : null;
      if (!btn) return;

      const targetId = btn.getAttribute("data-eye-for");
      if (!targetId) return;

      const input = document.getElementById(targetId);
      if (!input) return;

      const isPwd = input.type === "password";
      input.type = isPwd ? "text" : "password";
      btn.textContent = isPwd ? "🙈" : "👁";
    });
  }

  function setHint(text, ok) {
    const hint = $("regPwMatchHint");
    if (!hint) return;

    hint.textContent = text || "";
    if (ok === true) hint.style.color = "#16a34a";
    else if (ok === false) hint.style.color = "#ef4444";
    else hint.style.color = "#6b7280";
  }

  function syncMatchUI() {
    const pw1El = $("regPassword");
    const pw2El = $("regPasswordConfirm");
    if (!pw1El || !pw2El) return;

    const pw1 = String(pw1El.value || "");
    const pw2 = String(pw2El.value || "");

    if (!pw1 && !pw2) {
      setHint("", null);
      pw2El.style.borderColor = "";
      return;
    }

    if (!pw2) {
      setHint("请再次输入确认密码", null);
      pw2El.style.borderColor = "";
      return;
    }

    if (pw1 === pw2) {
      setHint("✅ 两次密码一致", true);
      pw2El.style.borderColor = "#16a34a";
    } else {
      setHint("❌ 两次密码不一致", false);
      pw2El.style.borderColor = "#ef4444";
    }
  }

  function init() {
    bindEyes();

    const pw1El = $("regPassword");
    const pw2El = $("regPasswordConfirm");
    if (!pw1El || !pw2El) return;

    // 输入时实时刷新
    pw1El.addEventListener("input", syncMatchUI);
    pw2El.addEventListener("input", syncMatchUI);
    pw1El.addEventListener("change", syncMatchUI);
    pw2El.addEventListener("change", syncMatchUI);

    syncMatchUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
