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

// Bounded batch size: 8 is conservative and safe for 512MB RAM on Render Free
const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 8;

/**
 * Generates 384-dimensional dense vector embeddings in controlled batches.
 * Configured with truncate: true and max_length: 512 to prevent token explosion.
 * Releases tensor memory between batches and yields to Node.js event loop.
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

    logMemory("Embedding:BatchStart", {
      batch: `${batchIndex}/${totalBatches}`,
      batchSize: batch.length,
      totalChunks: chunks.length,
    });

    let result = await model(batch, {
      pooling: "mean",
      normalize: true,
      truncate: true,
      max_length: 512,
    });

    const batchEmbeddings = result.tolist();
    for (const emb of batchEmbeddings) {
      embeddings.push(emb);
    }

    // Release tensor reference immediately
    result = null;

    logMemory("Embedding:BatchDone", {
      batch: `${batchIndex}/${totalBatches}`,
    });

    // Yield to event loop between batches so server handles keep-alive heartbeats and GC
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
