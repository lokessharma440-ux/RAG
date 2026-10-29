import crypto from 'crypto';

/**
 * Phase E: Production Observability & Structured Request Logging
 *
 * Implements lightweight correlation tracking and structured logging.
 * STRICT SECURITY CONSTRAINTS:
 * - Never logs passwords, JWT secrets, authentication cookies, API keys, or raw document content.
 * - Fault tolerant: logging failures never interrupt normal request fulfillment.
 */

export function requestCorrelationMiddleware(req, res, next) {
  try {
    const correlationId =
      req.headers['x-correlation-id'] ||
      req.headers['x-request-id'] ||
      `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    req.id = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    const startTime = Date.now();

    res.on('finish', () => {
      try {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode;
        const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';

        // Redact any auth query parameters
        const sanitizedUrl = req.originalUrl?.replace(/([?&])(key|token|password)=[^&]+/gi, '$1$2=[REDACTED]');

        const logEntry = {
          level,
          timestamp: new Date().toISOString(),
          correlationId: req.id,
          method: req.method,
          url: sanitizedUrl,
          statusCode,
          durationMs,
          userId: req.user?._id ? String(req.user._id) : null,
        };

        if (level === 'ERROR') {
          console.error(`[${logEntry.timestamp}] [${logEntry.level}] [${logEntry.correlationId}] ${logEntry.method} ${logEntry.url} ${logEntry.statusCode} - ${logEntry.durationMs}ms`);
        } else {
          console.log(`[${logEntry.timestamp}] [${logEntry.level}] [${logEntry.correlationId}] ${logEntry.method} ${logEntry.url} ${logEntry.statusCode} - ${logEntry.durationMs}ms`);
        }
      } catch {
        // Fallback: Never crash request pipeline on log error
      }
    });
  } catch {
    // Fallback: Continue pipeline if correlation generation encounters unexpected issue
  }

  next();
}

/**
 * Structured log helper for RAG operations (ingestion, retrieval, generation).
 *
 * @param {Object} details
 */
export function logRAGOperation(details = {}) {
  try {
    const entry = {
      event: 'RAG_OPERATION',
      timestamp: new Date().toISOString(),
      operation: details.operation || 'query',
      correlationId: details.correlationId || null,
      userId: details.userId ? String(details.userId) : null,
      durationMs: details.durationMs ?? null,
      chunkCount: details.chunkCount ?? null,
      status: details.status || 'success',
      provider: details.provider || null,
      errorCategory: details.errorCategory || null,
    };
    console.log(`[RAG] [${entry.operation.toUpperCase()}] status=${entry.status} duration=${entry.durationMs}ms chunks=${entry.chunkCount} provider=${entry.provider}`);
  } catch {
    // Fail safe
  }
}
