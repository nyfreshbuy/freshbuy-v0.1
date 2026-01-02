// assets/js/tawk_custom.js
// 目标：
// 1) PC + Mobile 隐藏 Tawk 默认右下角浮标（用官方 API hideWidget，最稳）
// 2) Mobile 显示自定义按钮 #mobileTawkBtn，点击打开聊天（showWidget + maximize）
// 3) onLoad 注入用户属性

(function () {
  window.Tawk_API = window.Tawk_API || {};

  // ===== 打开聊天：先显示 widget，再展开 =====
  function openTawk() {
    try {
      if (!window.Tawk_API) return false;

      // ✅ 关键：如果你隐藏过默认入口，需要先 show 再 maximize
      if (typeof window.Tawk_API.showWidget === "function") {
        window.Tawk_API.showWidget();
      }

      if (typeof window.Tawk_API.maximize === "function") {
        window.Tawk_API.maximize();
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ===== 最稳隐藏：官方 API + DOM 兜底 =====
  function hideDefaultLauncher() {
    try {
      if (window.Tawk_API && typeof window.Tawk_API.hideWidget === "function") {
        window.Tawk_API.hideWidget(); // ✅ 官方隐藏默认入口（PC+手机都生效）
      }
    } catch (e) {}

    // —— DOM 兜底（不删除，只隐藏）——
    var c = document.getElementById("tawkchat-container");
    if (c) {
      c.style.display = "none";
      c.style.visibility = "hidden";
      c.style.pointerEvents = "none";
    }

    // 一些版本会有额外的 minimized/bubble 容器
    var bubble =
      document.querySelector(".tawk-minimized-container") ||
      document.querySelector(".tawk-chat-bubble") ||
      document.querySelector(".tawk-button-container") ||
      document.querySelector(".tawk-bubble-container");
    if (bubble) {
      bubble.style.display = "none";
      bubble.style.visibility = "hidden";
      bubble.style.pointerEvents = "none";
    }
  }

  // ===== 用户属性注入 + 隐藏默认浮标（Tawk ready 后做最稳）=====
  window.Tawk_API.onLoad = function () {
    try {
      window.Tawk_API.setAttributes(
        {
          name: localStorage.getItem("freshbuy_login_nickname") || "访客",
          phone: localStorage.getItem("freshbuy_login_phone") || "",
          role: localStorage.getItem("freshbuy_role") || "guest",
        },
        function () {}
      );
    } catch (e) {}

    // ✅ Tawk 加载完成后再隐藏一次（最重要）
    hideDefaultLauncher();
  };

  // ===== 绑定手机按钮 =====
  function bindMobileBtn() {
    var btn = document.getElementById("mobileTawkBtn");
    if (!btn || btn.__tawk_bound) return;
    btn.__tawk_bound = true;

    btn.addEventListener("click", function () {
      // Tawk 还没 ready 就稍等一下再开
      if (!openTawk()) setTimeout(openTawk, 400);
    });
  }

  // （可选）如果你还想 PC 左侧固定栏按钮也打开 Tawk（你有 id="btnSupport"）
  function bindPcBtn() {
    var pcBtn = document.getElementById("btnSupport");
    if (!pcBtn || pcBtn.__tawk_bound) return;
    pcBtn.__tawk_bound = true;

    pcBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (!openTawk()) setTimeout(openTawk, 400);
    });
  }

  function boot() {
    bindMobileBtn();
    bindPcBtn();
    hideDefaultLauncher();
  }

  // DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Tawk 异步插入 → 观察 DOM，持续隐藏一段时间（更稳）
  var observer = new MutationObserver(function () {
    bindMobileBtn();
    bindPcBtn();
    hideDefaultLauncher();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 60 秒后断开（覆盖加载期）
  setTimeout(function () {
    observer.disconnect();
  }, 60000);
})();
