/**
 * Phase D2: Retrieval Evaluation Engine
 *
 * Implements deterministic standard Information Retrieval (IR) metrics:
 * 1. Precision@K: Fraction of top-K retrieved chunks that are relevant.
 * 2. Recall@K: Fraction of total relevant chunks successfully retrieved in top-K.
 * 3. Mean Reciprocal Rank (MRR): Average of reciprocal ranks of the first relevant chunk.
 * 4. Hit Rate@K (Success Rate): Fraction of queries where at least one relevant chunk was retrieved.
 *
 * Mathematical Definitions:
 * - Precision@K = |Retrieved@K ∩ Relevant| / K
 * - Recall@K = |Retrieved@K ∩ Relevant| / |Relevant|
 * - Reciprocal Rank = 1 / rank_of_first_relevant_chunk (0 if none found in top K)
 * - Hit Rate@K = (1 if |Retrieved@K ∩ Relevant| > 0 else 0)
 */

/**
 * Pure Mathematical IR Metric Helpers
 */
export function calculatePrecisionAtK(retrievedItems = [], relevantItems = [], k = 3) {
  if (!k || k <= 0 || !retrievedItems || retrievedItems.length === 0) return 0.0;
  const topK = retrievedItems.slice(0, k);
  const relevantSet = new Set(relevantItems);
  const hitCount = topK.filter((item) => relevantSet.has(item)).length;
  return hitCount / topK.length;
}

export function calculateRecallAtK(retrievedItems = [], relevantItems = [], k = 3) {
  if (!relevantItems || relevantItems.length === 0) return 1.0; // Unanswerable query
  if (!retrievedItems || retrievedItems.length === 0 || !k || k <= 0) return 0.0;
  const topK = retrievedItems.slice(0, k);
  const relevantSet = new Set(relevantItems);
  const hitCount = topK.filter((item) => relevantSet.has(item)).length;
  return hitCount / relevantItems.length;
}

export function calculateMRR(retrievedItems = [], relevantItems = []) {
  if (!relevantItems || relevantItems.length === 0) {
    return (!retrievedItems || retrievedItems.length === 0) ? 1.0 : 0.0;
  }
  const relevantSet = new Set(relevantItems);
  for (let i = 0; i < retrievedItems.length; i++) {
    if (relevantSet.has(retrievedItems[i])) {
      return 1 / (i + 1);
    }
  }
  return 0.0;
}

export function calculateHitRateAtK(retrievedItems = [], relevantItems = [], k = 3) {
  if (!relevantItems || relevantItems.length === 0) return 1.0;
  if (!retrievedItems || retrievedItems.length === 0 || !k || k <= 0) return 0.0;
  const topK = retrievedItems.slice(0, k);
  const relevantSet = new Set(relevantItems);
  return topK.some((item) => relevantSet.has(item)) ? 1.0 : 0.0;
}

/**
 * Checks whether a candidate chunk is relevant to an evaluation item.
 *
 * @param {Object} chunk - { text, chunkIndex, originalName, documentId }
 * @param {Object} evalItem - Evaluation test case
 * @returns {boolean}
 */
