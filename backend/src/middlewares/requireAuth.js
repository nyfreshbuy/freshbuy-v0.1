// backend/src/middlewares/requireAuth.js
import jwt from "jsonwebtoken";
import User from "../models/user.js";

export default async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Missing Authorization token",
      });
    }

    const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: "JWT_SECRET / AUTH_SECRET not set",
      });
    }

    const payload = jwt.verify(token, secret);
    const userId =
      payload.id || payload.userId || payload._id || payload.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    const user = await User.findById(userId).select(
      "_id name phone role"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}
