/**
 * Lightweight, structured memory diagnostics for memory-constrained deployments (Render Free 512MB RAM).
 * Tracks RSS, Heap Used, Heap Total, External, and ArrayBuffers in Megabytes.
 * Prefix: [MEMORY]
 */

export function getMemoryUsageMB() {
  const mem = process.memoryUsage();
  return {
    rss: (mem.rss / 1024 / 1024).toFixed(1),
    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(1),
    heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(1),
    external: (mem.external / 1024 / 1024).toFixed(1),
    arrayBuffers: mem.arrayBuffers ? (mem.arrayBuffers / 1024 / 1024).toFixed(1) : '0.0',
  };
}

/**
 * Logs a concise memory diagnostic line with structured metadata.
 * Never logs user document contents, secrets, or sensitive data.
 *
 * @param {string} checkpoint - Lifecycle checkpoint identifier
 * @param {Object} [metadata={}] - Non-sensitive context metrics (e.g. chunkCount, batchIndex)
 */
export function logMemory(checkpoint, metadata = {}) {
  const m = getMemoryUsageMB();
  const metaEntries = Object.entries(metadata)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  const metaSuffix = metaEntries ? ` | ${metaEntries}` : '';
  console.log(
    `[MEMORY] [${checkpoint}] RSS: ${m.rss}MB | Heap: ${m.heapUsed}/${m.heapTotal}MB | Ext: ${m.external}MB | ArrBuf: ${m.arrayBuffers}MB${metaSuffix}`
  );
}