export function isChunkRelevant(chunk, evalItem) {
  if (!evalItem || !evalItem.isAnswerable) {
    return false;
  }

  // 1. If evaluation specifies relevant doc names, enforce matching document
  if (evalItem.relevantDocName && chunk.originalName && chunk.originalName !== evalItem.relevantDocName) {
    return false;
  }
  if (Array.isArray(evalItem.relevantDocNames) && chunk.originalName) {
    if (!evalItem.relevantDocNames.includes(chunk.originalName)) {
      return false;
    }
  }

  const chunkTextLower = (chunk.text || '').toLowerCase();

  // 2. Check exact expected passage(s) if provided
  const candidatePassages = Array.isArray(evalItem.expectedPassages)
    ? evalItem.expectedPassages
    : evalItem.expectedPassage
    ? [evalItem.expectedPassage]
    : [];

  for (const passage of candidatePassages) {
    const passageLower = (passage || '').toLowerCase();
    if (!passageLower) continue;

    if (chunkTextLower.includes(passageLower)) {
      return true;
    }

    // Keyword overlap matching (if >= 65% of distinctive passage words appear in chunk)
    const passageWords = passageLower
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (passageWords.length > 0) {
      const matchCount = passageWords.filter((w) => chunkTextLower.includes(w)).length;
      if (matchCount / passageWords.length >= 0.65) {
        return true;
      }
    }
  }

  // 3. Check section indices if specified
  const targetIndices = [];
  if (typeof evalItem.relevantSectionIndex === 'number') {
    targetIndices.push(evalItem.relevantSectionIndex);
  }
  if (Array.isArray(evalItem.relevantSectionIndices)) {
    targetIndices.push(...evalItem.relevantSectionIndices);
  }

  if (targetIndices.length > 0 && typeof chunk.chunkIndex === 'number') {
    if (targetIndices.includes(chunk.chunkIndex)) {
      return true;
    }
  }

  return false;
}

/**
 * Computes IR metrics for a single query.
 *
 * @param {Array<Object>} retrievedChunks - Top-K chunks returned by retrieval.
 * @param {Object} evalItem - Evaluation test case.
 * @param {number} k - Top K threshold.
 * @returns {Object} { precision, recall, reciprocalRank, hit, isAnswerable, ... }
 */
