import { generateEmbeddings } from "./embeddingGenerator.js";

import {
    createVectorStore,
    searchSimilarChunks
} from "./vectorStore.js";

async function testSearch() {
    const chunks = [
        "RAG retrieves relevant information from documents.",
        "Embeddings convert text into numerical vectors.",
        "Java is a programming language.",
        "Cosine similarity compares the direction of two vectors."
    ];

    console.log("Creating embeddings...");

    const embeddings = await generateEmbeddings(chunks);

    const vectorStore = createVectorStore(chunks, embeddings);

    const question = "How does RAG find information?";

    console.log("\nUser question:", question);

    const results = await searchSimilarChunks(
        question,
        vectorStore,
        2
    );

    console.log("\nMost relevant chunks:");

    results.forEach((result, index) => {
        console.log(`\nResult ${index + 1}:`);
        console.log("Text:", result.text);
        console.log("Similarity:", result.score.toFixed(4));
    });
}

testSearch().catch((error) => {
    console.error("Search error:", error);
});