// backend/src/middlewares/admin.js
export function requireAdmin(req, res, next) {
  try {
    // 依赖 requireLogin 已经把 req.user 写好了
    const role = req.user?.role;
    if (role !== "admin") {
      return res.status(403).json({ success: false, message: "权限不足（需要 admin）" });
    }
    next();
  } catch (e) {
    return res.status(403).json({ success: false, message: "权限校验失败" });
  }
}
