// frontend/user/assets/js/auth_client.js
(function () {
  // ✅ 统一 token key（你别的页面基本都用 freshbuy_token）
  const KEY = "freshbuy_token";

  // ✅ 建议：把“注册发验证码”独立成 /api/auth/send-code
  // 如果你后端实际路径不同，只需要改这 2 个常量
  const API_SEND_REGISTER_CODE = "/api/auth/send-code";     // ✅ 只发验证码（注册）
  const API_VERIFY_REGISTER = "/api/auth/verify-register";  // ✅ 校验验证码 + 注册

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
  // ✅ 统一清洗手机号（前端兜底，后端也会再清洗一遍）
  // - 处理微信粘贴带空格/全角+等
  // - 统一成 E.164（美国默认补 +1）
  // =========================================================
  function requireSmsOptIn() {
  const cb = document.getElementById("smsOptIn");
  if (!cb) return true; // 理论上应该存在，兜底不阻断
  if (cb.checked) return true;

  alert("请先勾选同意接收短信条款（SMS consent）后再获取验证码/注册。");
  cb.scrollIntoView({ behavior: "smooth", block: "center" });
  return false;
}
  function normalizePhoneToE164_US(raw) {
    let s = String(raw ?? "").trim();
    if (!s) return "";

    // 全角＋ -> 半角+
    s = s.replace(/＋/g, "+");

    // 去掉所有空白（含不可见空白）
    s = s.replace(/\s+/g, "");

    // 只保留 + 和数字
    s = s.replace(/[^\d+]/g, "");

    // 如果有多个 +，只保留开头那个
    if (s.includes("+")) {
      s = "+" + s.replace(/\+/g, "");
    }

    // 10 位美国号：补 +1
    if (/^\d{10}$/.test(s)) s = "+1" + s;

    // 11 位且以 1 开头：补 +
    if (/^1\d{10}$/.test(s)) s = "+" + s;

    // 基本 E.164 校验（不通过就原样返回空，让 UI 提示）
    if (!/^\+[1-9]\d{1,14}$/.test(s)) return "";

    return s;
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
  async function apiPostJson(url, payload, { timeoutMs = 15000, headers = {} } = {}) {
    showAuthMsg("");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
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
  // ✅ 倒计时按钮（避免微信里狂点）
  // =========================================================
  function startCountdown(btn, seconds = 60, textPrefix = "获取验证码") {
    if (!btn) return;
    let left = Math.max(1, Number(seconds) || 60);

    const oldText = btn.textContent || textPrefix;
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

      const p = normalizePhoneToE164_US(phone);
      if (!p) {
        showAuthMsg("手机号格式不正确（请用美国手机号，例如 646xxxxxxx 或 +1646xxxxxxx）");
        throw new Error("手机号格式不正确");
      }

      const r = await apiPostJson("/api/auth/login", { phone: p, password }, { timeoutMs: 15000 });
      if (!r.ok) throw new Error(formatApiError(r.data, "登录失败"));

      this.setToken(r.data.token);
      showAuthMsg("登录成功", "ok");
      return r.data.user;
    },

    // ✅ 注册：校验验证码 + 注册（只走 verify-register）
    // ✅ 验证码/手机号/密码都按字符串处理
    async register(name, phone, password, code) {
      showAuthMsg("");

      // ✅ 服务条款勾选
      const agreeEl = document.getElementById("regAgree");
      if (agreeEl && !agreeEl.checked) {
        showAuthMsg("请先勾选并同意服务条款与隐私政策");
        throw new Error("请先勾选并同意服务条款与隐私政策");
      }

      const p = normalizePhoneToE164_US(phone);
      if (!p) {
        showAuthMsg("手机号格式不正确（请用美国手机号，例如 646xxxxxxx 或 +1646xxxxxxx）");
        throw new Error("手机号格式不正确");
      }

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

      const codeEl =
        document.getElementById("regCode") ||
        document.getElementById("regSmsCode") ||
        document.getElementById("regVerifyCode");

      const smsCode = String(code || (codeEl ? codeEl.value : "") || "").trim();
      if (!smsCode) {
        showAuthMsg("请输入短信验证码");
        throw new Error("请输入短信验证码");
      }

      const nameEl =
        document.getElementById("regName") ||
        document.getElementById("regNickname") ||
        document.getElementById("regUserName");

      let finalName = String(name || (nameEl ? nameEl.value : "") || "").trim();
      if (!finalName) finalName = "用户" + String(p).slice(-4);

      // ✅ 防重复提交（任何环境只允许一次 in-flight）
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
          API_VERIFY_REGISTER,
          {
            phone: p,
            code: smsCode,
            name: finalName,
            password: pw1,
            autoLogin: true,
          },
          { timeoutMs: 15000 }
        );

        if (!r.ok) throw new Error(formatApiError(r.data, "注册失败（服务器拒绝）"));

        if (r.data && r.data.token) this.setToken(r.data.token);

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

    // ✅ 发送验证码（注册）——只打“发送验证码”接口，不再打 verify-register
    async sendRegisterCode(phone) {
      showAuthMsg("");

      const p = normalizePhoneToE164_US(phone);
      if (!p) {
        showAuthMsg("请先输入正确的手机号（例如 646xxxxxxx 或 +1646xxxxxxx）");
        throw new Error("手机号不正确");
      }

      // ✅ 防重复触发：同一时刻只允许一个发送请求
      if (window.__SENDING_REG_CODE__) return;
      window.__SENDING_REG_CODE__ = true;

      try {
        const r = await apiPostJson(API_SEND_REGISTER_CODE, { phone: p }, { timeoutMs: 15000 });
        if (!r.ok) throw new Error(formatApiError(r.data, "发送验证码失败"));

        showAuthMsg("验证码已发送，请查收短信。", "ok");
        return true;
      } finally {
        window.__SENDING_REG_CODE__ = false;
      }
    },

    // ✅ 忘记密码：发送验证码
    async sendForgotCode(phone) {
      showAuthMsg("");

      const p = normalizePhoneToE164_US(phone);
      if (!p) {
        showAuthMsg("请先输入正确的手机号（例如 646xxxxxxx 或 +1646xxxxxxx）");
        throw new Error("手机号不正确");
      }

      const r = await apiPostJson("/api/auth/forgot-send", { phone: p }, { timeoutMs: 15000 });
      if (!r.ok) throw new Error(formatApiError(r.data, "发送验证码失败"));

      showAuthMsg("验证码已发送，请查收短信。", "ok");
      return true;
    },

    // ✅ 忘记密码：校验验证码并重置
    async resetPassword(phone, code, newPassword) {
      showAuthMsg("");

      const p = normalizePhoneToE164_US(phone);
      if (!p) {
        showAuthMsg("手机号格式不正确");
        throw new Error("手机号格式不正确");
      }

      const c = String(code || "").trim(); // ✅ 字符串，防 0 开头丢失
      if (!c) {
        showAuthMsg("请输入验证码");
        throw new Error("请输入验证码");
      }

      const np = String(newPassword || "").trim();
      if (!np) {
        showAuthMsg("请输入新密码");
        throw new Error("请输入新密码");
      }

      const r = await apiPostJson(
        "/api/auth/reset-password",
        { phone: p, code: c, newPassword: np },
        { timeoutMs: 15000 }
      );
      if (!r.ok) throw new Error(formatApiError(r.data, "重置密码失败"));

      showAuthMsg("密码已重置，请返回登录。", "ok");
      return true;
    },
  };

  // =========================================================
  // ✅ 小眼睛（只保留这一套！）
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
  // ✅ “获取验证码”（注册 regSendCodeBtn）
  // - 增加 60s 倒计时，避免狂点触发后端429
  // - 增加“只绑定一次”锁，防脚本重复加载导致重复 addEventListener
  // =========================================================
  (function () {
    function init() {
      if (window.__FB_REG_SEND_BOUND__) return;
      window.__FB_REG_SEND_BOUND__ = true;

      const btn = document.getElementById("regSendCodeBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
  if (btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";

  // ✅ 必须勾选 SMS consent 才允许发验证码（Twilio 30896关键）
  if (!requireSmsOptIn()) { btn.dataset.busy = "0"; return; }

  const phoneRaw = String(document.getElementById("regPhone")?.value || "").trim();
  try {
    await window.Auth.sendRegisterCode(phoneRaw);
    startCountdown(btn, 60, "获取验证码");
        } catch (e) {
          btn.disabled = false;
          btn.style.opacity = "";
        } finally {
          // 倒计时中本来就 disabled，不影响；失败时要解锁
          btn.dataset.busy = "0";
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();

  // =========================================================
  // ✅ “注册并登录”（registerSubmitBtn）
  // - 增加“只绑定一次”锁，防脚本重复加载导致重复 addEventListener
  // =========================================================
  (function () {
    function init() {
      if (window.__FB_REG_SUBMIT_BOUND__) return;
      window.__FB_REG_SUBMIT_BOUND__ = true;

      const btn = document.getElementById("registerSubmitBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
        // ✅ 双击/重复触发保护（和 Auth.register 的 __REGISTERING__ 双保险）
        if (btn.dataset.busy === "1") return;
        btn.dataset.busy = "1";

        try {
          const phone = String(document.getElementById("regPhone")?.value || "").trim();
          // 你首页没有姓名输入框，这里传空让 Auth.register 兜底生成“用户尾号”
          await window.Auth.register("", phone, "", "");
          window.dispatchEvent(new Event("storage"));
        } catch (e) {
          // showAuthMsg 已经做了
        } finally {
          btn.dataset.busy = "0";
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();

  // =========================================================
  // ✅ 登录 / 注册 / 忘记密码 面板切换控制
  // =========================================================
  (function () {
    if (window.__FB_AUTH_TABS_BOUND__) return;
    window.__FB_AUTH_TABS_BOUND__ = true;

    function $(id) {
      return document.getElementById(id);
    }

    function show(name) {
      const login = $("loginPanel");
      const reg = $("registerPanel");
      const fp = $("forgotPanel");
      if (!login || !reg || !fp) return;

      login.style.display = name === "login" ? "" : "none";
      reg.style.display = name === "register" ? "" : "none";
      fp.style.display = name === "forgot" ? "" : "none";

      const title = $("authTitle");
      if (title) {
        title.textContent = name === "forgot" ? "忘记密码" : name === "register" ? "注册" : "登录";
      }

      const tabLogin = $("tabLogin");
      const tabRegister = $("tabRegister");
      if (tabLogin && tabRegister) {
        tabLogin.classList.toggle("active", name === "login");
        tabRegister.classList.toggle("active", name === "register");
      }
    }

    function init() {
      const forgot = $("forgotPwdLink");
      const back = $("backToLoginBtn");
      const tabLogin = $("tabLogin");
      const tabReg = $("tabRegister");

      if (forgot) forgot.addEventListener("click", () => show("forgot"));
      if (back) back.addEventListener("click", () => show("login"));
      if (tabLogin) tabLogin.addEventListener("click", () => show("login"));
      if (tabReg) tabReg.addEventListener("click", () => show("register"));
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }

    window.__fb_showAuthPanel = show;
  })();

  // =========================================================
  // ✅ 忘记密码：发送验证码 fpSendCodeBtn（60s 倒计时）
  // =========================================================
  (function () {
    function init() {
      if (window.__FB_FP_SEND_BOUND__) return;
      window.__FB_FP_SEND_BOUND__ = true;

      const btn = document.getElementById("fpSendCodeBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
        if (btn.dataset.busy === "1") return;
        btn.dataset.busy = "1";

        const phoneRaw = String(document.getElementById("fpPhone")?.value || "").trim();
        try {
          await window.Auth.sendForgotCode(phoneRaw);
          startCountdown(btn, 60, "发送验证码");
        } catch (e) {
          btn.disabled = false;
          btn.style.opacity = "";
        } finally {
          btn.dataset.busy = "0";
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();

  // =========================================================
  // ✅ 忘记密码：验证并重置 fpResetBtn
  // =========================================================
  (function () {
    function init() {
      if (window.__FB_FP_RESET_BOUND__) return;
      window.__FB_FP_RESET_BOUND__ = true;

      const btn = document.getElementById("fpResetBtn");
      if (!btn) return;

      btn.addEventListener("click", async () => {
        try {
          const phone = String(document.getElementById("fpPhone")?.value || "").trim();
          const code = String(document.getElementById("fpCode")?.value || "").trim();
          const p1 = String(document.getElementById("fpNewPwd")?.value || "").trim();
          const p2 = String(document.getElementById("fpNewPwd2")?.value || "").trim();

          if (!p1 || !p2) {
            showAuthMsg("请输入并确认新密码");
            return;
          }
          if (p1 !== p2) {
            showAuthMsg("两次新密码不一致");
            return;
          }

          btn.disabled = true;
          btn.style.opacity = "0.7";
          const old = btn.textContent;
          btn.textContent = "处理中...";

          await window.Auth.resetPassword(phone, code, p1);

          btn.textContent = old || "验证并重置密码";
          btn.disabled = false;
          btn.style.opacity = "";
        } catch (e) {
          btn.disabled = false;
          btn.style.opacity = "";
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
