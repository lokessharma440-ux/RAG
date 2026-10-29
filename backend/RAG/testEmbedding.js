import { generateEmbeddings } from "./embeddingGenerator.js";

async function testEmbedding() {
    const chunks = [
        "RAG retrieves relevant information from documents.",
        "Embeddings convert text into numerical vectors.",
        "Java is a programming language."
    ];

    console.log("Generating embeddings...");

    const embeddings = await generateEmbeddings(chunks);

    console.log("Total chunks:", chunks.length);
    console.log("Total embeddings:", embeddings.length);
    console.log("First embedding dimensions:", embeddings[0].length);
    console.log("First embedding values:", embeddings[0].slice(0, 5));
}

testEmbedding().catch((error) => {
    console.error("Error:", error);
});