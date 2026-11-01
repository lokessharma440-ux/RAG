import { splitIntoChunks } from "../RAG/documentProcessor.js";

const text = `
RAG stands for Retrieval-Augmented Generation.
It retrieves relevant information from documents.
The language model uses this context to answer questions.
`;

const chunks = splitIntoChunks(text, 50, 10);

console.log("Total chunks:", chunks.length);
console.log(chunks);
