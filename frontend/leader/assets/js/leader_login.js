const AUTH_TOKEN_KEY = "freshbuy_token";

function setError(msg) {
  const el = document.getElementById("errorBox");
  if (el) el.innerText = msg || "";
}

function setLoading(loading) {
  const btn = document.getElementById("loginBtn");
  if (!btn) return;
  btn.disabled = !!loading;
  btn.innerText = loading ? "登录中..." : "登录";
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { res, data };
}

async function loginLeader() {
  const phone = (document.getElementById("phone")?.value || "").trim();
  const password = (document.getElementById("password")?.value || "").trim();

  setError("");

  if (!phone || !password) {
    setError("请输入手机号和密码");
    return;
  }

  setLoading(true);

  try {
    // 兼容你项目当前常见登录接口
    let loginResult = await requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password })
    });

    // 如果这个接口不存在或失败，再尝试兼容旧接口
    if (!loginResult.data || loginResult.data.success === false || loginResult.res.status >= 400) {
      const fallback = await requestJson("/api/auth/login-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password })
      });

      if (fallback.data && fallback.res.status < 400) {
        loginResult = fallback;
      }
    }

    const loginData = loginResult.data || {};

    const token =
      loginData.token ||
      loginData.jwt ||
      loginData.accessToken ||
      "";

    const loginOk =
      loginData.success === true ||
      loginData.ok === true ||
      !!token;

    if (!loginOk || !token) {
      setError(loginData.message || "登录失败，请检查账号或密码");
      setLoading(false);
      return;
    }

    localStorage.setItem(AUTH_TOKEN_KEY, token);

    const meResult = await requestJson("/api/leader/me", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const meData = meResult.data || {};

    const meOk = meData.ok === true || meData.success === true;

    if (!meOk) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setError(meData.message || "团长信息读取失败");
      setLoading(false);
      return;
    }

    if (!meData.isLeader) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setError("当前账号不是团长账号");
      setLoading(false);
      return;
    }

    location.href = "/leader/index.html";
  } catch (err) {
    console.error("leader login error:", err);
    setError("登录失败，请稍后重试");
    setLoading(false);
  }
}

document.getElementById("loginBtn")?.addEventListener("click", loginLeader);

document.getElementById("password")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginLeader();
});