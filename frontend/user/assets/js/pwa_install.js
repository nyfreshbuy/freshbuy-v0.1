// frontend/user/assets/js/pwa_install.js
(function () {
  // 顶部按钮 + 区块按钮
  const btnTop = document.getElementById("btnInstallPWA");
  const btnSection = document.getElementById("btnInstallPWASection");
  const hint = document.getElementById("pwaInstallHint");

  let deferredPrompt = null;

  // 是否 iOS
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  // 是否已安装/在独立模式运行
  function isStandalone() {
    // iOS Safari
    const iosStandalone = window.navigator.standalone === true;
    // 其它浏览器
    const mqlStandalone =
      window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    return iosStandalone || mqlStandalone;
  }

  // 显示/隐藏两个按钮
  function setButtonsVisible(visible) {
    if (btnTop) btnTop.style.display = visible ? "inline-flex" : "none";
    if (btnSection) btnSection.style.display = visible ? "inline-flex" : "none";
  }

  // iOS 引导弹窗
  function showIOSGuide() {
    // 已存在就不重复创建
    const exist = document.getElementById("iosPwaGuide");
    if (exist) {
      exist.style.display = "flex";
      return;
    }

    const wrap = document.createElement("div");
    wrap.id = "iosPwaGuide";
    wrap.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;";

    wrap.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:360px;width:100%;padding:14px 14px 12px;box-shadow:0 20px 40px rgba(15,23,42,.35);">
        <div style="font-size:15px;font-weight:900;color:#111827;margin-bottom:6px;">把在鲜购添加到桌面</div>
        <div style="font-size:13px;color:#374151;line-height:1.6;">
          1）点击 Safari 底部 <b>分享</b> 按钮<br/>
          2）选择 <b>“添加到主屏幕”</b><br/>
          3）点击右上角 <b>添加</b>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button id="iosPwaGuideClose" style="padding:8px 12px;border-radius:12px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-weight:700;">知道了</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);
    document.getElementById("iosPwaGuideClose").addEventListener("click", () => {
      wrap.style.display = "none";
    });
  }

  // 点击安装按钮
  async function onInstallClick() {
    // 已安装就不提示
    if (isStandalone()) {
      setButtonsVisible(false);
      if (hint) hint.textContent = "你已添加到桌面 ✅";
      return;
    }

    // Android / Chrome：触发系统安装框
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
      } catch (e) {
        console.warn("PWA prompt failed:", e);
      } finally {
        deferredPrompt = null;
        setTimeout(refreshUI, 300);
      }
      return;
    }

    // iOS：弹引导
    if (isIOS()) {
      showIOSGuide();
      return;
    }

    alert("请使用手机 Chrome（安卓）或 Safari（iPhone）打开以添加到桌面。");
  }

  // 刷新 UI 显示
  function refreshUI() {
    // 没有按钮就不用做
    if (!btnTop && !btnSection) return;

    if (isStandalone()) {
      setButtonsVisible(false);
      if (hint) hint.textContent = "你已添加到桌面 ✅";
      return;
    }

    // iOS：允许显示按钮（用于弹引导）
    if (isIOS()) {
      setButtonsVisible(true);
      if (hint) hint.textContent = "iPhone：点击后按提示“分享 → 添加到主屏幕”。";
      return;
    }

    // Android：只有捕获到 beforeinstallprompt 才显示
    setButtonsVisible(!!deferredPrompt);
    if (hint) hint.textContent = deferredPrompt ? "安卓：点击即可安装到桌面。" : "";
  }

  // Android：可安装事件
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refreshUI();
  });

  // 已安装事件（部分浏览器支持）
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    refreshUI();
  });

  // 绑定点击
  if (btnTop) btnTop.addEventListener("click", onInstallClick);
  if (btnSection) btnSection.addEventListener("click", onInstallClick);

  // 初始化（兼容：脚本在 DOM 后面加载）
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshUI);
  } else {
    refreshUI();
  }

  // 兜底：页面聚焦/返回时再刷新一次（有些浏览器安装后不会触发 appinstalled）
  window.addEventListener("focus", () => setTimeout(refreshUI, 200));
  // =========================
  // 左侧 side-rail「App 下载」按钮
  // =========================
  const btnSide = document.getElementById("btnInstallPWASide");

  if (btnSide) {
    btnSide.addEventListener("click", function () {
      // 保留原有滚动行为（如果你有 scroll handler）
      const target = btnSide.getAttribute("data-scroll");
      if (target) {
        const el = document.querySelector(target);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }

      // 再触发 PWA 安装逻辑
      // 手机：安装 / 引导
      // 电脑：二维码
      setTimeout(() => {
        if (typeof onInstallClick === "function") {
          onInstallClick();
        }
      }, 200);
    });
  }
})();
