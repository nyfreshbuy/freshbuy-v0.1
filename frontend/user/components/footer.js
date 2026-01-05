// frontend/user/components/footer.js
(function () {
  const containerId = "freshbuy-footer-container";
  let footerContainer = document.getElementById(containerId);

  if (!footerContainer) {
    footerContainer = document.createElement("div");
    footerContainer.id = containerId;
    document.body.appendChild(footerContainer);
  }

  // 防缓存
  const footerUrl = "/user/components/footer.html?v=" + Date.now();

  fetch(footerUrl, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("footer.html HTTP " + res.status);
      return res.text();
    })
    .then((html) => {
      footerContainer.innerHTML = html;

      // 年份
      const yearEl = document.getElementById("footerYear");
      if (yearEl) yearEl.textContent = new Date().getFullYear();

      // 注入完 footer 后，再拉配置
      return fetch("/api/site-config?v=" + Date.now(), { cache: "no-store" });
    })
    .then((res) => {
      if (!res.ok) throw new Error("site-config HTTP " + res.status);
      return res.json();
    })
    .then((json) => {
      if (!json?.success) return;
      const d = json.data?.delivery;
      if (!d) return;

      const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el && typeof val === "string" && val.trim()) el.textContent = val;
      };

      setText("fbAreaZh", d.areaZh);
      setText("fbAreaEn", d.areaEn);
      setText("fbAreaNoteZh", d.areaNoteZh);
      setText("fbAreaNoteEn", d.areaNoteEn);

      setText("fbFreqZh", d.frequencyZh);
      setText("fbFreqEn", d.frequencyEn);

      setText("fbDayZh", d.dayZh);
      setText("fbDayEn", d.dayEn);

      setText("fbTimeZh", d.timeWindowZh);
      setText("fbTimeEn", d.timeWindowEn);
    })
    .catch((err) => {
      console.error("Footer inject/config failed:", err);
    });
})();
(() => {
  let sx = 0, sy = 0;

  function allowX(target){
    // ✅ 允许横滑的区域：子分类 pills（你页面里就是 filter-row）
    return !!(target && target.closest && target.closest(".filter-row"));
  }

  document.addEventListener("touchstart", (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    sx = t.clientX;
    sy = t.clientY;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (allowX(e.target)) return; // 放行 pills 横滑

    const t = e.touches && e.touches[0];
    if (!t) return;

    const dx = t.clientX - sx;
    const dy = t.clientY - sy;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      e.preventDefault(); // 禁止页面左右拖动
    }
  }, { passive: false });
})();

