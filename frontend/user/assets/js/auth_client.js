// frontend/user/assets/js/auth_client.js
// =========================================================
// ✅ 单一架构版（UI层）
// - 本文件只做：UI绑定/提示/倒计时/勾选校验/iOS弹窗锁滚动/眼睛/密码一致提示
// - 所有 Auth API / token / 手机号规范化：统一转发 window.FreshAuth
//
// ✅ 本次新增：
// 1) 倒计时保留（startCountdown）
// 2) 注册过的用户不再发送验证码：sendRegisterCode 前先检查手机号是否已注册
// 3) 每天最多发送几次限制：前端软限制 + 建议后端硬限制
// =========================================================
(function () {
  "use strict";

  // ---------------------------------------------------------
  // 0) 依赖检查：必须先加载 auth_core.js（window.FreshAuth）
  // ---------------------------------------------------------
  function getCore() {
    return window.FreshAuth || null;
  }
  function ensureCoreOrToast() {
    const A = getCore();
    if (!A) {
      console.warn(
        "❌ FreshAuth not found. Please load /user/assets/js/auth_core.js before auth_client.js"
      );
      showAuthMsg("系统缺少 FreshAuth（请检查 index.html 的脚本加载顺序）");
    }
    return A;
  }

  // ---------------------------------------------------------
  // 1) 统一提示条（authMsg）
  // ---------------------------------------------------------
  function ensureAuthMsgEl() {
    let el = document.getElementById("authMsg");
    if (el) return el;

    const card =
      document.querySelector("#authBackdrop .auth-card") ||
      document.querySelector("#authBackdrop .login-modal") ||
      document.querySelector("#authBackdrop .auth-modal") ||
      document.querySelector("#authBackdrop .auth-card") ||
      null;
    if (!card) return null;

    const body = card.querySelector(".auth-body") || card;

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
    el.textContent = String(text);

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

  // ---------------------------------------------------------
  // 2) 必选框校验：smsOptIn（短信同意）、regAgree（条款同意）
  // ---------------------------------------------------------
  function requireSmsOptIn() {
    const cb = document.getElementById("smsOptIn");
    if (!cb) return true;
    if (cb.checked) return true;

    showAuthMsg("请先勾选同意接收短信条款（SMS consent）");
    try {
      cb.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
    return false;
  }

  function requireRegAgree() {
    const cb = document.getElementById("regAgree");
    if (!cb) return true;
    if (cb.checked) return true;

    showAuthMsg("请先勾选并同意服务条款与隐私政策");
    try {
      cb.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
    return false;
  }

  // ---------------------------------------------------------
  // 3) 倒计时按钮（防狂点）
  // ---------------------------------------------------------
  function startCountdown(btn, seconds = 60, restoreText = null) {
    if (!btn) return;
    let left = Math.max(1, Number(seconds) || 60);

    const oldText = restoreText || btn.textContent || "获取验证码";
    btn.disabled = true;
    btn.style.opacity = "0.7";

    btn.textContent = `${left}s`;
    const t = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(t);
        btn.disabled = false;
        btn.style.opacity = "";
        btn.textContent = oldText;
        return;
      }
      btn.textContent = `${left}s`;
    }, 1000);
  }

  // ---------------------------------------------------------
  // ✅ 3.1) 发送次数限制（前端软限制兜底）
  // 说明：
  // - 真正防刷一定要后端硬限制（手机号+IP+设备指纹等）
  // - 前端这里只做“体验+兜底”：同一浏览器每天最多 N 次
  // ---------------------------------------------------------
  const SMS_DAILY_LIMIT = 5; // ✅ 你要改每天最多几次，改这里
  const SMS_DAILY_KEY_PREFIX = "freshbuy_sms_send_count_"; // 每天一个key

  function getTodayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getSmsCountToday() {
    const k = SMS_DAILY_KEY_PREFIX + getTodayKey();
    const n = Number(localStorage.getItem(k) || "0");
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function incSmsCountToday() {
    const k = SMS_DAILY_KEY_PREFIX + getTodayKey();
    const cur = getSmsCountToday();
    localStorage.setItem(k, String(cur + 1));
    return cur + 1;
  }

  function checkSmsQuotaOrThrow() {
    const used = getSmsCountToday();
    if (used >= SMS_DAILY_LIMIT) {
      showAuthMsg(
        `今日验证码发送次数已达上限（${SMS_DAILY_LIMIT} 次）。请明天再试，或联系客服微信 nyfreshbuy。`
      );
      throw new Error("SMS quota exceeded");
    }
  }

  // ---------------------------------------------------------
  // ✅ 3.2) 注册过的用户不再发送验证码：手机号是否已注册检查
  // 优先：FreshAuth.apiCheckPhoneRegistered(phone) -> 返回 boolean
  // fallback：GET /api/auth/check-phone-registered?phone=+1xxxx
  // 你后端若没有这个接口，至少要返回：
  // { success:true, registered:true/false, message?:string }
  // ---------------------------------------------------------
  async function checkPhoneRegistered(phoneE164) {
    const A = getCore();

    // ① 优先走 FreshAuth
    try {
      if (A && typeof A.apiCheckPhoneRegistered === "function") {
        const r = await A.apiCheckPhoneRegistered(phoneE164);
        return r === true;
      }
    } catch (e) {
      // 不阻断，继续走 fallback
    }

    // ② fallback：走后端接口
    try {
      const url =
        "/api/auth/check-phone-registered?phone=" + encodeURIComponent(phoneE164) + "&ts=" + Date.now();
      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (j && j.success === true) return j.registered === true;
    } catch {}

    // ③ 如果检查失败（接口不存在/网络问题），为了不误杀用户：默认认为“未注册”
    return false;
  }

  // ---------------------------------------------------------
  // 4) window.Auth（UI层暴露一个兼容对象，但内部全部转发 FreshAuth）
  // ---------------------------------------------------------
  window.Auth = window.Auth || {};

  window.Auth.getToken = function () {
    const A = getCore();
    if (A && typeof A.getToken === "function") return A.getToken();
    return localStorage.getItem("freshbuy_token") || localStorage.getItem("token") || "";
  };

  window.Auth.setToken = function (t) {
    const A = getCore();
    if (A && typeof A.setToken === "function") return A.setToken(t);
    const v = String(t || "").trim();
    if (!v) return;
    localStorage.setItem("token", v);
    localStorage.setItem("freshbuy_token", v);
  };

  window.Auth.clearAll = function () {
    const A = getCore();
    if (A && typeof A.clearToken === "function") A.clearToken();
    ["token", "freshbuy_token", "jwt", "auth_token", "access_token"].forEach((k) =>
      localStorage.removeItem(k)
    );
    [
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
    ].forEach((k) => localStorage.removeItem(k));
    try {
      sessionStorage.clear();
    } catch {}
  };

  window.Auth.me = async function () {
    const A = ensureCoreOrToast();
    if (!A || typeof A.apiMe !== "function") return null;
    return await A.apiMe();
  };

  window.Auth.login = async function (phone, password) {
    const A = ensureCoreOrToast();
    if (!A || typeof A.apiLogin !== "function") throw new Error("FreshAuth.apiLogin 缺失");

    showAuthMsg("");

    const p =
      typeof A.normalizeUSPhone === "function"
        ? A.normalizeUSPhone(phone)
        : String(phone || "").trim();
    if (!p) {
      showAuthMsg("手机号格式不正确（请用美国手机号，例如 646xxxxxxx 或 +1646xxxxxxx）");
      throw new Error("手机号格式不正确");
    }

    try {
      const user = await A.apiLogin(p, password);
showAuthMsg("登录成功", "ok");
window.applyLoggedInUI && window.applyLoggedInUI(user);
return user;
    } catch (e) {
      showAuthMsg(e?.message || "登录失败");
      throw e;
    }
  };

  // ---------------------------------------------------------
  // ✅ 发送注册验证码：新增“已注册不发” + “每日次数限制”
  // ---------------------------------------------------------
  window.Auth.sendRegisterCode = async function (phone) {
    const A = ensureCoreOrToast();
    if (!A || typeof A.apiSendSmsCode !== "function")
      throw new Error("FreshAuth.apiSendSmsCode 缺失");

    showAuthMsg("");

    // ✅ 1) 必须勾选短信同意
    if (!requireSmsOptIn()) throw new Error("请先勾选短信同意");

    // ✅ 2) 前端软限制：每日次数
    checkSmsQuotaOrThrow();

    // ✅ 3) 规范化手机号
    const p =
      typeof A.normalizeUSPhone === "function"
        ? A.normalizeUSPhone(phone)
        : String(phone || "").trim();
    if (!p) {
      showAuthMsg("请先输入正确的手机号（例如 646xxxxxxx 或 +1646xxxxxxx）");
      throw new Error("手机号不正确");
    }

    // ✅ 4) 已注册用户不再发送验证码
    const registered = await checkPhoneRegistered(p);
    if (registered) {
      showAuthMsg("该手机号已注册，请直接登录或使用“忘记密码”找回。");
      throw new Error("phone already registered");
    }

    // ✅ 5) 发送验证码
    try {
      await A.apiSendSmsCode(p);

      // ✅ 成功才计数（避免失败也占次数）
      const used = incSmsCountToday();

      showAuthMsg(
        `验证码已发送，请查收短信。（今日已发送 ${used}/${SMS_DAILY_LIMIT} 次）`,
        "ok"
      );
      return true;
    } catch (e) {
      showAuthMsg(e?.message || "发送验证码失败");
      throw e;
    }
  };

  window.Auth.register = async function ({ phone, code, password, name }) {
    const A = ensureCoreOrToast();
    if (!A || typeof A.apiVerifyRegister !== "function")
      throw new Error("FreshAuth.apiVerifyRegister 缺失");

    showAuthMsg("");

    if (!requireRegAgree()) throw new Error("请先勾选条款同意");
    if (!requireSmsOptIn()) throw new Error("请先勾选短信同意");

    const p =
      typeof A.normalizeUSPhone === "function"
        ? A.normalizeUSPhone(phone)
        : String(phone || "").trim();
    if (!p) {
      showAuthMsg("手机号格式不正确（请用美国手机号，例如 646xxxxxxx 或 +1646xxxxxxx）");
      throw new Error("手机号格式不正确");
    }

    const c = String(code || "").trim();
    if (!c) {
      showAuthMsg("请输入短信验证码");
      throw new Error("请输入短信验证码");
    }

    const pw = String(password || "").trim();
    if (!pw) {
      showAuthMsg("请输入密码");
      throw new Error("请输入密码");
    }

    let finalName = String(name || "").trim();
    if (!finalName) finalName = "用户" + String(p).slice(-4);

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
      const user = await A.apiVerifyRegister({
        phone: p,
        code: c,
        password: pw,
        name: finalName,
      });

      showAuthMsg("注册成功", "ok");
      return user;
    } catch (e) {
      const msg = String(e?.message || "注册失败");
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        showAuthMsg("微信内网络不稳定，建议点击右上角“...”选择在浏览器打开后再注册");
      } else {
        showAuthMsg(msg);
      }
      throw e;
    } finally {
      window.__REGISTERING__ = false;
      if (btn) {
        const agreeEl = document.getElementById("regAgree");
        const smsEl = document.getElementById("smsOptIn");
        const ok =
          !!(agreeEl ? agreeEl.checked : true) &&
          !!(smsEl ? smsEl.checked : true);

        btn.disabled = !ok;
        btn.style.opacity = ok ? "1" : "0.55";
        btn.textContent = oldText || "注册并登录";
      }
    }
  };

  // ---------------------------------------------------------
  // 5) 小眼睛（只保留这一套）
  // ---------------------------------------------------------
  (function bindEyesOnce() {
    if (window.__FB_EYES_BOUND__) return;
    window.__FB_EYES_BOUND__ = true;

    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(".auth-eye[data-eye-for]");
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const inputId = btn.getAttribute("data-eye-for");
        if (!inputId) return;

        const input = document.getElementById(inputId);
        if (!input) return;

        const nextType = input.type === "password" ? "text" : "password";
        try {
          input.type = nextType;
        } catch {
          input.setAttribute("type", nextType);
        }

        btn.classList.toggle("is-on", nextType === "text");
        btn.textContent = nextType === "text" ? "🙈" : "👁";
      },
      true
    );
  })();

  // ---------------------------------------------------------
  // 6) 两次密码一致提示（#regPwMatchHint + regPasswordConfirm 边框）
  // ---------------------------------------------------------
  (function bindPwMatchHint() {
    if (window.__FB_PW_MATCH_BOUND__) return;
    window.__FB_PW_MATCH_BOUND__ = true;

    function setHint(text, ok) {
      const hint = document.getElementById("regPwMatchHint");
      if (!hint) return;

      hint.textContent = text || "";
      if (ok === true) hint.style.color = "#16a34a";
      else if (ok === false) hint.style.color = "#ef4444";
      else hint.style.color = "#6b7280";
    }

    function sync() {
      const pw1El = document.getElementById("regPassword");
      const pw2El = document.getElementById("regPasswordConfirm");
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
      const pw1El = document.getElementById("regPassword");
      const pw2El = document.getElementById("regPasswordConfirm");
      if (!pw1El || !pw2El) return;

      pw1El.addEventListener("input", sync);
      pw2El.addEventListener("input", sync);
      pw1El.addEventListener("change", sync);
      pw2El.addEventListener("change", sync);
      sync();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  })();

  // ---------------------------------------------------------
  // 7) 绑定：注册获取验证码 regSendCodeBtn（60s倒计时 + smsOptIn 必选 + 已注册不发 + 每日次数限制）
  // ---------------------------------------------------------
  (function bindRegSendCode() {
    if (window.__FB_REG_SEND_BOUND__) return;
    window.__FB_REG_SEND_BOUND__ = true;

    function init() {
      const btn = document.getElementById("regSendCodeBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
        if (btn.dataset.busy === "1") return;
        btn.dataset.busy = "1";

        try {
          const phone = String(document.getElementById("regPhone")?.value || "").trim();
          await window.Auth.sendRegisterCode(phone);

          // ✅ 发送成功才倒计时
          startCountdown(btn, 60, "获取验证码");
        } catch (_) {
          // showAuthMsg 已提示
          btn.disabled = false;
          btn.style.opacity = "";
        } finally {
          btn.dataset.busy = "0";
        }
      });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  })();

  // ---------------------------------------------------------
  // 8) 绑定：注册提交 registerSubmitBtn（统一调用 Auth.register）
  // ---------------------------------------------------------
  (function bindRegSubmit() {
    if (window.__FB_REG_SUBMIT_BOUND__) return;
    window.__FB_REG_SUBMIT_BOUND__ = true;

    function init() {
      const btn = document.getElementById("registerSubmitBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
        if (btn.dataset.busy === "1") return;
        btn.dataset.busy = "1";

        try {
          const phone = String(document.getElementById("regPhone")?.value || "").trim();
          const code = String(document.getElementById("regCode")?.value || "").trim();
          const pw1 = String(document.getElementById("regPassword")?.value || "").trim();
          const pw2El = document.getElementById("regPasswordConfirm");
          const pw2 = pw2El ? String(pw2El.value || "").trim() : "";

          if (!requireRegAgree()) return;
          if (!requireSmsOptIn()) return;

          if (!phone) return showAuthMsg("请先输入手机号");
          if (!code) return showAuthMsg("请先输入验证码");
          if (!pw1) return showAuthMsg("请先输入密码");
          if (pw2El && pw1 !== pw2) return showAuthMsg("两次输入的密码不一致");

          const nameEl = document.getElementById("regName");
          const name = String(nameEl?.value || "").trim();

          await window.Auth.register({ phone, code, password: pw1, name });
// ✅ 立刻显示头像
const me = await window.Auth.me().catch(() => null);
window.applyLoggedInUI && window.applyLoggedInUI(me || { phone });
// ✅ 1) 关闭弹窗
const back = document.getElementById("authBackdrop");
if (back) back.classList.remove("active");

// ✅ 2) 触发一次刷新登录态（如果你其它地方监听 storage）
try { window.dispatchEvent(new Event("storage")); } catch {}

// ✅ 3) 最稳：直接刷新页面，让 index.js 重新跑登录态 + banner + 购物车等
location.reload();
        } catch (_) {
          // showAuthMsg 已提示
        } finally {
          btn.dataset.busy = "0";
        }
      });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  })();

  // ---------------------------------------------------------
  // 9) 注册按钮可用性：regAgree + smsOptIn 都必须勾选
  // ---------------------------------------------------------
  (function bindRegCheckboxGate() {
    if (window.__FB_REG_GATE_BOUND__) return;
    window.__FB_REG_GATE_BOUND__ = true;

    function init() {
      const agree = document.getElementById("regAgree");
      const sms = document.getElementById("smsOptIn");
      const btn = document.getElementById("registerSubmitBtn");
      if (!btn) return;

      const sync = () => {
        const ok = !!(agree ? agree.checked : true) && !!(sms ? sms.checked : true);
        btn.disabled = !ok;
        btn.style.opacity = ok ? "1" : "0.55";
        btn.style.cursor = ok ? "pointer" : "not-allowed";
      };

      if (agree) agree.addEventListener("change", sync);
      if (sms) sms.addEventListener("change", sync);
      sync();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  })();

  // ---------------------------------------------------------
  // 10) iOS Safari：弹窗打开锁背景 + 维护 --vvh（不影响其它模块）
  // ---------------------------------------------------------
  (function bindIOSModalLock() {
    if (window.__FB_IOS_LOCK_BOUND__) return;
    window.__FB_IOS_LOCK_BOUND__ = true;

    const backdrop = document.getElementById("authBackdrop");
    if (!backdrop) return;

    const card =
      backdrop.querySelector(".auth-card") ||
      backdrop.querySelector(".login-modal") ||
      backdrop.firstElementChild ||
      null;

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
      try {
        input.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {}
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

    function onVVChange() {
      if (!isOpen()) return;
      setVVH();
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        keepInputVisible(active);
      }
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onVVChange, { passive: true });
      window.visualViewport.addEventListener("scroll", onVVChange, { passive: true });
    } else {
      window.addEventListener("resize", onVVChange, { passive: true });
    }

    syncLock();
  })();
    // ---------------------------------------------------------
  // ✅ 11) 首页顶部按钮/弹窗/头像UI 绑定（必须有）
  // ---------------------------------------------------------
  (function bindTopAuthUI() {
    if (window.__FB_TOP_AUTH_UI_BOUND__) return;
    window.__FB_TOP_AUTH_UI_BOUND__ = true;

    const backdrop = document.getElementById("authBackdrop");
    const loginBtnTop = document.getElementById("loginBtn");
    const registerBtnTop = document.getElementById("registerBtn");

    const tabLogin = document.getElementById("tabLogin");
    const tabRegister = document.getElementById("tabRegister");
    const authTitle = document.getElementById("authTitle");

    const loginPanel = document.getElementById("loginPanel");
    const registerPanel = document.getElementById("registerPanel");
    const forgotPanel = document.getElementById("forgotPanel");

    const closeBtn = document.getElementById("authCloseBtn");
    const loginSubmitBtn = document.getElementById("loginSubmitBtn");

    const profile = document.getElementById("userProfile");
    const avatar = document.getElementById("userAvatar");
    const nameLabel = document.getElementById("userNameLabel");

    function setMode(mode) {
      if (authTitle) authTitle.textContent = mode === "register" ? "注册" : mode === "forgot" ? "找回密码" : "登录";
      if (loginPanel) loginPanel.style.display = mode === "login" ? "" : "none";
      if (registerPanel) registerPanel.style.display = mode === "register" ? "" : "none";
      if (forgotPanel) forgotPanel.style.display = mode === "forgot" ? "" : "none";
      if (tabLogin) tabLogin.classList.toggle("active", mode === "login");
      if (tabRegister) tabRegister.classList.toggle("active", mode === "register");
    }

    function openModal(mode) {
      if (!backdrop) return;
      setMode(mode || "login");
      backdrop.classList.add("active");
      try { showAuthMsg(""); } catch {}
    }

    function closeModal() {
      if (!backdrop) return;
      backdrop.classList.remove("active");
      try { showAuthMsg(""); } catch {}
    }

    // ✅ 统一挂到 window，避免 undefined
    window.applyLoggedInUI = window.applyLoggedInUI || function (user) {
      if (loginBtnTop) loginBtnTop.style.display = "none";
      if (registerBtnTop) registerBtnTop.style.display = "none";
      if (profile) profile.style.display = "inline-flex";

      const nickname =
        (user && (user.nickname || user.name || user.username)) ||
        (user && user.phone ? ("用户" + String(user.phone).slice(-4)) : "我的账户");

      if (nameLabel) nameLabel.textContent = nickname;

      if (avatar) {
        const ch = String(nickname || "我").trim().slice(0, 1);
        avatar.textContent = ch || "我";
      }

      try {
        localStorage.setItem("freshbuy_is_logged_in", "1");
        if (user?.phone) localStorage.setItem("freshbuy_login_phone", String(user.phone));
        localStorage.setItem("freshbuy_login_nickname", String(nickname));
        localStorage.setItem("freshbuy_user", JSON.stringify(user || {}));
        localStorage.setItem("user", JSON.stringify(user || {}));
      } catch {}
    };

    window.applyLoggedOutUI = window.applyLoggedOutUI || function () {
      if (loginBtnTop) loginBtnTop.style.display = "";
      if (registerBtnTop) registerBtnTop.style.display = "";
      if (profile) profile.style.display = "none";
      try { localStorage.setItem("freshbuy_is_logged_in", "0"); } catch {}
    };

    // ✅ 顶部按钮：打开弹窗
    if (loginBtnTop) loginBtnTop.addEventListener("click", () => openModal("login"));
    if (registerBtnTop) registerBtnTop.addEventListener("click", () => openModal("register"));

    // ✅ Tab 切换
    if (tabLogin) tabLogin.addEventListener("click", () => setMode("login"));
    if (tabRegister) tabRegister.addEventListener("click", () => setMode("register"));

    // ✅ 关闭
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        const card = backdrop.querySelector(".auth-card");
        if (card && card.contains(e.target)) return;
        closeModal();
      });
    }

    // ✅ 登录提交
    if (loginSubmitBtn) {
      loginSubmitBtn.addEventListener("click", async () => {
        const phone = String(document.getElementById("loginPhone")?.value || "").trim();
        const pwd = String(document.getElementById("loginPassword")?.value || "").trim();
        if (!phone) return showAuthMsg("请先输入手机号");
        if (!pwd) return showAuthMsg("请先输入密码");

        try {
          const user = await window.Auth.login(phone, pwd);
          closeModal();
          window.applyLoggedInUI && window.applyLoggedInUI(user);
          try { window.dispatchEvent(new Event("storage")); } catch {}
        } catch (_) {
          // login 内部已提示
        }
      });
    }

    // ✅ 页面启动：有 token 就自动显示头像
    (async function boot() {
      try {
        const u = await window.Auth.me();
        if (u) window.applyLoggedInUI(u);
        else window.applyLoggedOutUI();
      } catch {
        window.applyLoggedOutUI();
      }
    })();
  })();
  // ---------------------------------------------------------
  // 11) 安全兜底：初始化时清空提示条
  // ---------------------------------------------------------
  try {
    showAuthMsg("");
  } catch {}
})();
