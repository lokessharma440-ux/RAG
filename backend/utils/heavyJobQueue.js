import { logMemory } from './memoryDiagnostics.js';

/**
 * Process-local bounded concurrency coordinator for memory-intensive operations
 * (PDF/TXT vectorization and GitHub repository codebase indexing).
 *
 * Enforces:
 * - Max 1 concurrent heavy indexing operation per process to protect 512MB RAM cap.
 * - Max pending queue depth (default: 5) to prevent unbounded memory growth under burst traffic.
 * - Lightweight requests (chat, auth, listing) bypass this queue entirely.
 */

const MAX_CONCURRENT_HEAVY_JOBS = parseInt(process.env.MAX_CONCURRENT_HEAVY_JOBS, 10) || 1;
const MAX_PENDING_HEAVY_JOBS = parseInt(process.env.MAX_PENDING_HEAVY_JOBS, 10) || 5;

let activeHeavyJobsCount = 0;
const pendingQueue = [];

/**
 * Executes a heavy job within the bounded concurrency limit.
 *
 * @param {Function} jobFn - Async function performing the heavy task
 * @param {Object} jobMeta - Non-sensitive metadata (jobType, resourceId)
 * @returns {Promise<any>}
 */
export async function enqueueHeavyJob(jobFn, jobMeta = { type: 'unknown' }) {
  if (activeHeavyJobsCount < MAX_CONCURRENT_HEAVY_JOBS) {
    activeHeavyJobsCount++;
    logMemory('HeavyQueue:StartImmediate', {
      type: jobMeta.type,
      active: activeHeavyJobsCount,
      queued: pendingQueue.length,
    });

    try {
      return await jobFn();
    } finally {
      activeHeavyJobsCount--;
      logMemory('HeavyQueue:Finish', {
        type: jobMeta.type,
        active: activeHeavyJobsCount,
        queued: pendingQueue.length,
      });
      processNextQueuedJob();
    }
  }

  // Active limit reached: check queue capacity
  if (pendingQueue.length >= MAX_PENDING_HEAVY_JOBS) {
    logMemory('HeavyQueue:CapacityRejected', {
      type: jobMeta.type,
      active: activeHeavyJobsCount,
      queued: pendingQueue.length,
    });
    const err = new Error(
      'Server is currently processing heavy indexing workloads at full capacity. Please wait a moment and try again.'
    );
    err.status = 429;
    err.code = 'HEAVY_QUEUE_FULL';
    throw err;
  }

  logMemory('HeavyQueue:Enqueued', {
    type: jobMeta.type,
    active: activeHeavyJobsCount,
    queued: pendingQueue.length + 1,
  });

  return new Promise((resolve, reject) => {
    pendingQueue.push({ jobFn, jobMeta, resolve, reject });
  });
}

function processNextQueuedJob() {
  if (pendingQueue.length === 0 || activeHeavyJobsCount >= MAX_CONCURRENT_HEAVY_JOBS) {
    return;
  }

  const next = pendingQueue.shift();
  activeHeavyJobsCount++;
  logMemory('HeavyQueue:StartDequeued', {
    type: next.jobMeta.type,
    active: activeHeavyJobsCount,
    queued: pendingQueue.length,
  });

  (async () => {
    try {
      const result = await next.jobFn();
      next.resolve(result);
    } catch (err) {
      next.reject(err);
    } finally {
      activeHeavyJobsCount--;
      logMemory('HeavyQueue:Finish', {
        type: next.jobMeta.type,
        active: activeHeavyJobsCount,
        queued: pendingQueue.length,
      });
      processNextQueuedJob();
    }
  })();
}

export function getQueueStatus() {
  return {
    active: activeHeavyJobsCount,
    queued: pendingQueue.length,
    maxConcurrent: MAX_CONCURRENT_HEAVY_JOBS,
    maxPending: MAX_PENDING_HEAVY_JOBS,
  };
}

