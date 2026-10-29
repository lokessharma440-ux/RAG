import { cosineSimilarity } from "./vectorStore.js";

const vectorA = [1, 0, 1];
const vectorB = [1, 0, 1];
const vectorC = [0, 1, 0];

console.log(
    "Similarity A and B:",
    cosineSimilarity(vectorA, vectorB)
);

console.log(
    "Similarity A and C:",
    cosineSimilarity(vectorA, vectorC)
);