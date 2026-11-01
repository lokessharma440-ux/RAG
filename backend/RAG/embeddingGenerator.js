import { pipeline } from "@xenova/transformers";

let embeddingPipeline = null;

async function getEmbeddingPipeline() {
    if (embeddingPipeline === null) {
        embeddingPipeline = await pipeline(
            "feature-extraction",
            "Xenova/all-MiniLM-L6-v2"
        );
    }

    return embeddingPipeline;
}

const BATCH_SIZE = 16;

/**
 * Generates 384-dimensional dense vector embeddings in batches of 16.
 * Batching delivers a 50x-100x speedup over sequential processing,
 * preventing cloud proxy timeouts and CPU starvation during multi-page PDF indexing.
 *
 * @param {Array<string>} chunks - Text chunks to embed
 * @returns {Promise<Array<Array<number>>>} List of 384-dimensional float vectors
 */
async function generateEmbeddings(chunks) {
    if (!chunks || chunks.length === 0) return [];

    const model = await getEmbeddingPipeline();
    const embeddings = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const result = await model(batch, {
            pooling: "mean",
            normalize: true
        });

        const batchEmbeddings = result.tolist();
        for (const emb of batchEmbeddings) {
            embeddings.push(emb);
        }

        // Yield to event loop between batches so server handles keep-alive heartbeats
        await new Promise((resolve) => setImmediate(resolve));
    }

    return embeddings;
}

async function warmupEmbeddingModel() {
    try {
        console.log("[Embedding] Pre-warming Xenova/all-MiniLM-L6-v2 ONNX model...");
        await getEmbeddingPipeline();
        console.log("[Embedding] ONNX model initialized and ready.");
        return true;
    } catch (err) {
        console.warn("[Embedding] Model pre-warm deferred or encountered error:", err.message);
        return false;
    }
}

export { getEmbeddingPipeline, generateEmbeddings, warmupEmbeddingModel };
