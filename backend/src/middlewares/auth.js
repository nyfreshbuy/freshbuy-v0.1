// backend/src/middlewares/auth.js
import jwt from "jsonwebtoken";

export function requireLogin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return res.status(401).json({ success: false, msg: "未登录（缺少 token）" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ success: false, msg: "JWT_SECRET 未配置" });
    }

    const payload = jwt.verify(token, secret);

    // 你 signToken 里放的是 { id, role, phone }
    req.user = {
      id: payload.id,
      role: payload.role,
      phone: payload.phone,
    };

    next();
  } catch (err) {
    return res.status(401).json({ success: false, msg: "登录已过期，请重新登录" });
  }
}

export default { requireLogin };