export function evaluateQueryRetrieval(retrievedChunks, evalItem, k = 3) {
  // Deduplicate retrieved chunks to ensure consistent metric denominators
  const seenKeys = new Set();
  const dedupedChunks = [];
  for (const c of retrievedChunks || []) {
    const key = `${c.originalName || c.documentId || ''}:${c.chunkIndex ?? ''}:${(c.text || '').slice(0, 30)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      dedupedChunks.push(c);
    }
  }

  const topKChunks = dedupedChunks.slice(0, k);

  if (!evalItem.isAnswerable) {
    return {
      precision: null, // Undefined for unanswerable questions (zero relevant chunks exist)
      recall: null,    // Undefined (denominator |Relevant| = 0)
      reciprocalRank: 0,
      hit: 0,
      isAnswerable: false,
      retrievedCount: topKChunks.length,
      retrievedRelevantCount: 0,
      expectedRelevantCount: 0,
      falsePositiveRetrieval: topKChunks.length > 0 ? 1 : 0,
    };
  }

  let relevantCount = 1;
  if (Array.isArray(evalItem.relevantSectionIndices)) {
    relevantCount = evalItem.relevantSectionIndices.length;
  } else if (Array.isArray(evalItem.relevantDocNames)) {
    relevantCount = evalItem.relevantDocNames.length;
  }

  let retrievedRelevantCount = 0;
  let firstRelevantRank = 0;

  topKChunks.forEach((chunk, index) => {
    const relevant = isChunkRelevant(chunk, evalItem);
    if (relevant) {
      retrievedRelevantCount++;
      if (firstRelevantRank === 0) {
        firstRelevantRank = index + 1; // 1-based rank
      }
    }
  });

  const precision = topKChunks.length > 0 ? retrievedRelevantCount / topKChunks.length : 0;
  const recall = relevantCount > 0 ? Math.min(1.0, retrievedRelevantCount / relevantCount) : 0;
  const reciprocalRank = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;
  const hit = retrievedRelevantCount > 0 ? 1 : 0;

  return {
    precision,
    recall,
    reciprocalRank,
    firstRelevantRank,
    hit,
    isAnswerable: true,
    retrievedCount: topKChunks.length,
    retrievedRelevantCount,
    expectedRelevantCount: relevantCount,
    falsePositiveRetrieval: 0,
  };
}

/**
 * Evaluates an entire dataset over a retrieval function.
 *
 * @param {Array<Object>} dataset - Array of evaluation items.
 * @param {Function} retrievalFn - Async function (query, k) => Promise<Array<chunk>>
 * @param {number} [k=3]
 * @returns {Promise<Object>} Aggregated metrics, per-category breakdown, and per-item results.
 */
export async function evaluateRetrievalDataset(dataset, retrievalFn, k = 3) {
  const results = [];
  const categoryStats = {};

  let totalPrecision = 0;
  let totalRecall = 0;
  let totalRR = 0;
  let totalHits = 0;
  let answerableCount = 0;
  let unanswerableCount = 0;
  let falsePositiveRetrievals = 0;

  for (const item of dataset) {
    const category = item.category || 'general';
    if (!categoryStats[category]) {
      categoryStats[category] = {
        total: 0,
        answerable: 0,
        unanswerable: 0,
        precisionSum: 0,
        recallSum: 0,
        rrSum: 0,
        hitsSum: 0,
      };
    }
    const cat = categoryStats[category];
    cat.total++;

    const retrievedChunks = await retrievalFn(item.question, k);
    const metrics = evaluateQueryRetrieval(retrievedChunks, item, k);

    results.push({
      id: item.id,
      category: item.category,
      question: item.question,
      isAnswerable: item.isAnswerable,
      metrics,
      retrievedChunks: (retrievedChunks || []).slice(0, k).map((c) => ({
        chunkIndex: c.chunkIndex,
        originalName: c.originalName,
        score: c.score,
        snippet: (c.text || '').slice(0, 120),
      })),
    });

    if (item.isAnswerable) {
      totalPrecision += metrics.precision || 0;
      totalRecall += metrics.recall || 0;
      totalRR += metrics.reciprocalRank || 0;
      totalHits += metrics.hit || 0;
      answerableCount++;

      cat.answerable++;
      cat.precisionSum += metrics.precision || 0;
      cat.recallSum += metrics.recall || 0;
      cat.rrSum += metrics.reciprocalRank || 0;
      cat.hitsSum += metrics.hit || 0;
    } else {
      unanswerableCount++;
      cat.unanswerable++;
      if (metrics.falsePositiveRetrieval) {
        falsePositiveRetrievals++;
      }
    }
  }

  const meanPrecision = answerableCount > 0 ? totalPrecision / answerableCount : 0;
  const meanRecall = answerableCount > 0 ? totalRecall / answerableCount : 0;
  const mrr = answerableCount > 0 ? totalRR / answerableCount : 0;
  const hitRate = answerableCount > 0 ? totalHits / answerableCount : 0;

  // Compile per-category metrics
  const categoryBreakdown = {};
  for (const [catName, stats] of Object.entries(categoryStats)) {
    categoryBreakdown[catName] = {
      totalQueries: stats.total,
      answerableQueries: stats.answerable,
      unanswerableQueries: stats.unanswerable,
      precisionAtK: stats.answerable > 0 ? Number((stats.precisionSum / stats.answerable).toFixed(4)) : null,
      recallAtK: stats.answerable > 0 ? Number((stats.recallSum / stats.answerable).toFixed(4)) : null,
      mrr: stats.answerable > 0 ? Number((stats.rrSum / stats.answerable).toFixed(4)) : 0,
      hitRateAtK: stats.answerable > 0 ? Number((stats.hitsSum / stats.answerable).toFixed(4)) : 0,
    };
  }

  return {
    k,
    totalQueries: dataset.length,
    answerableQueries: answerableCount,
    unanswerableQueries: unanswerableCount,
    metrics: {
      precisionAtK: Number(meanPrecision.toFixed(4)),
      recallAtK: Number(meanRecall.toFixed(4)),
      mrr: Number(mrr.toFixed(4)),
      hitRateAtK: Number(hitRate.toFixed(4)),
      falsePositiveRetrievalRate: unanswerableCount > 0 ? Number((falsePositiveRetrievals / unanswerableCount).toFixed(4)) : 0,
    },
    categoryBreakdown,
    results,
  };
}
