// frontend/user/service-worker.js
// =========================================================
// Freshbuy PWA Service Worker (PRODUCTION SAFE)
// ✅ Fix: Prevent duplicate POST requests (e.g. /api/auth/send-code)
// ✅ Policy:
//   - Never intercept non-GET requests (POST/PUT/PATCH/DELETE) -> always passthrough
//   - Do NOT cache /api/* by default
//   - Only cache GET APIs in whitelist (optional)
//   - HTML navigations: network-first, fallback to cache, then /user/index.html
//   - Static assets: cache-first, fallback to network then cache
// =========================================================

const CACHE_VERSION = "2026-02-19_v2"; // ✅ 每次改SW都要改版本号
const STATIC_CACHE = `freshbuy-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `freshbuy-runtime-${CACHE_VERSION}`;

// ✅ 预缓存（尽量只放稳定的静态文件）
const PRECACHE_URLS = [
  "/user/index.html",
  "/user/manifest.webmanifest",
  "/user/assets/css/main.css",
  "/user/assets/js/index.js",
  "/user/assets/js/cart.js",
];

// ✅ 可缓存的静态后缀（cache-first）
const STATIC_EXT_RE = /\.(?:css|js|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|eot|map)$/i;

// ✅ 允许缓存的 GET API 白名单（可按需增删）
// 说明：只缓存“公开接口/不会带用户隐私/不会导致副作用”的 GET
const CACHEABLE_API_PREFIX = [
  "/api/public/",
  "/api/zones/",
  "/api/products/",
  // 如果你有公开分类/广告等接口也可以加："/api/banners/"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => {
            if (!k.startsWith("freshbuy-")) return null;
            if (k === STATIC_CACHE || k === RUNTIME_CACHE) return null;
            return caches.delete(k);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ✅ 1) 非 GET 一律放行（关键：避免验证码/支付等重复请求）
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ 2) 只处理同源请求
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";

  // ---------------------------------------------------------
  // A) HTML 页面：网络优先（确保更新及时）
  // ---------------------------------------------------------
  const isHTML =
    req.mode === "navigate" ||
    accept.includes("text/html") ||
    url.pathname.endsWith(".html");

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 成功则更新缓存
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match("/user/index.html"))
        )
    );
    return;
  }

  // ---------------------------------------------------------
  // B) API：默认不缓存，只缓存白名单 GET
  // ---------------------------------------------------------
  if (url.pathname.startsWith("/api/")) {
    const okToCache = CACHEABLE_API_PREFIX.some((p) =>
      url.pathname.startsWith(p)
    );

    // ❗ 不在白名单：直接走网络（不 respondWith，不缓存）
    if (!okToCache) return;

    // ✅ 白名单 GET API：网络优先，失败才用缓存
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ---------------------------------------------------------
  // C) 静态资源：缓存优先（快）
  // ---------------------------------------------------------
  const isStatic =
    STATIC_EXT_RE.test(url.pathname) ||
    url.pathname.startsWith("/user/assets/");

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        });
      })
    );
    return;
  }

  // ---------------------------------------------------------
  // D) 其它 GET：网络优先 + 兜底缓存（温和策略）
  // ---------------------------------------------------------
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});