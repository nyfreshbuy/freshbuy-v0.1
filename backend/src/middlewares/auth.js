// backend/src/middlewares/auth.js
import jwt from "jsonwebtoken";

export function requireLogin(req, res, next) {
  try {
    // ✅ 先验证 next（抓“错误调用方式”）
    if (typeof next !== "function") {
      console.error("❌ requireLogin called WRONG (next missing)", {
        nextType: typeof next,
        method: req?.method,
        url: req?.originalUrl,
        authHeader: req?.headers?.authorization ? "present" : "missing",
      });
      return res
        .status(500)
        .json({ success: false, message: "AUTH_MIDDLEWARE_NEXT_MISSING" });
    }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return res.status(401).json({ success: false, message: "未登录（缺少 token）" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ success: false, message: "JWT_SECRET 未配置" });
    }

    const payload = jwt.verify(token, secret);

    req.user = {
      id: payload.id,
      role: payload.role,
      phone: payload.phone,
    };

    return next();
  } catch (err) {
    console.error("❌ requireLogin verify error:", err?.message || err);
    return res.status(401).json({ success: false, message: "登录已过期，请重新登录" });
  }
}

export default requireLogin;
