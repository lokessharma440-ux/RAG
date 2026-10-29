import { generateEmbeddings } from "./embeddingGenerator.js";
import { createVectorStore } from "./vectorStore.js";
import { runRAGPipeline } from "./ragPipeline.js";

async function testGeminiRAG() {
    console.log("====================================================");
    console.log("   Testing Integrated Gemini RAG Chatbot Pipeline   ");
    console.log("====================================================\n");

    const chunks = [
        "Retrieval-Augmented Generation (RAG) retrieves relevant information from external document collections using vector embeddings before sending context to a language model.",
        "Embeddings convert text strings into dense numerical vectors that capture deep semantic relationships.",
        "A vector store indexes document chunks and uses cosine similarity to rank relevance against user question embeddings.",
        "Gemini generates accurate, grounded answers by conditioning its responses on retrieved document excerpts rather than relying solely on internal weights.",
        "Python and JavaScript are widely used programming languages for modern web and AI applications."
    ];

    console.log("Step 1: Generating embeddings for sample chunks...");
    const embeddings = await generateEmbeddings(chunks);
    console.log(`✓ Created ${embeddings.length} embeddings (${embeddings[0].length} dimensions each).`);

    console.log("\nStep 2: Building vector store...");
    const vectorStore = createVectorStore(chunks, embeddings);
    console.log(`✓ Vector store indexed with ${vectorStore.length} items.`);

    const question = "How does RAG retrieve information?";
    console.log(`\nStep 3: Executing RAG pipeline for question:\n"${question}"...`);

    const result = await runRAGPipeline(question, vectorStore, { topK: 2 });

    console.log("\n================ Retreived Sources ================");
    result.sources.forEach((source, index) => {
        console.log(`\n[Source ${index + 1}] (Similarity Score: ${source.score.toFixed(4)})`);
        console.log(`Text: ${source.text}`);
    });

    console.log("\n================ Generated Answer =================");
    console.log(result.answer);
    console.log("\n====================================================");
    console.log("✓ Pipeline execution completed successfully!");
}

testGeminiRAG().catch((error) => {
    console.error("\n❌ Pipeline test execution failed:");
    console.error(error.message);
});
