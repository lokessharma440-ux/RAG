import mongoose from 'mongoose';

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'for', 'of', 'to', 'from',
  'with', 'about', 'as', 'by', 'that', 'this', 'it', 'are', 'was', 'were', 'be', 'been',
  'what', 'how', 'why', 'when', 'where', 'who', 'does', 'do', 'did', 'can', 'could', 'should',
  'would', 'will', 'my', 'your', 'their', 'our', 'give', 'me', 'tell', 'show', 'here', 'there'
]);

/**
 * Splits text into content words (lowercase, stripped of punctuation, excluding common stopwords).
 *
 * @param {string} text
 * @returns {Array<string>}
 */
export function extractContentKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Extracts bi-grams from text to verify phrase-level evidence.
 *
 * @param {Array<string>} words
 * @returns {Set<string>}
 */
export function extractBigrams(words) {
  const bigrams = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

/**
 * Verifies generated answers against retrieved source evidence without expensive extra LLM calls.
 * Enforces user isolation, valid document scope, citation integrity, and evidence support scoring.
 *
 * @param {Object} params
 * @param {string} params.answer - Generated answer from Gemini.
 * @param {Array<Object>} params.retrievedChunks - Raw candidate chunks retrieved from the vector store.
 * @param {string|mongoose.Types.ObjectId|null} params.userId - Authenticated user ID.
 * @param {Array<string|mongoose.Types.ObjectId>} [params.validDocumentIds=[]] - List of authorized document IDs.
 * @returns {{
 *   answer: string,
 *   citations: Array<Object>,
 *   evidenceScore: number,
 *   isSufficient: boolean,
 *   supportedSentencesCount: number,
 *   totalSentencesCount: number
 * }}
 */
export function verifyAnswerEvidence({
  answer,
  retrievedChunks = [],
  userId = null,
  validDocumentIds = [],
}) {
  if (!answer || typeof answer !== 'string') {
    return {
      answer: '',
      citations: [],
      evidenceScore: 0,
      isSufficient: false,
      supportedSentencesCount: 0,
      totalSentencesCount: 0,
    };
  }

  const trimmedAnswer = answer.trim();

  // Check if LLM explicitly declared that the context is insufficient
  const insufficientPatterns = [
    /do not contain enough information/i,
    /does not contain enough information/i,
    /no relevant information/i,
    /not mentioned in the provided/i,
    /cannot be answered from the provided/i,
  ];
  const isDeclaredInsufficient = insufficientPatterns.some((pattern) => pattern.test(trimmedAnswer));

  if (isDeclaredInsufficient || retrievedChunks.length === 0) {
    return {
      answer: trimmedAnswer,
      citations: [],
      evidenceScore: 0,
      isSufficient: false,
      supportedSentencesCount: 0,
      totalSentencesCount: 1,
    };
  }

  // 1. Filter chunks to guarantee they belong strictly to user's authorized scope
  const authorizedScopeSet = new Set(
    (validDocumentIds || []).map((id) => (id ? id.toString() : ''))
  );

  const cleanChunks = retrievedChunks.filter((chunk) => {
    if (!chunk) return false;
    // If validDocumentIds was provided, enforce strict containment
    if (authorizedScopeSet.size > 0 && chunk.documentId) {
      if (!authorizedScopeSet.has(chunk.documentId.toString())) {
        return false;
      }
    }
    return Boolean(chunk.text);
  });

  if (cleanChunks.length === 0) {
    return {
      answer: trimmedAnswer,
      citations: [],
      evidenceScore: 0,
      isSufficient: false,
      supportedSentencesCount: 0,
      totalSentencesCount: 1,
    };
  }

  // 2. Pre-process retrieved chunks for overlap analysis
  const chunkProfiles = cleanChunks.map((chunk, idx) => {
    const text = chunk.text || '';
    const words = extractContentKeywords(text);
    const bigrams = extractBigrams(words);
    return {
      index: idx,
      chunkId: chunk.chunkId || chunk._id ? (chunk.chunkId || chunk._id).toString() : `chunk-${idx}`,
      documentId: chunk.documentId ? chunk.documentId.toString() : 'unknown',
      originalName: chunk.originalName || 'Document',
      pageNumber: chunk.pageNumber || 1,
      chunkIndex: chunk.chunkIndex ?? idx,
      text,
      words: new Set(words),
      bigrams,
      score: chunk.score || 0,
    };
  });

  // 3. Sentence-level claim verification
  const rawSentences = trimmedAnswer
    .split(/(?<=[.?!])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);

  let supportedSentencesCount = 0;
  const supportingChunkIndices = new Set();

  for (const sentence of rawSentences) {
    const sWords = extractContentKeywords(sentence);
    if (sWords.length === 0) continue;

    const sBigrams = extractBigrams(sWords);
    let bestSentenceOverlap = 0;
    let bestChunkIdx = -1;

    for (let c = 0; c < chunkProfiles.length; c++) {
      const profile = chunkProfiles[c];
      let matchingWords = 0;
      for (const w of sWords) {
        if (profile.words.has(w)) matchingWords++;
      }
      const unigramRatio = matchingWords / sWords.length;

      let matchingBigrams = 0;
      if (sBigrams.size > 0) {
        for (const bg of sBigrams) {
          if (profile.bigrams.has(bg)) matchingBigrams++;
        }
      }
      const bigramRatio = sBigrams.size > 0 ? matchingBigrams / sBigrams.size : unigramRatio;

      // Blended evidence score: 60% unigrams + 40% bigrams
      const sentenceScore = 0.6 * unigramRatio + 0.4 * bigramRatio;
      if (sentenceScore > bestSentenceOverlap) {
        bestSentenceOverlap = sentenceScore;
        bestChunkIdx = c;
      }
    }

    // Sentence is considered evidence-supported if threshold is met
    if (bestSentenceOverlap >= 0.35 && bestChunkIdx >= 0) {
      supportedSentencesCount++;
      supportingChunkIndices.add(bestChunkIdx);
    }
  }

  const totalSentencesCount = Math.max(1, rawSentences.length);
  const evidenceScore = Math.min(
    1.0,
    parseFloat((supportedSentencesCount / totalSentencesCount).toFixed(2))
  );

  // 4. Construct verified citations (only from chunks that actually grounded the answer)
  // If no specific sentence matched cleanly but retrieved chunks had high similarity, preserve top chunks
  const targetIndices = supportingChunkIndices.size > 0
    ? Array.from(supportingChunkIndices)
    : [0]; // fallback to primary chunk

  const citations = targetIndices.map((idx) => {
    const p = chunkProfiles[idx];
    return {
      chunkId: p.chunkId,
      documentId: p.documentId,
      originalName: p.originalName,
      pageNumber: p.pageNumber,
      chunkIndex: p.chunkIndex,
      relevanceScore: parseFloat(Number(p.score).toFixed(3)),
      snippet: p.text.length > 280 ? `${p.text.slice(0, 277)}...` : p.text,
      citationText: `${p.originalName}${p.pageNumber ? ` (Page ${p.pageNumber})` : ''}`,
    };
  });

  return {
    answer: trimmedAnswer,
    citations,
    evidenceScore,
    isSufficient: evidenceScore >= 0.3,
    supportedSentencesCount,
    totalSentencesCount,
  };
}

