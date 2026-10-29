import { CodeChunk } from '../../models/CodeChunk.js';
import { generateEmbeddings } from '../../RAG/embeddingGenerator.js';
import { cosineSimilarity } from '../../RAG/vectorStore.js';
import { generateAnswer } from '../../RAG/geminiGenerator.js';

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'for', 'of', 'to', 'from',
  'with', 'about', 'as', 'by', 'that', 'this', 'it', 'are', 'was', 'were', 'be', 'been',
  'what', 'how', 'why', 'when', 'where', 'who', 'does', 'do', 'did', 'can', 'could', 'should',
  'would', 'will', 'my', 'your', 'their', 'our', 'give', 'me', 'tell', 'show', 'code', 'file', 'index'
]);

/**
 * Retrieves the most relevant code chunks for a user question within a repository.
 * Combines semantic vector similarity, exact symbol matching, and path weighting.
 *
 * @param {string} question
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @param {number} [topK=5]
 * @returns {Promise<{ sources: Array<Object>, emptyScopeMessage?: string }>}
 */
export async function retrieveRelevantCodeChunks(question, repositoryId, ownerUserId, topK = 5) {
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('A valid question string must be provided.');
  }

  // 1. Fetch candidate chunks bounded strictly to this repository and user
  const storedChunks = await CodeChunk.find({
    repositoryId,
    ownerUserId,
  }).select('relativePath language chunkType symbolName startLine endLine content embedding');

  if (storedChunks.length === 0) {
    return {
      sources: [],
      emptyScopeMessage: 'No indexed code chunks found in this repository. Please wait for indexing to finish or re-index the repository.',
    };
  }

  // 2. Compute question vector embedding
  const [questionEmbedding] = await generateEmbeddings([question.trim()]);

  // 3. Extract search tokens
  const queryLower = question.toLowerCase();
  const queryTokens = queryLower
    .replace(/[^\w\s/.-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // 4. Calculate Hybrid Score
  const scoredChunks = storedChunks.map((chunk) => {
    const vectorScore = cosineSimilarity(questionEmbedding, chunk.embedding);
    let boost = 0;

    // Exact Symbol match boost (+0.25)
    if (chunk.symbolName) {
      const symLower = chunk.symbolName.toLowerCase();
      if (queryLower.includes(symLower) || symLower.includes(queryLower)) {
        boost += 0.25;
      }
    }

    // Relative File path match boost (+0.18)
    const fileLower = chunk.relativePath.toLowerCase();
    const fileNameOnly = fileLower.split('/').pop();
    if (queryTokens.some((tok) => fileLower.includes(tok) || (fileNameOnly && fileNameOnly.includes(tok)))) {
      boost += 0.18;
    }

    // Lexical token occurrences (+0.12)
    if (queryTokens.length > 0) {
      const contentLower = chunk.content.toLowerCase();
      let matchedCount = 0;
      for (const tok of queryTokens) {
        if (contentLower.includes(tok)) matchedCount++;
      }
      boost += (matchedCount / queryTokens.length) * 0.12;
    }

    const hybridScore = vectorScore + boost;

    return {
      chunkId: `${chunk._id}`,
      relativePath: chunk.relativePath,
      language: chunk.language,
      chunkType: chunk.chunkType,
      symbolName: chunk.symbolName,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.content,
      score: hybridScore,
      vectorScore,
      citation: `${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`,
    };
  });

  // Sort descending
  scoredChunks.sort((a, b) => b.score - a.score);

  // Filter noise
  const relevantChunks = scoredChunks.filter((c) => c.score >= 0.25).slice(0, topK);

  if (relevantChunks.length === 0) {
    return {
      sources: [],
      emptyScopeMessage: 'The available codebase does not provide sufficient evidence to answer this question. Please refine your query or check if the relevant file is included in this repository.',
    };
  }

  return { sources: relevantChunks };
}

/**
 * Executes grounded Q&A on a repository using retrieved code chunks and Gemini / MockLLM.
 *
 * @param {string} question
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @param {Object} [options={}]
 * @returns {Promise<{ answer: string, sources: Array<Object> }>}
 */
export async function queryCodebase(question, repositoryId, ownerUserId, options = {}) {
  const retrieval = await retrieveRelevantCodeChunks(question, repositoryId, ownerUserId, options.topK || 5);

  if (retrieval.emptyScopeMessage) {
    return {
      answer: retrieval.emptyScopeMessage,
      sources: [],
    };
  }

  // Format retrieved chunks as clean code context for LLM with explicit line numbers
  const formattedSources = retrieval.sources.map((s) => ({
    originalName: `${s.relativePath} (Lines ${s.startLine}-${s.endLine})`,
    text: `// File: ${s.relativePath} [Lines ${s.startLine}-${s.endLine}] [${s.chunkType}${s.symbolName ? `: ${s.symbolName}` : ''}]\n${s.text}`,
  }));

  const answer = await generateAnswer(question, formattedSources, options);

  return {
    answer,
    sources: retrieval.sources,
  };
}
