import { generateEmbeddings } from "./embeddingGenerator.js";
import { createVectorStore } from "./vectorStore.js";

async function testVectorStore() {
    const chunks = [
        "RAG retrieves relevant information from documents.",
        "Embeddings convert text into numerical vectors.",
        "Java is a programming language."
    ];

    const embeddings = await generateEmbeddings(chunks);

    const vectorStore = createVectorStore(chunks, embeddings);

    console.log("Total stored items:", vectorStore.length);
    console.log("First stored text:", vectorStore[0].text);
    console.log("First embedding dimensions:", vectorStore[0].embedding.length);
}

testVectorStore().catch((error) => {
    console.error("Error:", error);
});