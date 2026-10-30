import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, closeDB } from './config/db.js';
import healthRoutes from './routes/healthRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import authRoutes from './routes/authRoutes.js';
import codebaseRoutes from './routes/codebaseRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import { purgeStaleTempFiles } from './services/documentService.js';
import { requestCorrelationMiddleware } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Clean up any stale temporary files from previous server runs
const tempDir = path.resolve(__dirname, 'uploads/temp');
purgeStaleTempFiles(tempDir);

// 1. Security Headers (Helmet)
app.use(helmet());

// 2. Cookie Parser for secure HTTP-only JWT cookies
app.use(cookieParser());

// 3. Strict CORS configuration with credentials support
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (e.g. mobile apps, curl, internal tests)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// 4. Body parser
app.use(express.json());

// 5. Request correlation and structured observability logger
app.use(requestCorrelationMiddleware);

// 6. Security Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 document uploads per hour
  message: {
    success: false,
    message: 'Upload rate limit reached. Please wait before uploading more documents.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 chat requests per minute
  message: {
    success: false,
    message: 'Too many chat requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/documents/upload', uploadLimiter);
app.use('/api/codebases/upload', uploadLimiter);
app.use('/api/chat', chatLimiter);

// 7. Mount Application Routes
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/codebases', auditRoutes);
app.use('/api/codebases', codebaseRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'DevMind AI — Codebase & Document Intelligence API',
    status: 'Running',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth',
      health: '/api/health',
      documents: '/api/documents',
      chat: '/api/chat',
      codebases: '/api/codebases',
    },
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler - Prevents leaking stack traces or internal secrets
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  const isProduction = process.env.NODE_ENV === 'production';
  const statusCode = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;

  res.status(statusCode).json({
    success: false,
    message: isProduction && statusCode === 500
      ? 'An unexpected internal server error occurred.'
      : err.message || 'Internal Server Error',
  });
});

let server = null;
let isShuttingDown = false;

/**
 * Handles graceful shutdown on SIGINT and SIGTERM signals.
 * Stops accepting new connections and safely closes the database connection.
 */
export async function gracefulShutdown(signal = 'SIGTERM') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);

  if (server) {
    server.close(async () => {
      console.log('[Server] HTTP server stopped accepting new requests.');
      await closeDB();
      console.log('[Server] Graceful shutdown complete. Exiting.');
      process.exit(0);
    });

    // Force exit after 10s if connections fail to close
    setTimeout(() => {
      console.error('[Server] Forced exit: connections did not close within timeout.');
      process.exit(1);
    }, 10000).unref();
  } else {
    await closeDB();
    process.exit(0);
  }
}

// Only start listening if run directly (allows importing in tests)
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`🚀 MERN Backend Server running on http://localhost:${PORT}`);
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export { server };
export default app;
