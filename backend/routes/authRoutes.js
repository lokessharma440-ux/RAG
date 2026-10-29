import express from 'express';
import { User } from '../models/User.js';
import {
  authenticateUser,
  signAuthToken,
  getAuthCookieOptions,
} from '../middleware/authMiddleware.js';

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * Register a new user account with email and password.
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if account already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
      });
    }

    // Create new user (password is automatically hashed by Mongoose pre-save hook)
    const user = await User.create({
      email: normalizedEmail,
      password,
    });

    // Generate JWT token and set HTTP-only cookie
    const token = signAuthToken(user);
    res.cookie('token', token, getAuthCookieOptions());

    return res.status(201).json({
      success: true,
      message: 'Registration successful.',
      data: {
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    console.error('[Registration Error]', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete registration.',
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticates user credentials and sets secure HTTP-only session cookie.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Both email and password are required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find user (explicitly include password for verification)
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Compare bcrypt password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Generate JWT and set secure cookie
    const token = signAuthToken(user);
    res.cookie('token', token, getAuthCookieOptions());

    return res.json({
      success: true,
      message: 'Login successful.',
      data: {
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    console.error('[Login Error]', error.message);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during login.',
    });
  }
});

/**
 * POST /api/auth/logout
 * Clears authentication session cookie.
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    ...getAuthCookieOptions(),
    maxAge: 0,
  });

  return res.json({
    success: true,
    message: 'Logged out successfully.',
  });
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile.
 */
router.get('/me', authenticateUser, (req, res) => {
  return res.json({
    success: true,
    data: {
      user: req.user.toSafeObject(),
    },
  });
});

export default router;
