const AUTH_TOKEN_KEY = "freshbuy_token";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

async function api(url) {
  const token = getToken();
  console.log("[leader] token exists:", !!token);

  const res = await fetch(url, {
    headers: {
      Authorization: "Bearer " + token
    }
  });

  console.log("[leader] status:", res.status, "url:", url);

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    console.log("[leader] json parse error:", e);
  }

  console.log("[leader] response:", data);

  return {
    status: res.status,
    data
  };
}

async function checkLeader() {
  const result = await api("/api/leader/me");
  const status = result?.status;
  const data = result?.data;

  const leaderNameEl = document.getElementById("leaderName");

  if (status === 401) {
    if (leaderNameEl) leaderNameEl.innerText = "未登录或 token 失效";
    alert("团长页访问失败：当前测试站未登录，或登录状态已失效。");
    return;
  }

  if (!data || !data.ok) {
    if (leaderNameEl) leaderNameEl.innerText = "团长信息读取失败";
    alert("团长页访问失败：/api/leader/me 返回异常。请按 F12 查看 Console 和 Network。");
    return;
  }

  if (!data.isLeader) {
    if (leaderNameEl) leaderNameEl.innerText = "当前账号不是团长";
    alert("当前测试站登录账号不是团长账号。");
    return;
  }

  if (leaderNameEl) {
    leaderNameEl.innerText = "团长：" + ((data.leader && data.leader.name) || "团长");
  }
}

checkLeader();