function createVectorStore(chunks, embeddings) {
    if (chunks.length !== embeddings.length) {
        throw new Error("Chunks and embeddings count do not match");
    }

    const vectorStore = [];

    for (let i = 0; i < chunks.length; i++) {
        vectorStore.push({
            text: chunks[i],
            embedding: embeddings[i]
        });
    }

    return vectorStore;
}
function cosineSimilarity(vectorA, vectorB) {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];

        magnitudeA += vectorA[i] * vectorA[i];

        magnitudeB += vectorB[i] * vectorB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
}
import { generateEmbeddings } from "./embeddingGenerator.js";

async function searchSimilarChunks(question, vectorStore, topK = 2) {
    const questionEmbeddings = await generateEmbeddings([question]);

    const questionEmbedding = questionEmbeddings[0];

    const results = vectorStore.map((item) => {
        const score = cosineSimilarity(
            questionEmbedding,
            item.embedding
        );

        return {
            text: item.text,
            score: score
        };
    });

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
}

export { createVectorStore,cosineSimilarity ,searchSimilarChunks};