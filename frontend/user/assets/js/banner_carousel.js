// frontend/user/assets/js/banner_carousel.js
(function () {
  // ✅ 你在这里配置：图片 + 点击跳转链接
  // link 可以是站内页面 / 外链
  const BANNERS = [
    {
      img: "/user/assets/images/banners/banner1.jpg",
      link: "/user/newcomer.html",
      title: "新客体验专区 · 免费配送",
      sub: "无消费门槛 · 0元起配送",
    },
    {
      img: "/user/assets/images/banners/banner2.jpg",
      link: "/user/DailySpecial.html",
      title: "家庭必备 · 省钱专区",
      sub: "本周精选低价好货",
    },
    {
      img: "/user/assets/images/banners/banner3.jpg",
      link: "https://nyfreshbuy.com/user/recharge.html",
      title: "充值返现活动",
      sub: "充值到账快 · 账户余额可直接下单",
    },
  ];

  const AUTOPLAY_MS = 3500;

  function $(id) {
    return document.getElementById(id);
  }

  function build() {
    const wrap = $("fbCarousel");
    const track = $("fbCarouselTrack");
    const dots = $("fbCarouselDots");
    const prev = $("fbCarouselPrev");
    const next = $("fbCarouselNext");

    if (!wrap || !track || !dots) return;

    track.innerHTML = "";
    dots.innerHTML = "";

    // 没有 banner：直接隐藏
    if (!Array.isArray(BANNERS) || BANNERS.length === 0) {
      wrap.style.display = "none";
      return;
    }

    // 生成 slide
    BANNERS.forEach((b, i) => {
      const slide = document.createElement("div");
      slide.className = "fb-slide";
      slide.setAttribute("data-idx", String(i));

      // ✅ 图片可点击：用 a 包起来
      const a = document.createElement("a");
      a.href = b.link || "javascript:void(0)";
      a.target = (b.link || "").startsWith("http") ? "_blank" : "_self";
      a.rel = (b.link || "").startsWith("http") ? "noopener noreferrer" : "";

      const img = document.createElement("img");
      img.src = b.img;
      img.alt = b.title || "banner";

      a.appendChild(img);

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
      track.style.transform = "translateX(" + (-idx * 100) + "%)";
      setActiveDot();
    }

    function go(i) {
      idx = (i + BANNERS.length) % BANNERS.length;
      render();
    }

    function nextOne() { go(idx + 1); }
    function prevOne() { go(idx - 1); }

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
    wrap.addEventListener("touchstart", (e) => {
      isDragging = true;
      dragStartX = e.touches[0].clientX;
      dragDeltaX = 0;
      stop();
    }, { passive: true });

    wrap.addEventListener("touchmove", (e) => {
      if (!isDragging) return;
      dragDeltaX = e.touches[0].clientX - dragStartX;
    }, { passive: true });

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

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
