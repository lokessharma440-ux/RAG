import { getMemoryUsageMB } from './memoryDiagnostics.js';

/**
 * Creates a lightweight stopwatch to measure fine-grained stage timings.
 */
export function createMetricsTracker(requestId = null, userId = null) {
  const startTime = Date.now();
  const timings = {};
  const metrics = {
    requestId: requestId || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    userId: userId ? String(userId) : 'anonymous',
    cacheStatus: 'MISS',
    retrievedChunksCount: 0,
    evidenceScore: null,
    errors: [],
  };

  return {
    startStage(stageName) {
      const stageStart = Date.now();
      return () => {
        timings[`${stageName}Ms`] = Date.now() - stageStart;
      };
    },

    setMetric(key, value) {
      metrics[key] = value;
    },

    addError(stage, error) {
      metrics.errors.push({
        stage,
        message: error ? error.message || String(error) : 'Unknown error',
      });
    },

    finalizeAndLog(extraData = {}) {
      const totalDurationMs = Date.now() - startTime;
      const mem = getMemoryUsageMB();

      const finalRecord = {
        ...metrics,
        ...timings,
        ...extraData,
        totalDurationMs,
        memoryMB: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
      };

      // Structured logging with [DEVMIND_METRICS] prefix
      const isEnabled = process.env.ENABLE_DEVMIND_METRICS !== 'false';
      if (isEnabled) {
        const parts = [
          `[DEVMIND_METRICS] [${finalRecord.requestId}]`,
          `user=${finalRecord.userId}`,
          `cache=${finalRecord.cacheStatus}`,
          `rewrite=${finalRecord.queryRewritingMs ?? 0}ms`,
          `embed=${finalRecord.embeddingGenerationMs ?? 0}ms`,
          `retrieve=${finalRecord.retrievalMs ?? 0}ms`,
          `chunks=${finalRecord.retrievedChunksCount}`,
          `generate=${finalRecord.generationMs ?? 0}ms`,
          `evidence=${finalRecord.evidenceVerificationMs ?? 0}ms`,
          `evidenceScore=${finalRecord.evidenceScore ?? 'n/a'}`,
          `total=${totalDurationMs}ms`,
          `heap=${mem.heapUsed}/${mem.heapTotal}MB`,
        ];

        if (finalRecord.errors.length > 0) {
          parts.push(`errors=${finalRecord.errors.length}`);
        }

        console.log(parts.join(' | '));
      }

      return finalRecord;
    },
  };
}

