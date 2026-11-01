import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_fallback_key_rag_chat';
const TOKEN_EXPIRY = '7d';

/**
 * Returns consistent secure cookie configuration for auth token.
 */
export function getAuthCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

/**
 * Issues a signed JWT for the given user.
 *
 * @param {Object} user
 * @returns {string} Signed JWT token
 */
export function signAuthToken(user) {
  const payload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role || 'user',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Authentication middleware.
 * Verifies JWT from HTTP-only cookie or Authorization: Bearer header.
 * Attaches user document to req.user.
 */
export async function authenticateUser(req, res, next) {
  try {
    let token = null;

    // 1. Check HTTP-only cookie
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // 2. Fallback to Authorization header: "Bearer <token>"
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in to access this resource.',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please log in again.',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.',
      });
    }

    // Lookup user in database
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account associated with this session no longer exists.',
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth Middleware Error]', error.message);
    return res.status(500).json({
      success: false,
      message: 'Authentication processing error.',
    });
  }
}
