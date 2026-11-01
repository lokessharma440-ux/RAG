import { searchSimilarChunks } from "./vectorStore.js";
import { generateAnswer } from "./geminiGenerator.js";

/**
 * Executes the complete RAG (Retrieval-Augmented Generation) pipeline:
 * 1. Validates the question and vector store input.
 * 2. Uses the existing vector store search to retrieve top relevant chunks.
 * 3. Sends the question and retrieved chunks to Gemini for grounded answer generation.
 * 4. Returns the synthesized answer along with the retrieved source chunks and similarity scores.
 *
 * @param {string} question - The user's query.
 * @param {Array<{ text: string, embedding: number[] }>} vectorStore - The vector store array.
 * @param {Object} [options={}] - Optional configuration (e.g. topK, model, temperature).
 * @returns {Promise<{ answer: string, sources: Array<{ text: string, score: number }> }>}
 */
async function runRAGPipeline(question, vectorStore, options = {}) {
    if (!question || typeof question !== "string" || !question.trim()) {
        throw new Error("A valid question string must be provided.");
    }

    if (!Array.isArray(vectorStore) || vectorStore.length === 0) {
        throw new Error("Vector store must be a non-empty array of chunk embeddings.");
    }

    const topK = options.topK ?? 2;

    // 1. Retrieve top relevant chunks using the existing semantic search function
    const sources = await searchSimilarChunks(question, vectorStore, topK);

    // 2. Send the question and retrieved chunks to Gemini
    const answer = await generateAnswer(question, sources, options);

    // 3. Return structured result (sources are retrieved chunks from current collection, not verified citations)
    return {
        answer,
        sources: sources.map((item) => ({
            text: item.text,
            score: item.score
        }))
    };
}

export { runRAGPipeline };
