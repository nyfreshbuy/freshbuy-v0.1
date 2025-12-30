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
