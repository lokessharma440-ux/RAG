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

async function generateEmbeddings(chunks) {
    const model = await getEmbeddingPipeline();

    const embeddings = [];

    for (const chunk of chunks) {
        const result = await model(chunk, {
            pooling: "mean",
            normalize: true
        });

        const embedding = result.tolist()[0];

        embeddings.push(embedding);

        // Yield to event loop to keep connection alive and allow heartbeat on slow single-core servers
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
