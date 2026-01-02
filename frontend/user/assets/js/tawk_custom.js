// =========================
// Tawk 自定义入口控制
// - PC：左侧固定栏“联系客服”按钮打开
// - Mobile：右下角自定义“客服”按钮打开
// =========================
(function () {
  function openTawk() {
    if (window.Tawk_API && typeof window.Tawk_API.maximize === "function") {
      window.Tawk_API.maximize();
      return true;
    }
    return false;
  }

  // 给“左侧栏-联系客服”绑定（你需要给它加 id="btnSupport"）
  const pcBtn = document.getElementById("btnSupport");
  if (pcBtn) {
    pcBtn.addEventListener("click", () => {
      if (!openTawk()) {
        // Tawk 还没加载完：稍等重试一次（不弹窗、不打扰）
        setTimeout(openTawk, 400);
      }
    });
  }

  // 给手机右下角“客服”按钮绑定
  const mBtn = document.getElementById("mobileTawkBtn");
  if (mBtn) {
    mBtn.addEventListener("click", () => {
      if (!openTawk()) setTimeout(openTawk, 400);
    });
  }
})();
