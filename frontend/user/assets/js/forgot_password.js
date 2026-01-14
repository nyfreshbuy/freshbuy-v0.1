// frontend/user/assets/js/forgot_password.js
(() => {
  const API_BASE = ""; // 同域留空
  const $ = (id) => document.getElementById(id);

  const elPhone = $("fpPhone");
  const elCode = $("fpCode");
  const elNewPwd = $("fpNewPwd");
  const elNewPwd2 = $("fpNewPwd2");
  const btnSend = $("fpSendCodeBtn");
  const btnReset = $("fpResetBtn");
  const msg = $("fpMsg");

  function setMsg(text, ok = false) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "msg" + (ok ? " ok" : "");
  }

  function isValidPhone(phone) {
    // 宽松校验：至少 8 位数字，允许 +、空格、-
    const s = String(phone || "").trim();
    const digits = s.replace(/[^\d]/g, "");
    return digits.length >= 8;
  }

  function isValidCode(code) {
    return /^\d{4,8}$/.test(String(code || "").trim());
  }

  function isValidPwd(pwd) {
    return String(pwd || "").trim().length >= 6;
  }

  async function postJson(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body || {}),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new Error(data?.message || data?.msg || `请求失败(${res.status})`);
    }
    return data;
  }

  // ========= 发送验证码 =========
  let cooldownTimer = null;
  let cooldownLeft = 0;

  function setSendBtnCooldown(seconds) {
    cooldownLeft = seconds;
    if (!btnSend) return;

    if (cooldownTimer) clearInterval(cooldownTimer);

    btnSend.disabled = true;
    btnSend.textContent = `已发送(${cooldownLeft}s)`;

    cooldownTimer = setInterval(() => {
      cooldownLeft -= 1;
      if (cooldownLeft <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        btnSend.disabled = false;
        btnSend.textContent = "发送验证码";
        return;
      }
      btnSend.textContent = `已发送(${cooldownLeft}s)`;
    }, 1000);
  }

  async function sendCode() {
    const phone = (elPhone?.value || "").trim();
    if (!isValidPhone(phone)) return setMsg("请输入正确手机号（建议带 +1）", false);

    setMsg("");
    btnSend && (btnSend.disabled = true);

    try {
      // ✅ 复用你现有接口：/api/sms/send-code
      // 如果你后端支持 purpose，可一起传；不支持也没关系
      await postJson("/api/sms/send-code", { phone, purpose: "reset_password" });

      setMsg("✅ 验证码已发送，请查收短信", true);
      setSendBtnCooldown(60);
    } catch (e) {
      btnSend && (btnSend.disabled = false);
      setMsg("发送失败：" + (e.message || ""), false);
    }
  }

  // ========= 重置密码 =========
  async function resetPassword() {
    const phone = (elPhone?.value || "").trim();
    const code = (elCode?.value || "").trim();
    const newPassword = (elNewPwd?.value || "").trim();
    const newPassword2 = (elNewPwd2?.value || "").trim();

    if (!isValidPhone(phone)) return setMsg("请输入正确手机号（建议带 +1）", false);
    if (!isValidCode(code)) return setMsg("请输入短信验证码（4-8 位数字）", false);
    if (!isValidPwd(newPassword)) return setMsg("新密码至少 6 位", false);
    if (newPassword !== newPassword2) return setMsg("两次输入的新密码不一致", false);

    setMsg("");
    if (btnReset) {
      btnReset.disabled = true;
      btnReset.textContent = "提交中...";
    }

    try {
      // ✅ 新增后端接口：/api/auth/reset-password
      await postJson("/api/auth/reset-password", { phone, code, newPassword });

      setMsg("✅ 密码已重置成功！现在可以回首页用新密码登录。", true);

      // 清空
      if (elCode) elCode.value = "";
      if (elNewPwd) elNewPwd.value = "";
      if (elNewPwd2) elNewPwd2.value = "";

      // 2 秒后回首页（不强制也行）
      setTimeout(() => {
        window.location.href = "/user/index.html?v=" + Date.now();
      }, 1200);
    } catch (e) {
      setMsg("重置失败：" + (e.message || ""), false);
    } finally {
      if (btnReset) {
        btnReset.disabled = false;
        btnReset.textContent = "验证并重置密码";
      }
    }
  }

  // ========= 导航按钮 =========
  $("backHomeBtn")?.addEventListener("click", () => {
    window.location.href = "/user/index.html?v=" + Date.now();
  });
  $("backLoginBtn")?.addEventListener("click", () => {
    window.location.href = "/user/index.html?v=" + Date.now();
  });

  // ========= 绑定 =========
  btnSend?.addEventListener("click", sendCode);
  btnReset?.addEventListener("click", resetPassword);

  // 输入优化：验证码只留数字
  elCode?.addEventListener("input", () => {
    elCode.value = String(elCode.value || "").replace(/[^\d]/g, "").slice(0, 8);
  });
})();
