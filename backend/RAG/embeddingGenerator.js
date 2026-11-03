import { pipeline } from "@xenova/transformers";
import { logMemory } from "../utils/memoryDiagnostics.js";

let embeddingPipeline = null;
let initializationPromise = null;

/**
 * Returns the shared singleton ONNX embedding pipeline.
 * Uses an in-flight promise to strictly prevent race conditions where concurrent
 * requests trigger duplicate model instantiations in memory.
 *
 * @returns {Promise<Function>} Xenova feature-extraction pipeline
 */
async function getEmbeddingPipeline() {
  if (embeddingPipeline !== null) {
    return embeddingPipeline;
  }

  if (initializationPromise !== null) {
    return initializationPromise;
  }

  logMemory("ONNX:InitStart", { model: "all-MiniLM-L6-v2" });

  initializationPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
    .then((pipe) => {
      embeddingPipeline = pipe;
      initializationPromise = null;
      logMemory("ONNX:InitComplete", { dimensions: 384 });
      return embeddingPipeline;
    })
    .catch((err) => {
      initializationPromise = null;
      logMemory("ONNX:InitFailed", { error: err.message });
      throw err;
    });

  return initializationPromise;
}

// Bounded batch size: 4 is fast and stays well within the 512MB RAM ceiling on Render Free
const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 4;

/**
 * Generates 384-dimensional dense vector embeddings in controlled batches.
 * Configured with truncate: true and max_length: 192 to balance high semantic accuracy and low latency.
 * Periodically invokes GC and yields to the Node.js event loop without blocking CPU.
 *
 * @param {Array<string>} chunks - Text chunks to embed
 * @returns {Promise<Array<Array<number>>>} List of 384-dimensional float vectors
 */
async function generateEmbeddings(chunks) {
  if (!chunks || chunks.length === 0) return [];

  const model = await getEmbeddingPipeline();
  const embeddings = [];
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const batch = chunks.slice(i, i + BATCH_SIZE);

    // Sanitize input chunks: stringify and clamp character length to 1500 to prevent tokenizer blowout
    const sanitizedBatch = batch.map((item) =>
      typeof item === "string" ? item.slice(0, 1500) : String(item || "").slice(0, 1500)
    );

    let result = await model(sanitizedBatch, {
      pooling: "mean",
      normalize: true,
      truncate: true,
      max_length: 192,
    });

    const batchEmbeddings = result.tolist();
    for (const emb of batchEmbeddings) {
      embeddings.push(emb);
    }

    // Release tensor reference immediately
    result = null;

    // Periodically hint GC every 8 batches (~32 chunks) rather than every micro-batch
    if (global.gc && batchIndex % 8 === 0) {
      global.gc();
    }

    // Yield to event loop to allow heartbeats and I/O to process
    await new Promise((resolve) => setImmediate(resolve));
  }

  return embeddings;
}

async function warmupEmbeddingModel() {
  try {
    logMemory("Embedding:WarmupStart");
    await getEmbeddingPipeline();
    logMemory("Embedding:WarmupDone");
    return true;
  } catch (err) {
    console.warn("[Embedding] Model pre-warm deferred or encountered error:", err.message);
    return false;
  }
}

export { getEmbeddingPipeline, generateEmbeddings, warmupEmbeddingModel, BATCH_SIZE };
