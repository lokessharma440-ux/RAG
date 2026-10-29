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
    }

    return embeddings;
}

export { getEmbeddingPipeline, generateEmbeddings };