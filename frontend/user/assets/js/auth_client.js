// frontend/user/assets/js/auth_client.js
(function () {
  // ✅ 统一 token key（你别的页面基本都用 freshbuy_token）
  const KEY = "freshbuy_token";

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

  // =========================================================
  // ✅ 前台显示错误原因（弹窗顶部红色提示条）
  // =========================================================
  function ensureAuthMsgEl() {
    let el = document.getElementById("authMsg");
    if (el) return el;

    const card = document.querySelector("#authBackdrop .auth-card");
    if (!card) return null;

    const body = card.querySelector(".auth-body");
    if (!body) return null;

    el = document.createElement("div");
    el.id = "authMsg";
    el.style.cssText =
      "display:none;margin:10px 0 0;padding:10px 12px;border-radius:12px;" +
      "font-size:13px;line-height:1.45;border:1px solid #fecaca;" +
      "background:#fff1f2;color:#991b1b;word-break:break-word;";

    body.insertBefore(el, body.firstChild);
    return el;
  }

  function showAuthMsg(text, type = "error") {
    const el = ensureAuthMsgEl();
    if (!el) return;

    if (!text) {
      el.style.display = "none";
      el.textContent = "";
      return;
    }

    el.style.display = "block";
    el.textContent = text;

    if (type === "ok") {
      el.style.border = "1px solid #bbf7d0";
      el.style.background = "#f0fdf4";
      el.style.color = "#166534";
    } else {
      el.style.border = "1px solid #fecaca";
      el.style.background = "#fff1f2";
      el.style.color = "#991b1b";
    }
  }

  function formatApiError(data, fallback = "操作失败") {
    const msg = (data && (data.msg || data.message)) || fallback;
    const detail = data && data.detail ? `（${data.detail}）` : "";
    const reqId = data && data.reqId ? ` 编号：${data.reqId}` : "";
    return `${msg}${detail}${reqId}`;
  }

  // ✅ 统一请求（保证错误能读出来：JSON / 非JSON / 网络错误）
  async function apiPostJson(url, payload, { timeoutMs = 15000 } = {}) {
    showAuthMsg("");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(payload || {}),
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = {
          success: false,
          msg: "服务器返回非JSON",
          detail: (text || "").slice(0, 200),
        };
      }

      if (!res.ok || !data || data.success === false) {
        showAuthMsg(formatApiError(data, "请求失败"));
        return { ok: false, status: res.status, data };
      }

      return { ok: true, status: res.status, data };
    } catch (e) {
      const msg = String(e?.message || "");
      const data = {
        success: false,
        msg: msg.includes("AbortError") ? "请求超时" : "网络错误",
        detail: msg,
      };
      showAuthMsg(formatApiError(data, "网络错误"));
      return { ok: false, status: 0, data };
    } finally {
      clearTimeout(timer);
    }
  }

  // =========================================================
  // ✅ Auth API
  // =========================================================
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

      const data = await res.json().catch(() => ({}));
      return data.user || null;
    },

    async login(phone, password) {
      showAuthMsg("");
      const r = await apiPostJson(
        "/api/auth/login",
        { phone, password },
        { timeoutMs: 15000 }
      );
      if (!r.ok) {
        throw new Error(formatApiError(r.data, "登录失败"));
      }
      this.setToken(r.data.token);
      showAuthMsg("登录成功", "ok");
      return r.data.user;
    },

    // ✅ 注册：强制带验证码 + 防重复 + 超时（微信更稳）
    async register(name, phone, password, code) {
      showAuthMsg("");

      // ✅ 服务条款勾选
      const agreeEl = document.getElementById("regAgree");
      if (agreeEl && !agreeEl.checked) {
        showAuthMsg("请先勾选并同意服务条款与隐私政策");
        throw new Error("请先勾选并同意服务条款与隐私政策");
      }

      // ✅ 读取密码（以输入框为准）+ 确认密码校验
      const pwEl = document.getElementById("regPassword");
      const pw2El = document.getElementById("regPasswordConfirm");

      const pw1 = String((pwEl ? pwEl.value : password) || "").trim();
      const pw2 = String((pw2El ? pw2El.value : "") || "").trim();

      if (!pw1) {
        showAuthMsg("请输入密码");
        throw new Error("请输入密码");
      }
      if (pw2El) {
        if (!pw2) {
          showAuthMsg("请再次输入确认密码");
          throw new Error("请再次输入确认密码");
        }
        if (pw1 !== pw2) {
          showAuthMsg("两次输入的密码不一致");
          throw new Error("两次输入的密码不一致");
        }
      }

      // ✅ 读取短信验证码
      const codeEl =
        document.getElementById("regCode") ||
        document.getElementById("regSmsCode") ||
        document.getElementById("regVerifyCode");

      const smsCode = String(code || (codeEl ? codeEl.value : "") || "").trim();
      if (!smsCode) {
        showAuthMsg("请输入短信验证码");
        throw new Error("请输入短信验证码");
      }

      // ✅ 防重复提交（微信里很重要）
      if (window.__REGISTERING__) return;
      window.__REGISTERING__ = true;

      const btn = document.getElementById("registerSubmitBtn");
      const oldText = btn ? btn.textContent : "";
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.7";
        btn.textContent = "注册中...";
      }

      try {
        const r = await apiPostJson(
          "/api/auth/register",
          {
            name,
            phone,
            password: pw1,
            code: smsCode,
            agreeTerms: !!(agreeEl && agreeEl.checked),
            ua: navigator.userAgent,
          },
          { timeoutMs: 15000 }
        );

        if (!r.ok) {
          throw new Error(formatApiError(r.data, "注册失败（服务器拒绝）"));
        }

        showAuthMsg("注册成功", "ok");
        return r.data.user;
      } catch (e) {
        const msg = String(e?.message || "");

        if (
          msg.includes("AbortError") ||
          msg.includes("aborted") ||
          msg.includes("Failed to fetch")
        ) {
          showAuthMsg("微信内网络不稳定，建议点击右上角“...”选择在浏览器打开后再注册");
          throw new Error("微信内网络不稳定，建议点击右上角“...”选择在浏览器打开后再注册");
        }

        showAuthMsg(msg || "注册失败");
        throw e;
      } finally {
        window.__REGISTERING__ = false;

        if (btn) {
          const ok = !!(agreeEl && agreeEl.checked);
          btn.disabled = !ok;
          btn.style.opacity = ok ? "1" : "0.55";
          btn.textContent = oldText || "注册并登录";
        }
      }
    },

    // ✅ 发送验证码（点击“获取验证码”用）
    async sendRegisterCode(phone) {
      showAuthMsg("");

      const p = String(phone || "").trim();
      if (!p) {
        showAuthMsg("请先输入手机号");
        throw new Error("请先输入手机号");
      }

      const r = await apiPostJson(
        "/api/auth/verify-register",
        { phone: p },
        { timeoutMs: 15000 }
      );
      if (!r.ok) {
        throw new Error(formatApiError(r.data, "发送验证码失败"));
      }

      showAuthMsg("验证码已发送，请查收短信。", "ok");
      return true;
    },
  };

  // =========================================================
  // ✅ 小眼睛（只保留这一套！）
  // - 不注入 CSS（避免跟 main.css 打架）
  // - 捕获阶段监听 click，确保能点到
  // =========================================================
  (function () {
    if (window.__FB_EYES_BOUND__) return;
    window.__FB_EYES_BOUND__ = true;

    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target && e.target.closest ? e.target.closest(".auth-eye") : null;
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const targetId = btn.getAttribute("data-eye-for");
        if (!targetId) return;

        const input = document.getElementById(targetId);
        if (!input) return;

        const nextType = input.type === "password" ? "text" : "password";
        try {
          input.type = nextType;
          input.setAttribute("type", nextType);
        } catch (err) {
          input.setAttribute("type", nextType);
        }

        btn.classList.toggle("is-on", nextType === "text");
        btn.textContent = nextType === "text" ? "🙈" : "👁";
        console.log("👁 toggle", targetId, "=>", input.type);
      },
      true
    );
  })();

  // =========================================================
  // ✅ 两次密码一致提示（#regPwMatchHint）
  // =========================================================
  (function () {
    function $(id) {
      return document.getElementById(id);
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
      const pw1El = $("regPassword");
      const pw2El = $("regPasswordConfirm");
      if (!pw1El || !pw2El) return;

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

  // =========================================================
  // ✅ 给“获取验证码”按钮挂上逻辑（regSendCodeBtn）
  // =========================================================
  (function () {
    function init() {
      const btn = document.getElementById("regSendCodeBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
        try {
          const phone = String(document.getElementById("regPhone")?.value || "").trim();
          btn.disabled = true;
          await window.Auth.sendRegisterCode(phone);
        } finally {
          btn.disabled = false;
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();
})();

/* =========================================================
 * ✅ iOS Safari：弹窗打开时锁背景 + 键盘弹出不让页面滚
 * ========================================================= */
(function () {
  const backdrop = document.getElementById("authBackdrop");
  if (!backdrop) return;

  const card = backdrop.querySelector(".auth-card") || backdrop.firstElementChild;

  let locked = false;
  let savedY = 0;

  function setVVH() {
    const h =
      window.visualViewport && window.visualViewport.height
        ? window.visualViewport.height
        : window.innerHeight;
    document.documentElement.style.setProperty("--vvh", Math.round(h) + "px");
  }

  function preventScroll(e) {
    if (card && card.contains(e.target)) return;
    e.preventDefault();
  }

  function lockBody() {
    if (locked) return;
    locked = true;

    setVVH();
    savedY = window.scrollY || window.pageYOffset || 0;

    document.documentElement.style.height = "100%";
    document.documentElement.style.overflow = "hidden";

    document.body.style.position = "fixed";
    document.body.style.top = `-${savedY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

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

  function keepInputVisible(input) {
    if (!card) return;

    setVVH();

    const vvh = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--vvh") || "0",
      10
    );
    const safeTop = 12;
    const safeBottom = 16;
    const avail = (vvh || window.innerHeight) - safeTop - safeBottom;

    const cardRect = card.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();

    const topInCard = inputRect.top - cardRect.top + card.scrollTop;
    const bottomInCard = inputRect.bottom - cardRect.top + card.scrollTop;

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
        lockBody();
        requestAnimationFrame(() => keepInputVisible(t));
      }
    },
    true
  );

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

  syncLock();
})();

/* =========================================================
 * ✅ 注册必选框：未勾选不能点“注册并登录”
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
