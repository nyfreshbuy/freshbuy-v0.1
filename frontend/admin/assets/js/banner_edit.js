// frontend/admin/assets/js/banner_edit.js
(function () {
  // ====== 工具：token ======
  function getToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("freshbuy_token") ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("access_token") ||
      ""
    );
  }

  async function apiFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const tk = getToken();
    if (tk) headers.Authorization = "Bearer " + tk;

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setMsg(text, ok = true) {
    const el = $("msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok ? "#86efac" : "#fb7185";
  }

  function safeParseJson(text, fallback) {
    const s = String(text || "").trim();
    if (!s) return fallback;
    try {
      return JSON.parse(s);
    } catch (e) {
      return { __json_error__: e?.message || "JSON parse error" };
    }
  }

  function fmtJson(val) {
    return JSON.stringify(val, null, 2);
  }

  // ====== DOM refs ======
  const keySelect = $("keySelect");
  const enabled = $("enabled");
  const sort = $("sort");
  const title = $("title");
  const subtitle = $("subtitle");
  const bgColor = $("bgColor");
  const imageUrl = $("imageUrl");
  const buttons = $("buttons");
  const slides = $("slides");

  const btnSave = $("btnSave");
  const btnLoad = $("btnLoad");
  const btnFormat = $("btnFormat");

  // preview
  const pvBanner = $("pvBanner");
  const pvBg = $("pvBg");
  const pvTitle = $("pvTitle");
  const pvSubtitle = $("pvSubtitle");
  const pvBtns = $("pvBtns");
  const pvSlideHint = $("pvSlideHint");

  function normalizeButtons(arr) {
    const a = Array.isArray(arr) ? arr : [];
    return a
      .map((x) => ({
        label: String(x?.label || "").trim(),
        link: String(x?.link || "").trim(),
      }))
      .filter((x) => x.label);
  }

  function normalizeSlides(arr) {
    const a = Array.isArray(arr) ? arr : [];
    return a
      .map((x) => ({
        enabled: x?.enabled === false ? false : true,
        sort: Number(x?.sort || 0) || 0,
        imageUrl: String(x?.imageUrl || "").trim(),
        link: String(x?.link || "").trim(),
        title: String(x?.title || "").trim(),
        subtitle: String(x?.subtitle || "").trim(),
        bgColor: String(x?.bgColor || "").trim(),
      }))
      .filter((x) => x.imageUrl || x.bgColor || x.title || x.subtitle)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }

  function renderPreview() {
    const key = keySelect ? String(keySelect.value || "").trim() : "homepage_main";

    // slides 优先：预览第一张启用的 slide
    const rawSlides = safeParseJson(slides?.value || "", []);
    const slideObj = rawSlides && rawSlides.__json_error__ ? null : rawSlides;

    const slideList = normalizeSlides(slideObj || []);
    const firstSlide = slideList.find((s) => s.enabled !== false) || null;

    // 旧字段兜底
    const bTitle = String(title?.value || "").trim();
    const bSubtitle = String(subtitle?.value || "").trim();
    const bBg = String(bgColor?.value || "#22c55e").trim() || "#22c55e";
    const bImg = String(imageUrl?.value || "").trim();

    const rawBtns = safeParseJson(buttons?.value || "", []);
    const btnObj = rawBtns && rawBtns.__json_error__ ? [] : rawBtns;
    const btnList = normalizeButtons(btnObj);

    // 应用预览样式（如果有第一张 slide，就用它，否则用旧字段）
    const useBg = firstSlide?.bgColor || bBg || "#22c55e";
    const useImg = firstSlide?.imageUrl || bImg || "";
    const useTitle = firstSlide?.title || bTitle || "（未填写标题）";
    const useSubtitle = firstSlide?.subtitle || bSubtitle || "（未填写副标题）";

    if (pvBanner) pvBanner.style.background = useBg;

    // 背景图（注意：opacity 在 CSS 里是 .28，所以看起来会偏暗/偏黑，这是正常效果）
    if (pvBg) {
      if (useImg) {
        pvBg.style.backgroundImage = `url(${useImg})`;
        pvBg.style.display = "block";
      } else {
        pvBg.style.backgroundImage = "";
        pvBg.style.display = "none";
      }
    }

    if (pvTitle) pvTitle.textContent = useTitle;
    if (pvSubtitle) pvSubtitle.textContent = useSubtitle;

    if (pvBtns) {
      pvBtns.innerHTML = btnList
        .slice(0, 10)
        .map((x) => `<a class="chip" href="${x.link || "#"}" target="_self">${x.label}</a>`)
        .join("");
    }

    if (pvSlideHint) {
      if (slideList.length) {
        pvSlideHint.textContent = `当前预览：slides 第1张（共 ${slideList.length} 张） · key=${key}`;
      } else {
        pvSlideHint.textContent = `当前预览：旧字段（slides 为空） · key=${key}`;
      }
    }
  }

  function readFormToPayload() {
    const key = keySelect ? String(keySelect.value || "").trim() : "homepage_main";

    // buttons
    const btnParsed = safeParseJson(buttons?.value || "", []);
    if (btnParsed && btnParsed.__json_error__) {
      return { ok: false, message: "buttons JSON 格式错误：" + btnParsed.__json_error__ };
    }

    // slides
    const slidesParsed = safeParseJson(slides?.value || "", []);
    if (slidesParsed && slidesParsed.__json_error__) {
      return { ok: false, message: "slides JSON 格式错误：" + slidesParsed.__json_error__ };
    }

    const payload = {
      key,
      enabled: String(enabled?.value || "true") === "true",
      sort: Number(sort?.value || 0) || 0,

      // 旧字段：兜底用
      title: String(title?.value || "").trim(),
      subtitle: String(subtitle?.value || "").trim(),
      bgColor: String(bgColor?.value || "#22c55e").trim() || "#22c55e",
      imageUrl: String(imageUrl?.value || "").trim(),
      buttons: normalizeButtons(btnParsed),

      // 新字段：多轮播
      slides: normalizeSlides(slidesParsed),
    };

    return { ok: true, payload };
  }

  async function loadKeyList() {
    // 后台列表接口：GET /api/banners/admin/list
    const { res, data } = await apiFetch("/api/banners/admin/list", { cache: "no-store" });
    if (!res.ok || !data?.success) {
      setMsg(data?.message || "读取 banner 列表失败（请确认已登录管理员）", false);
      return;
    }

    const list = Array.isArray(data.list) ? data.list : [];
    if (!keySelect) return;

    const current = String(keySelect.value || "").trim() || "homepage_main";
    keySelect.innerHTML = "";

    list.forEach((x) => {
      const opt = document.createElement("option");
      opt.value = x.key;
      opt.textContent = `${x.key}${x.enabled === false ? "（禁用）" : ""}${x.slideCount ? ` · slides=${x.slideCount}` : ""}`;
      keySelect.appendChild(opt);
    });

    // 如果列表为空，至少保留 homepage_main
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "homepage_main";
      opt.textContent = "homepage_main";
      keySelect.appendChild(opt);
    }

    // 恢复选择
    keySelect.value = list.some((x) => x.key === current) ? current : (list[0]?.key || "homepage_main");
  }

  async function loadBannerByKey(key) {
    const k = String(key || "").trim();
    if (!k) return;

    const { res, data } = await apiFetch("/api/banners/admin/" + encodeURIComponent(k), { cache: "no-store" });
    if (!res.ok || !data?.success) {
      setMsg(data?.message || "读取失败", false);
      return;
    }

    const b = data.banner || null;

    // 如果不存在就给空模板
    const banner = b || {
      key: k,
      enabled: true,
      sort: 0,
      title: "",
      subtitle: "",
      bgColor: "#22c55e",
      imageUrl: "",
      buttons: [],
      slides: [],
    };

    if (enabled) enabled.value = banner.enabled === false ? "false" : "true";
    if (sort) sort.value = Number(banner.sort || 0) || 0;

    if (title) title.value = banner.title || "";
    if (subtitle) subtitle.value = banner.subtitle || "";
    if (bgColor) bgColor.value = banner.bgColor || "#22c55e";
    if (imageUrl) imageUrl.value = banner.imageUrl || "";

    if (buttons) buttons.value = fmtJson(Array.isArray(banner.buttons) ? banner.buttons : []);
    if (slides) slides.value = fmtJson(Array.isArray(banner.slides) ? banner.slides : []);

    setMsg(b ? "已读取：" + k : "该 key 尚未创建，已载入空模板：" + k, true);
    renderPreview();
  }

  async function saveBanner() {
    const got = readFormToPayload();
    if (!got.ok) return setMsg(got.message, false);

    setMsg("保存中...", true);

    const { res, data } = await apiFetch("/api/banners/admin/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(got.payload),
    });

    if (!res.ok || !data?.success) {
      return setMsg(data?.message || "保存失败（请确认已登录管理员）", false);
    }

    setMsg("✅ 保存成功：" + got.payload.key, true);

    // 保存成功后重新读取一次，确保后端保存的规范化结果回填
    await loadKeyList();
    if (keySelect) keySelect.value = got.payload.key;
    await loadBannerByKey(got.payload.key);
  }

  function formatJsonFields() {
    // buttons
    const b = safeParseJson(buttons?.value || "", []);
    if (b && b.__json_error__) return setMsg("buttons JSON 格式错误：" + b.__json_error__, false);
    if (buttons) buttons.value = fmtJson(b);

    // slides
    const s = safeParseJson(slides?.value || "", []);
    if (s && s.__json_error__) return setMsg("slides JSON 格式错误：" + s.__json_error__, false);
    if (slides) slides.value = fmtJson(s);

    setMsg("已格式化 JSON", true);
    renderPreview();
  }

  function bind() {
    // 实时预览
    [enabled, sort, title, subtitle, bgColor, imageUrl, buttons, slides].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", () => {
        renderPreview();
      });
      el.addEventListener("change", () => {
        renderPreview();
      });
    });

    if (keySelect) {
      keySelect.addEventListener("change", () => {
        const k = String(keySelect.value || "").trim();
        loadBannerByKey(k);
      });
    }

    if (btnLoad) btnLoad.addEventListener("click", async () => {
      const k = String(keySelect?.value || "").trim();
      await loadBannerByKey(k);
    });

    if (btnSave) btnSave.addEventListener("click", saveBanner);
    if (btnFormat) btnFormat.addEventListener("click", formatJsonFields);
  }

  // ====== init ======
  window.addEventListener("DOMContentLoaded", async () => {
    bind();
    await loadKeyList();
    const k = String(keySelect?.value || "homepage_main").trim();
    await loadBannerByKey(k);
  });
})();
