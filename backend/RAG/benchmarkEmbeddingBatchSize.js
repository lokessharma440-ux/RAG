import { pipeline } from '@xenova/transformers';
import { performance } from 'perf_hooks';
import { getMemoryUsageMB } from '../utils/memoryDiagnostics.js';

// Sample 50 realistic code chunks representing various code constructs
const sampleChunks = [
  'export async function authenticateUser(req, res, next) { const token = req.cookies.token; if (!token) return res.status(401).json({ message: "Unauthorized" }); }',
  'class DatabaseConnectionPool { constructor(config) { this.pool = []; this.max = config.max || 10; } async acquire() { return this.pool.pop(); } }',
  'router.post("/api/codebases/github", rateLimiter, async (req, res) => { const { url, branch } = req.body; const result = await indexRepo(url, branch); res.json(result); });',
  'function computeCosineSimilarity(a, b) { let dot = 0, normA = 0, normB = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i]**2; normB += b[i]**2; } return dot / (Math.sqrt(normA) * Math.sqrt(normB)); }',
  'export const AST_NODE_TYPES = { FunctionDeclaration: "Function", ClassDeclaration: "Class", MethodDefinition: "Method", ArrowFunction: "Arrow" };',
];

// Replicate to 50 chunks
const testChunks = [];
for (let i = 0; i < 50; i++) {
  testChunks.push(`// Chunk #${i + 1} relative/path/file_${i % 10}.js\n${sampleChunks[i % sampleChunks.length]}\n// Line count: ${i * 12}`);
}

async function runBenchmark() {
  console.log('====================================================');
  console.log('   EMBEDDING BATCH SIZE BENCHMARK (50 CHUNKS)       ');
  console.log('====================================================\n');

  console.log('Loading Xenova/all-MiniLM-L6-v2 ONNX model...');
  const initStart = performance.now();
  const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const initDuration = (performance.now() - initStart).toFixed(0);
  console.log(`Model initialized in ${initDuration}ms.\n`);

  const batchSizes = [1, 2, 4, 8];
  const results = [];

  for (const bs of batchSizes) {
    const memBefore = getMemoryUsageMB();
    const start = performance.now();

    const embeddings = [];
    for (let i = 0; i < testChunks.length; i += bs) {
      const batch = testChunks.slice(i, i + bs).map((s) => s.slice(0, 1500));
      const res = await model(batch, {
        pooling: 'mean',
        normalize: true,
        truncate: true,
        max_length: 192,
      });
      const list = res.tolist();
      embeddings.push(...list);
    }

    const duration = performance.now() - start;
    const memAfter = getMemoryUsageMB();
    const chunksPerSec = (testChunks.length / (duration / 1000)).toFixed(1);

    // Verify output dimension
    const validDims = embeddings.every((e) => Array.isArray(e) && e.length === 384);

    results.push({
      batchSize: bs,
      durationMs: duration.toFixed(1),
      chunksPerSec,
      validDims,
      rssMB: memAfter.rss,
      heapUsedMB: memAfter.heapUsed,
    });

    console.log(
      `Batch Size ${bs}: ${duration.toFixed(0)}ms | ${chunksPerSec} chunks/s | RSS: ${memAfter.rss}MB | Heap: ${memAfter.heapUsed}MB | 384-d: ${validDims}`
    );

    // Allow GC / event loop settle between test runs
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log('\n--- Summary Table ---');
  console.table(results);
}

runBenchmark().catch(console.error);

