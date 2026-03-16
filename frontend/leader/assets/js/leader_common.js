const AUTH_TOKEN_KEY = "freshbuy_token";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

async function api(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: "Bearer " + getToken()
    }
  });

  if (res.status === 401) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    location.href = "/user/index.html";
    return null;
  }

  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function checkLeader() {
  const data = await api("/api/leader/me");

  if (!data || !data.ok) {
    location.href = "/user/index.html";
    return;
  }

  if (!data.isLeader) {
    location.href = "/user/index.html";
    return;
  }

  const leaderNameEl = document.getElementById("leaderName");
  if (leaderNameEl) {
    leaderNameEl.innerText = "团长：" + ((data.leader && data.leader.name) || "团长");
  }
}

checkLeader();