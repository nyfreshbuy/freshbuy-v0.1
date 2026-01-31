// frontend/user/assets/js/banner_carousel.js
(function () {
  // =====================================================
  // ✅ 轮播 Banner（支持后端动态配置）
  // 优先：GET /api/banners/homepage_main
  // - 如果 banner.slides 有内容 => 用 slides
  // - 如果 slides 为空 => 用 banner.title/subtitle/imageUrl 当作 1 张
  // 兜底：本地 BANNERS（原来的 3 张静态图）
  // =====================================================

  // ✅ 你原来的本地兜底 banners（后端没配置/拉取失败时使用）
  const LOCAL_BANNERS = [
    {
      img: "/user/assets/images/banners/banner1.jpg",
      link: "/user/newcomer.html",
      title: "新客体验专区 · 免费配送",
      sub: "无消费门槛 · 0元起配送",
      enabled: true,
      sort: 0,
    },
    {
      img: "/user/assets/images/banners/banner2.jpg",
      link: "/user/DailySpecial.html",
      title: "家庭必备 · 省钱专区",
      sub: "本周精选低价好货",
      enabled: true,
      sort: 1,
    },
    {
      img: "/user/assets/images/banners/banner3.jpg",
      link: "https://nyfreshbuy.com/user/recharge.html",
      title: "充值返现活动",
      sub: "充值到账快 · 账户余额可直接下单",
      enabled: true,
      sort: 2,
    },
  ];

  const AUTOPLAY_MS = 3500;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeNum(n, fb) {
    const x = Number(n);
    return Number.isFinite(x) ? x : fb;
  }

  // ✅ 统一把“后端 banner”转换成 slides 数组
  function normalizeSlidesFromAPI(banner) {
    const raw = Array.isArray(banner && banner.slides) ? banner.slides : [];

    // 1) slides 有内容 => 过滤 enabled + 排序
    const enabledSlides = raw
      .filter((s) => s && s.enabled !== false)
      .sort((a, b) => safeNum(a.sort, 0) - safeNum(b.sort, 0))
      .map((s) => ({
        img: s.imageUrl || s.img || "",
        link: s.link || "",
        title: s.title || "",
        sub: s.subtitle || s.sub || "",
        enabled: s.enabled !== false,
        sort: safeNum(s.sort, 0),
      }))
      .filter((s) => !!(s.img || s.title || s.sub)); // 防空

    if (enabledSlides.length > 0) return enabledSlides;

    // 2) slides 为空 => 用 banner 本身当作 1 张
    if (banner && banner.enabled !== false) {
      const one = {
        img: banner.imageUrl || "",
        link: banner.link || "",
        title: banner.title || "",
        sub: banner.subtitle || "",
        enabled: banner.enabled !== false,
        sort: safeNum(banner.sort, 0),
      };
      if (one.img || one.title || one.sub) return [one];
    }

    // 3) 都没有 => 空
    return [];
  }

  // ✅ 拉后端 banner（失败就返回 null）
  async function fetchHomepageBanner() {
    try {
      const url = "/api/banners/homepage_main?t=" + Date.now();
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data || data.success !== true) return null;
      return data.banner || null;
    } catch (e) {
      return null;
    }
  }

  // ✅ 统一选择：后端 > 本地兜底
  async function getBanners() {
    const banner = await fetchHomepageBanner();
    const fromApi = normalizeSlidesFromAPI(banner);

    if (fromApi.length > 0) return fromApi;

    // 本地兜底也做 enabled/sort
    return (Array.isArray(LOCAL_BANNERS) ? LOCAL_BANNERS : [])
      .filter((b) => b && b.enabled !== false)
      .sort((a, b) => safeNum(a.sort, 0) - safeNum(b.sort, 0));
  }

  async function build() {
    const wrap = $("fbCarousel");
    const track = $("fbCarouselTrack");
    const dots = $("fbCarouselDots");
    const prev = $("fbCarouselPrev");
    const next = $("fbCarouselNext");

    if (!wrap || !track || !dots) return;

    const BANNERS = await getBanners();

    track.innerHTML = "";
    dots.innerHTML = "";

    // 没有 banner：直接隐藏
    if (!Array.isArray(BANNERS) || BANNERS.length === 0) {
      wrap.style.display = "none";
      return;
    }

    wrap.style.display = "";

    // 生成 slide
    BANNERS.forEach((b, i) => {
      const slide = document.createElement("div");
      slide.className = "fb-slide";
      slide.setAttribute("data-idx", String(i));

      // ✅ 图片可点击：用 a 包起来
      const a = document.createElement("a");
      const link = b.link || "javascript:void(0)";
      a.href = link;
      a.target = String(link).startsWith("http") ? "_blank" : "_self";
      a.rel = String(link).startsWith("http") ? "noopener noreferrer" : "";

      // ✅ 图片（如果没有 img，也允许只显示文字 overlay）
      if (b.img) {
        const img = document.createElement("img");
        img.src = b.img;
        img.alt = b.title || "banner";
        a.appendChild(img);
      } else {
        // 没图：给一个纯色占位（避免高度塌陷）
        const ph = document.createElement("div");
        ph.style.cssText =
          "height:260px;background:linear-gradient(135deg,#0f172a,#111827);";
        a.appendChild(ph);
      }

      // 可选：叠加文字
      const overlay = document.createElement("div");
      overlay.className = "fb-slide-overlay";
      overlay.innerHTML = `
        <div class="fb-slide-title">${escapeHtml(b.title || "")}</div>
        <div class="fb-slide-sub">${escapeHtml(b.sub || "")}</div>
      `;

      slide.appendChild(a);
      slide.appendChild(overlay);

      track.appendChild(slide);

      // dots
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "fb-dot" + (i === 0 ? " active" : "");
      dot.setAttribute("aria-label", "第 " + (i + 1) + " 张");
      dot.addEventListener("click", () => go(i));
      dots.appendChild(dot);
    });

    let idx = 0;
    let timer = null;
    let isDragging = false;
    let dragStartX = 0;
    let dragDeltaX = 0;

    function setActiveDot() {
      const all = dots.querySelectorAll(".fb-dot");
      all.forEach((d, i) => d.classList.toggle("active", i === idx));
    }

    function render() {
      track.style.transform = "translateX(" + -idx * 100 + "%)";
      setActiveDot();
    }

    function go(i) {
      idx = (i + BANNERS.length) % BANNERS.length;
      render();
    }

    function nextOne() {
      go(idx + 1);
    }
    function prevOne() {
      go(idx - 1);
    }

    if (next) next.addEventListener("click", nextOne);
    if (prev) prev.addEventListener("click", prevOne);

    // ✅ 自动播放（鼠标悬停暂停）
    function start() {
      stop();
      if (BANNERS.length <= 1) return;
      timer = setInterval(nextOne, AUTOPLAY_MS);
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    wrap.addEventListener("mouseenter", stop);
    wrap.addEventListener("mouseleave", start);

    // ✅ 手机滑动切换
    wrap.addEventListener(
      "touchstart",
      (e) => {
        isDragging = true;
        dragStartX = e.touches[0].clientX;
        dragDeltaX = 0;
        stop();
      },
      { passive: true }
    );

    wrap.addEventListener(
      "touchmove",
      (e) => {
        if (!isDragging) return;
        dragDeltaX = e.touches[0].clientX - dragStartX;
      },
      { passive: true }
    );

    wrap.addEventListener("touchend", () => {
      if (!isDragging) return;
      isDragging = false;
      const threshold = 40; // 手指滑动阈值
      if (dragDeltaX > threshold) prevOne();
      else if (dragDeltaX < -threshold) nextOne();
      start();
    });

    // 初始渲染 + 开始自动播放
    render();
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
