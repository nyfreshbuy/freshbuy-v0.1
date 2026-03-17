const AUTH_TOKEN_KEY = "freshbuy_token";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

async function api(url, options = {}) {
  const token = getToken();

  const fetchOptions = {
    method: options.method || "GET",
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      ...(options.headers || {}),
      Authorization: "Bearer " + token
    }
  };

  if (options.body !== undefined) {
    fetchOptions.body = options.body;
  }

  const res = await fetch(url, fetchOptions);

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  return {
    status: res.status,
    ok: res.ok,
    data
  };
}

async function checkLeader() {
  const result = await api("/api/leader/me?_t=" + Date.now());
  const status = result?.status;
  const data = result?.data;

  const leaderNameEl = document.getElementById("leaderName");

  if (status === 401) {
    if (leaderNameEl) leaderNameEl.innerText = "未登录";
    location.href = "/leader/login.html";
    return;
  }

  if (!data) {
    if (leaderNameEl) leaderNameEl.innerText = "接口无返回";
    alert("团长页访问失败：/api/leader/me 没有返回有效 JSON。");
    return;
  }

  const isOk = data.ok === true || data.success === true;

  if (!isOk) {
    if (leaderNameEl) leaderNameEl.innerText = "团长信息读取失败";
    alert("团长页访问失败：" + (data.message || "/api/leader/me 返回异常"));
    return;
  }

  if (!data.isLeader) {
    if (leaderNameEl) leaderNameEl.innerText = "当前账号不是团长";
    location.href = "/leader/login.html";
    return;
  }

  const leaderName =
    (data.leader && data.leader.name) ||
    data.name ||
    data.phone ||
    "团长";

  if (leaderNameEl) {
    leaderNameEl.innerText = "团长：" + leaderName;
  }
}

checkLeader();