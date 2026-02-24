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
// ✅ Update behavior:
//   - skipWaiting() on install (new SW installs -> no waiting)
//   - clients.claim() on activate (new SW takes control immediately)
//   - Optional: allow page to trigger SKIP_WAITING via postMessage
// =========================================================

const CACHE_VERSION = "2026-02-24_v1"; // ✅ 每次改SW都要改版本号
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
const CACHEABLE_API_PREFIX = [
  "/api/public/",
  "/api/zones/",
  "/api/products/",
  // "/api/banners/",
];

function isOkResponse(res) {
  // 只缓存“正常可读”的 response；避免缓存错误页/不可读响应
  return res && (res.status === 200 || res.type === "basic");
}

async function putRuntimeCache(req, res) {
  try {
    if (!isOkResponse(res)) return;
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(req, res);
  } catch {
    // ignore
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(PRECACHE_URLS);
      } catch {
        // 预缓存失败也不要阻塞安装
      }
      // ✅ 新SW装好就准备接管
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((k) => {
            if (!k.startsWith("freshbuy-")) return null;
            if (k === STATIC_CACHE || k === RUNTIME_CACHE) return null;
            return caches.delete(k);
          })
        );
      } finally {
        // ✅ 立刻接管所有页面/标签页
        await self.clients.claim();
      }
    })()
  );
});

// ✅ 可选：页面端可 postMessage({type:"SKIP_WAITING"}) 触发立即更新
self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
      (async () => {
        try {
          const res = await fetch(req);
          // 成功则更新缓存（注意：不要 await，避免影响首屏速度）
          putRuntimeCache(req, res.clone());
          return res;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const fallback = await caches.match("/user/index.html");
          return fallback || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // ---------------------------------------------------------
  // B) API：默认不缓存，只缓存白名单 GET
  // ---------------------------------------------------------
  if (url.pathname.startsWith("/api/")) {
    const okToCache = CACHEABLE_API_PREFIX.some((p) => url.pathname.startsWith(p));

    // ❗ 不在白名单：直接走网络（不 respondWith，不缓存）
    if (!okToCache) return;

    // ✅ 白名单 GET API：网络优先，失败才用缓存
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          putRuntimeCache(req, res.clone());
          return res;
        } catch {
          const cached = await caches.match(req);
          return cached || new Response(JSON.stringify({ success: false, message: "offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      })()
    );
    return;
  }

  // ---------------------------------------------------------
  // C) 静态资源：缓存优先（快）
  // ---------------------------------------------------------
  const isStatic = STATIC_EXT_RE.test(url.pathname) || url.pathname.startsWith("/user/assets/");

  if (isStatic) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;

        const res = await fetch(req);
        putRuntimeCache(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // ---------------------------------------------------------
  // D) 其它 GET：网络优先 + 兜底缓存（温和策略）
  // ---------------------------------------------------------
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        putRuntimeCache(req, res.clone());
        return res;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response("Offline", { status: 503 });
      }
    })()
  );
});