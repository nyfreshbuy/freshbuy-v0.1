(function freshbuyIosApp() {
  "use strict";

  var capacitor = window.Capacitor;
  var isNativeIOS = Boolean(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()) &&
    capacitor.getPlatform && capacitor.getPlatform() === "ios";

  if (!isNativeIOS) return;

  document.documentElement.classList.add("freshbuy-ios-app");

  function currentTab() {
    var path = window.location.pathname.toLowerCase();
    if (path.indexOf("category") >= 0) return "category";
    if (path.indexOf("cart") >= 0 || path.indexOf("checkout") >= 0) return "cart";
    if (path.indexOf("order") >= 0) return "orders";
    if (path.indexOf("user_center") >= 0 || path.indexOf("recharge") >= 0) return "account";
    return "home";
  }

  function addBottomNavigation() {
    if (document.querySelector(".freshbuy-app-nav")) return;
    var nav = document.createElement("nav");
    nav.className = "freshbuy-app-nav";
    nav.setAttribute("aria-label", "App 主导航");
    nav.innerHTML = [
      ["home", "/user/index.html", "首页"],
      ["category", "/user/category.html", "分类"],
      ["cart", "/user/cart.html", "购物车"],
      ["orders", "/user/orders.html", "订单"],
      ["account", "/user/user_center.html", "我的"]
    ].map(function (item) {
      var selected = item[0] === currentTab() ? ' aria-current="page"' : "";
      return '<a data-tab="' + item[0] + '" href="' + item[1] + '"' + selected + '>' + item[2] + "</a>";
    }).join("");
    document.body.appendChild(nav);
  }

  function bindKeyboard() {
    var keyboard = capacitor.Plugins && capacitor.Plugins.Keyboard;
    if (!keyboard || !keyboard.addListener) return;
    keyboard.addListener("keyboardWillShow", function () {
      document.documentElement.classList.add("freshbuy-keyboard-open");
    });
    keyboard.addListener("keyboardWillHide", function () {
      document.documentElement.classList.remove("freshbuy-keyboard-open");
    });
  }

  function bindExternalLinks() {
    document.addEventListener("click", function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      var url;
      try { url = new URL(anchor.href, window.location.href); } catch (_) { return; }
      if (url.protocol === "tel:" || url.protocol === "mailto:" || url.protocol === "sms:") return;
      if (url.hostname === window.location.hostname || url.hostname.endsWith(".nyfreshbuy.com")) return;
      var browser = capacitor.Plugins && capacitor.Plugins.Browser;
      if (!browser || !browser.open || (url.protocol !== "https:" && url.protocol !== "http:")) return;
      event.preventDefault();
      browser.open({ url: url.href, presentationStyle: "popover" });
    }, true);
  }

  function start() {
    addBottomNavigation();
    bindKeyboard();
    bindExternalLinks();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
