import rateLimit from "express-rate-limit";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://nyfreshbuy.com",
  "https://www.nyfreshbuy.com",
];

const BASE_CORS_OPTIONS = {
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400,
};

function splitOrigins(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return "";
  }
}

function normalizeHost(value = "") {
  return String(value).toLowerCase().replace(/^www\./, "");
}

const configuredOrigins = [
  ...splitOrigins(process.env.FRONTEND_URL),
  ...splitOrigins(process.env.CORS_ORIGINS),
];

const allowedOrigins = new Set(
  [...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]
    .map(normalizeOrigin)
    .filter(Boolean)
);

function isSameHostRequest(req, origin) {
  try {
    const originUrl = new URL(origin);
    const requestHost = String(req.headers.host || "").toLowerCase();
    return Boolean(requestHost) && normalizeHost(originUrl.host) === normalizeHost(requestHost);
  } catch {
    return false;
  }
}

function isAllowedOrigin(req, origin) {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowedOrigins.has(normalized)) return true;

  // Same-site POST requests can include an Origin header. Allow the current host
  // so production registration does not depend on a separate CORS env var.
  return isSameHostRequest(req, origin);
}

export function createCorsOptionsDelegate(req, callback) {
  const origin = req.headers.origin;

  if (isAllowedOrigin(req, origin)) {
    return callback(null, {
      ...BASE_CORS_OPTIONS,
      origin: origin ? true : false,
    });
  }

  const error = new Error("Origin is not allowed by CORS");
  error.status = 403;
  return callback(error);
}

export function applySecurity(app) {
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), geolocation=(self), microphone=(), payment=(self)"
    );
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");

    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }

    if (req.path.startsWith("/api/") && !req.path.startsWith("/api/public/")) {
      res.setHeader("Cache-Control", "no-store");
    }

    next();
  });
}

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "请求过于频繁，请稍后再试",
  },
});