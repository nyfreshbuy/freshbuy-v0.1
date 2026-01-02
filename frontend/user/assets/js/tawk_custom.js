// assets/js/tawk_custom.js
// 目标：
// 1) PC + Mobile 隐藏 Tawk 默认右下角浮标
// 2) Mobile 显示自定义按钮 #mobileTawkBtn，点击打开聊天
// 3) onLoad 注入用户属性（可选但你需要）

(function () {
  // ===== 用户属性注入 =====
  window.Tawk_API = window.Tawk_API || {};
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
  };

  // ===== 打开聊天 =====
  function openTawk() {
    if (window.Tawk_API && typeof window.Tawk_API.maximize === "function") {
      window.Tawk_API.maximize();
      return true;
    }
    return false;
  }

  // ===== 隐藏默认浮标（PC + Mobile）=====
  function hideDefaultLauncher() {
    // 常见主容器
    var c = document.getElementById("tawkchat-container");
    if (c) {
      c.style.display = "none";
      c.style.visibility = "hidden";
      c.style.pointerEvents = "none";
    }

    // 有些版本 launcher 在 iframe 里
    document.querySelectorAll("iframe").forEach(function (iframe) {
      var src = iframe.getAttribute("src") || "";
      var title = (iframe.getAttribute("title") || "").toLowerCase();
      if (src.indexOf("tawk.to") >= 0 || title.indexOf("tawk") >= 0) {
        iframe.style.display = "none";
        iframe.style.visibility = "hidden";
        iframe.style.pointerEvents = "none";
      }
    });
  }

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

  function boot() {
    hideDefaultLauncher();
    bindMobileBtn();
  }

  // DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Tawk 异步插入 → 观察 DOM，持续隐藏一段时间
  var observer = new MutationObserver(function () {
    hideDefaultLauncher();
    bindMobileBtn();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 30 秒后断开，避免性能浪费
  setTimeout(function () {
    observer.disconnect();
  }, 30000);
})();
