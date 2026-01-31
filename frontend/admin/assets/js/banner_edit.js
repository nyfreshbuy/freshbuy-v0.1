// frontend/admin/assets/js/banner_edit.js
(function () {
  // =========================
  // 工具
  // =========================
  function $(id) { return document.getElementById(id); }

  function getToken() {
    return (
      localStorage.getItem("freshbuy_token") ||
      localStorage.getItem("token") ||
      localStorage.getItem("auth_token") ||
      ""
    );
  }

  async function api(url, opts) {
    const token = getToken();
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts && opts.headers ? opts.headers : {}
    );
    if (token) headers.Authorization = "Bearer " + token;

    const r = await fetch(url, Object.assign({}, opts, { headers }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.message) || ("HTTP " + r.status));
    return data;
  }

  function safeParseJson(text, fb) {
    try { return JSON.parse(text); } catch { return fb; }
  }

  function setStatus(s) {
    const el = $("statusText");
    if (el) el.textContent = s;
  }

  // =========================
  // slides UI
  // =========================
  let slides = [];

  function slideRowHtml(s, idx) {
    const enabled = s.enabled !== false;
    return `
      <tr data-idx="${idx}">
        <td>
          <label class="chk">
            <input type="checkbox" class="s-enabled" ${enabled ? "checked" : ""} />
            <span>启用</span>
          </label>
        </td>
        <td><input class="s-sort" type="number" value="${Number(s.sort || 0)}" /></td>
        <td><input class="s-imageUrl" type="text" value="${escapeAttr(s.imageUrl || "")}" placeholder="https://... 或 /user/assets/..." /></td>
        <td><input class="s-link" type="text" value="${escapeAttr(s.link || "")}" placeholder="/user/xxx.html 或 https://..." /></td>
        <td><input class="s-title" type="text" value="${escapeAttr(s.title || "")}" /></td>
        <td><input class="s-subtitle" type="text" value="${escapeAttr(s.subtitle || "")}" /></td>
        <td><input class="s-bgColor" type="text" value="${escapeAttr(s.bgColor || "")}" placeholder="#22c55e" /></td>
        <td><button class="btn mini danger s-del" type="button">删除</button></td>
      </tr>
    `;
  }

  function escapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderSlides() {
    const tbody = $("slidesTbody");
    if (!tbody) return;

    tbody.innerHTML = slides.map((s, i) => slideRowHtml(s, i)).join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.querySelector(".s-del").addEventListener("click", () => {
        const idx = Number(tr.getAttribute("data-idx"));
        slides.splice(idx, 1);
        renderSlides();
      });
    });
  }

  function readSlidesFromTable() {
    const tbody = $("slidesTbody");
    if (!tbody) return [];

    const rows = Array.from(tbody.querySelectorAll("tr"));
    return rows.map((tr) => ({
      enabled: !!tr.querySelector(".s-enabled").checked,
      sort: Number(tr.querySelector(".s-sort").value || 0),
      imageUrl: String(tr.querySelector(".s-imageUrl").value || "").trim(),
      link: String(tr.querySelector(".s-link").value || "").trim(),
      title: String(tr.querySelector(".s-title").value || "").trim(),
      subtitle: String(tr.querySelector(".s-subtitle").value || "").trim(),
      bgColor: String(tr.querySelector(".s-bgColor").value || "").trim(),
    }));
  }

  // =========================
  // banner load/save
  // =========================
  let currentKey = "";

  async function loadList(selectKey) {
    setStatus("加载列表中...");
    const data = await api("/api/admin/banners");
    const list = Array.isArray(data.list) ? data.list : [];

    const sel = $("bannerKeySelect");
    sel.innerHTML = "";

    list.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.key;
      opt.textContent = b.key + (b.enabled === false ? "（停用）" : "");
      sel.appendChild(opt);
    });

    // 如果没有任何 banner，自动创建 homepage_main
    if (list.length === 0) {
      await api("/api/admin/banners", {
        method: "POST",
        body: JSON.stringify({ key: "homepage_main" }),
      });
      return loadList(selectKey);
    }

    // 选中指定 key 或第一个
    const pick = selectKey || list[0].key;
    sel.value = pick;
    await loadOne(pick);
  }

  async function loadOne(key) {
    currentKey = key;
    setStatus("读取 " + key + " ...");
    const data = await api("/api/admin/banners/" + encodeURIComponent(key));
    const b = data.banner || null;

    $("enabledSelect").value = (b && b.enabled === false) ? "false" : "true";
    $("sortInput").value = (b && Number.isFinite(Number(b.sort))) ? Number(b.sort) : 0;
    $("titleInput").value = (b && b.title) || "";
    $("subtitleInput").value = (b && b.subtitle) || "";
    $("bgColorInput").value = (b && b.bgColor) || "#22c55e";
    $("imageUrlInput").value = (b && b.imageUrl) || "";

    // buttons
    const buttons = (b && Array.isArray(b.buttons)) ? b.buttons : [];
    $("buttonsInput").value = JSON.stringify(buttons, null, 2);

    // slides
    slides = (b && Array.isArray(b.slides)) ? b.slides : [];
    renderSlides();

    setStatus("已读取：" + key);
  }

  async function save() {
    if (!currentKey) return;

    setStatus("保存中...");

    const enabled = $("enabledSelect").value !== "false";
    const sort = Number($("sortInput").value || 0);
    const title = String($("titleInput").value || "").trim();
    const subtitle = String($("subtitleInput").value || "").trim();
    const bgColor = String($("bgColorInput").value || "").trim() || "#22c55e";
    const imageUrl = String($("imageUrlInput").value || "").trim();

    const buttons = safeParseJson($("buttonsInput").value, []);
    if (!Array.isArray(buttons)) {
      alert("buttons 必须是 JSON 数组");
      setStatus("保存失败：buttons 格式不对");
      return;
    }

    // 从表格读回 slides
    const slidesNow = readSlidesFromTable();

    const payload = {
      enabled,
      sort,
      title,
      subtitle,
      bgColor,
      imageUrl,
      buttons,
      slides: slidesNow,
    };

    const data = await api("/api/admin/banners/" + encodeURIComponent(currentKey), {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    slides = (data.banner && Array.isArray(data.banner.slides)) ? data.banner.slides : slidesNow;
    renderSlides();

    setStatus("已保存：" + currentKey + "（前台 Ctrl+F5 刷新）");
  }

  async function createNew() {
    const key = prompt("输入新的 Banner Key（例如 homepage_main2 / deals_day）", "");
    if (!key) return;

    setStatus("创建中...");
    await api("/api/admin/banners", {
      method: "POST",
      body: JSON.stringify({ key }),
    });

    await loadList(key);
    setStatus("已创建：" + key);
  }

  async function deleteCurrent() {
    if (!currentKey) return;
    const ok = confirm("确定删除 Banner: " + currentKey + " ？此操作不可恢复");
    if (!ok) return;

    setStatus("删除中...");
    await api("/api/admin/banners/" + encodeURIComponent(currentKey), { method: "DELETE" });
    await loadList();
    setStatus("已删除");
  }

  function bind() {
    $("bannerKeySelect").addEventListener("change", async (e) => {
      const key = e.target.value;
      await loadOne(key);
    });

    $("saveBtn").addEventListener("click", save);
    $("reloadBtn").addEventListener("click", () => loadOne(currentKey));
    $("newBtn").addEventListener("click", createNew);
    $("deleteBtn").addEventListener("click", deleteCurrent);

    $("addSlideBtn").addEventListener("click", () => {
      slides.push({
        enabled: true,
        sort: slides.length,
        imageUrl: "",
        link: "",
        title: "",
        subtitle: "",
        bgColor: "",
      });
      renderSlides();
    });

    $("importSlidesBtn").addEventListener("click", () => {
      const text = prompt("粘贴 slides 的 JSON 数组：", "[]");
      if (text == null) return;
      const arr = safeParseJson(text, null);
      if (!Array.isArray(arr)) return alert("必须是 JSON 数组");
      slides = arr;
      renderSlides();
    });

    $("exportSlidesBtn").addEventListener("click", () => {
      const slidesNow = readSlidesFromTable();
      const out = JSON.stringify(slidesNow, null, 2);
      // 简单 copy
      navigator.clipboard?.writeText(out).then(
        () => alert("已复制到剪贴板"),
        () => alert(out)
      );
    });
  }

  // =========================
  // init
  // =========================
  async function init() {
    try {
      bind();
      await loadList();
    } catch (e) {
      console.error(e);
      setStatus("错误：" + e.message);
      alert("加载失败：" + e.message + "\n\n可能原因：未登录/无管理员权限/接口未挂载");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
