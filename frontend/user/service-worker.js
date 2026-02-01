// frontend/user/service-worker.js
const CACHE_VERSION = "2026-01-30_v1";
const STATIC_CACHE = `freshbuy-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `freshbuy-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/user/index.html",
  "/user/manifest.webmanifest",
  "/user/assets/css/main.css",
  "/user/assets/js/index.js",
  "/user/assets/js/cart.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (!k.startsWith("freshbuy-")) return null;
          if (k === STATIC_CACHE || k === RUNTIME_CACHE) return null;
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  const accept = req.headers.get("accept") || "";

  // HTML：网络优先（更新及时）
  if (req.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/user/index.html")))
    );
    return;
  }

  // API：网络优先（失败再用缓存兜底）
  if (url.pathname.startsWith("/api/")) {
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

  // 静态：缓存优先
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
});
