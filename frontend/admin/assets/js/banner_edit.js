// frontend/admin/assets/js/banner_edit.js
(function () {
  const API_BASE =
    window.API_BASE ||
    localStorage.getItem("API_BASE") ||
    ""; // 你项目如果有统一 API_BASE，就会自动用

  function getToken() {
    return (
      localStorage.getItem("freshbuy_token") ||
      localStorage.getItem("token") ||
      localStorage.getItem("auth_token") ||
      ""
    );
  }

  const el = (id) => document.getElementById(id);
  const msg = (t, ok = true) => {
    const m = el("msg");
    m.textContent = t || "";
    m.style.color = ok ? "#86efac" : "#fca5a5";
  };

  function safeJSON(s, fallback) {
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }

  function renderPreview(data) {
    const bgColor = data.bgColor || "#22c55e";
    const imageUrl = data.imageUrl || "";
    el("pvBanner").style.background = bgColor;

    if (imageUrl) {
      el("pvBg").style.backgroundImage = `url(${imageUrl})`;
      el("pvBg").style.display = "block";
    } else {
      el("pvBg").style.backgroundImage = "";
      el("pvBg").style.display = "none";
    }

    el("pvTitle").textContent = data.title || "（未填写标题）";
    el("pvSubtitle").textContent = data.subtitle || "（未填写副标题）";

    const btns = Array.isArray(data.buttons) ? data.buttons : [];
    el("pvBtns").innerHTML = btns
      .filter((b) => b && b.label)
      .slice(0, 10)
      .map((b) => `<a class="chip" href="${b.link || "#"}" onclick="return false;">${b.label}</a>`)
      .join("");
  }

  function getFormData() {
    const key = String(el("key").value || "").trim();
    const enabled = el("enabled").value === "true";
    const sort = Number(el("sort").value || 0);
    const title = String(el("title").value || "");
    const subtitle = String(el("subtitle").value || "");
    const bgColor = String(el("bgColor").value || "#22c55e");
    const imageUrl = String(el("imageUrl").value || "");
    const buttons = safeJSON(el("buttons").value || "[]", []);

    return { key, enabled, sort, title, subtitle, bgColor, imageUrl, buttons };
  }

  async function apiGet(path) {
    const r = await fetch(API_BASE + path, {
      headers: { Authorization: "Bearer " + getToken() },
    });
    return r.json();
  }

  async function apiPost(path, body) {
    const r = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + getToken(),
      },
      body: JSON.stringify(body || {}),
    });
    return r.json();
  }

  async function load() {
    msg("读取中...");
    const key = String(el("key").value || "").trim();
    const res = await apiGet(`/api/admin/banners/${encodeURIComponent(key)}`);
    if (!res || res.success !== true) {
      msg(res?.message || "读取失败", false);
      return;
    }
    const b = res.banner || {};
    el("enabled").value = String(b.enabled !== false);
    el("sort").value = b.sort ?? 0;
    el("title").value = b.title || "";
    el("subtitle").value = b.subtitle || "";
    el("bgColor").value = b.bgColor || "#22c55e";
    el("imageUrl").value = b.imageUrl || "";
    el("buttons").value = JSON.stringify(b.buttons || [], null, 2);

    renderPreview(getFormData());
    msg("已读取 ✅");
  }

  async function save() {
    const data = getFormData();

    // 简单校验：buttons 必须是数组
    if (!Array.isArray(data.buttons)) {
      msg("按钮 JSON 必须是数组，例如：[ {\"label\":\"xxx\",\"link\":\"#\"} ]", false);
      return;
    }

    msg("保存中...");
    const res = await apiPost("/api/admin/banners/upsert", data);
    if (!res || res.success !== true) {
      msg(res?.message || "保存失败", false);
      return;
    }
    renderPreview(data);
    msg("保存成功 ✅");
  }

  // 实时预览
  ["title", "subtitle", "bgColor", "imageUrl", "buttons", "enabled", "sort"].forEach((id) => {
    el(id).addEventListener("input", () => renderPreview(getFormData()));
    el(id).addEventListener("change", () => renderPreview(getFormData()));
  });

  el("btnLoad").addEventListener("click", load);
  el("btnSave").addEventListener("click", save);

  // 首次自动读取
  load();
})();
