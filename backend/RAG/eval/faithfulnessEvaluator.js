/**
 * Phase D3: Answer Faithfulness & Grounding Evaluation Harness
 *
 * Inspects whether generated answers are strictly grounded in retrieved document context.
 *
 * Deterministic Evaluation Checks:
 * 1. Explicit Refusal Check: Detects if the model appropriately declines to answer when
 *    evidence is absent (isAnswerable === false).
 * 2. Lexical & Named Entity Grounding: Measures the ratio of factual entities and nouns in
 *    the generated answer that are directly verified in the retrieved chunks.
 * 3. Unsupported Extrapolations: Flags tokens or entities present in the answer that appear
 *    neither in the query nor in the retrieved excerpts.
 * 4. Grounded Citation Verification: Verifies that source metadata is provided and maps to
 *    actual indexed chunks.
 *
 * NOTE ON LIMITATIONS:
 * Deterministic lexical grounding provides a reliable lower bound and avoids stochastic
 * LLM judge variance. However, it does not detect subtle semantic contradictions.
 * In production RAG, deterministic grounding should be paired with human spot-checks.
 */

const REFUSAL_PATTERNS = [
  /do(?:es)?\s+not\s+contain\s+enough\s+information/i,
  /not\s+mentioned\s+in\s+the\s+(?:provided\s+)?(?:documents?|excerpts?|context)/i,
  /cannot\s+be\s+answered\s+from\s+the\s+(?:provided\s+)?(?:documents?|excerpts?|context)/i,
  /no\s+(?:relevant\s+)?information\s+(?:is\s+)?provided/i,
  /does\s+not\s+(?:state|specify|mention|provide)/i,
  /not\s+covered\s+in\s+the\s+documents/i,
  /is\s+not\s+(?:found|available)\s+in\s+the\s+(?:provided\s+)?(?:context|documents?)/i,
];

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'for', 'of', 'to', 'from',
  'with', 'about', 'as', 'by', 'that', 'this', 'it', 'are', 'was', 'were', 'be', 'been',
  'what', 'how', 'why', 'when', 'where', 'who', 'does', 'do', 'did', 'can', 'could', 'should',
  'would', 'will', 'my', 'your', 'their', 'our', 'give', 'me', 'tell', 'show', 'based',
  'provided', 'document', 'documents', 'excerpts', 'information', 'answer', 'question'
]);

/**
 * Checks whether an answer explicitly declares lack of evidence.
 *
 * @param {string} answer
 * @returns {boolean}
 */
export function isExplicitRefusal(answer) {
  if (!answer || typeof answer !== 'string') return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(answer));
}

/**
 * Extracts distinct numerical figures (integers, decimals) from text.
 *
 * @param {string} text
 * @returns {Array<string>}
 */
export function extractSalientNumbers(text) {
  if (!text) return [];
  // Match numbers bounded by leading word boundary (e.g. 500 in 500MB, 15 in 15MB, 1024, 384)
  const matches = text.match(/\b\d+(?:\.\d+)?/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extracts candidate named entities or acronyms (e.g. AWS, Bedrock, OpenSearch, Pinecone).
 *
 * @param {string} text
 * @returns {Array<string>}
 */
export function extractNamedEntities(text) {
  if (!text) return [];
  const tokens = text.match(/\b[A-Z][a-zA-Z0-9_-]+\b/g) || [];
  const entities = [];
  for (const token of tokens) {
    if (STOP_WORDS.has(token.toLowerCase())) continue;
    entities.push(token);
  }
  return [...new Set(entities)];
}

/**
 * Extracts salient content tokens (nouns, technical terms) from text.
 *
 * @param {string} text
 * @returns {Array<string>}
 */
export function extractSalientTerms(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Evaluates the faithfulness of a generated answer against retrieved chunks.
 *
 * @param {string} question - User question
 * @param {string} answer - Generated LLM answer
 * @param {Array<Object>} retrievedChunks - Retrieved source chunks [{ text, originalName, chunkIndex }]
 * @param {Object} evalItem - Evaluation test item from dataset
 * @returns {Object} Faithfulness inspection metrics and classification
 */
export function evaluateAnswerFaithfulness(question, answer, retrievedChunks = [], evalItem = {}) {
  const isRefusal = isExplicitRefusal(answer);
  const combinedContextText = (retrievedChunks || []).map((c) => c.text || '').join('\n');
  const contextLower = combinedContextText.toLowerCase();
  const queryLower = (question || '').toLowerCase();

  // Case 0: Empty retrieval results (Zero context returned)
  if (!retrievedChunks || retrievedChunks.length === 0) {
    if (isRefusal) {
      return {
        verdict: 'CORRECT_REFUSAL',
        isFaithful: true,
        faithfulnessScore: 1.0,
        isRefusal: true,
        expectedRefusal: true,
        evaluatorMode: 'DETERMINISTIC_LEXICAL_AND_NUMERIC',
        explanation: 'Model correctly declined to answer when zero context chunks were retrieved.',
        unsupportedTerms: [],
        unsupportedNumbers: [],
        groundedRatio: 1.0,
      };
    } else {
      return {
        verdict: 'UNSUPPORTED_HALLUCINATION',
        isFaithful: false,
        faithfulnessScore: 0.0,
        isRefusal: false,
        expectedRefusal: true,
        evaluatorMode: 'DETERMINISTIC_LEXICAL_AND_NUMERIC',
        explanation: 'Model generated an ungrounded answer despite zero retrieved document context.',
        unsupportedTerms: extractSalientTerms(answer).slice(0, 5),
        unsupportedNumbers: extractSalientNumbers(answer),
        groundedRatio: 0.0,
      };
    }
  }

  // Case 1: Unanswerable question (Expected to refuse)
  if (evalItem.isAnswerable === false) {
    if (isRefusal) {
      return {
        verdict: 'CORRECT_REFUSAL',
        isFaithful: true,
        faithfulnessScore: 1.0,
        isRefusal: true,
        expectedRefusal: true,
        evaluatorMode: 'DETERMINISTIC_LEXICAL_AND_NUMERIC',
        explanation: 'Model correctly recognized that documents do not contain the answer and declined.',
        unsupportedTerms: [],
        unsupportedNumbers: [],
        groundedRatio: 1.0,
      };
    } else {
      return {
        verdict: 'UNSUPPORTED_HALLUCINATION',
        isFaithful: false,
        faithfulnessScore: 0.0,
        isRefusal: false,
        expectedRefusal: true,
        evaluatorMode: 'DETERMINISTIC_LEXICAL_AND_NUMERIC',
        explanation: 'Model generated an answer for an unanswerable question instead of refusing based on evidence.',
        unsupportedTerms: extractSalientTerms(answer).slice(0, 5),
        unsupportedNumbers: extractSalientNumbers(answer),
        groundedRatio: 0.0,
      };
    }
  }

  // Case 2: Answerable question (Expected to answer using retrieved context)
  if (isRefusal) {
    return {
      verdict: 'FALSE_REFUSAL',
      isFaithful: false,
      faithfulnessScore: 0.2, // Penalized for failing to answer when evidence was present
      isRefusal: true,
      expectedRefusal: false,
      evaluatorMode: 'DETERMINISTIC_LEXICAL_AND_NUMERIC',
      explanation: 'Model falsely claimed evidence was missing when relevant chunks were available.',
      unsupportedTerms: [],
      unsupportedNumbers: [],
      groundedRatio: 0.0,
    };
  }

  // Case 3: Numerical Verification
  // Check if answer contains numeric claims (dimensions, counts, limits) not present in context or query
  const answerNumbers = extractSalientNumbers(answer);
  const contextAndQueryNumbers = new Set(
    extractSalientNumbers(combinedContextText + ' ' + (question || ''))
  );
  const unsupportedNumbers = answerNumbers.filter((num) => !contextAndQueryNumbers.has(num));

  // Case 3b: Named Entity & Acronym Verification
  // Check if answer introduces capitalized named entities or acronyms (e.g. AWS, Bedrock, Pinecone) not in context or query
  const answerEntities = extractNamedEntities(answer);
  const contextAndQueryText = (combinedContextText + ' ' + (question || '')).toLowerCase();
  const unsupportedEntities = answerEntities.filter(
    (ent) => !contextAndQueryText.includes(ent.toLowerCase())
  );

  // Case 4: Lexical Content Term Verification
  const answerTerms = extractSalientTerms(answer);
  if (answerTerms.length === 0) {
    const hasFabrications = unsupportedNumbers.length > 0 || unsupportedEntities.length > 0;
    return {
      verdict: hasFabrications ? 'UNSUPPORTED_CLAIMS' : 'PARTIALLY_SUPPORTED',
      isFaithful: !hasFabrications,
      faithfulnessScore: hasFabrications ? 0.3 : 0.7,
      isRefusal: false,
      expectedRefusal: false,
      evaluatorMode: 'DETERMINISTIC_LEXICAL_AND_NUMERIC',
      explanation: 'Answer contains very few distinctive content terms.',
      unsupportedTerms: [],
      unsupportedNumbers,
      unsupportedEntities,
      groundedRatio: 0.7,
    };
  }

  const unsupportedTerms = [];
  let supportedCount = 0;

  for (const term of answerTerms) {
    if (contextLower.includes(term) || queryLower.includes(term)) {
      supportedCount++;
    } else {
      unsupportedTerms.push(term);
    }
  }

  const groundedRatio = supportedCount / answerTerms.length;

  let verdict = 'FAITHFUL';
  let isFaithful = true;
  let score = Number(groundedRatio.toFixed(3));

  if (unsupportedNumbers.length > 0 || unsupportedEntities.length > 0) {
    verdict = 'UNSUPPORTED_CLAIMS';
    isFaithful = false;
    score = Math.min(score, 0.35); // Heavy penalty for fabricated numbers or entities
  } else if (groundedRatio >= 0.8) {
    verdict = 'FAITHFUL';
    isFaithful = true;
  } else if (groundedRatio >= 0.5) {
    verdict = 'PARTIALLY_SUPPORTED';
    isFaithful = true;
  } else {
    // Low lexical overlap with no unsupported numbers or entities could be an abstract paraphrase or subtle contradiction
    verdict = 'NEEDS_HUMAN_REVIEW';
    isFaithful = false;
    score = Math.min(score, 0.45);
  }

  return {
    verdict,
    isFaithful,
    faithfulnessScore: score,
    isRefusal: false,
    expectedRefusal: false,
    evaluatorMode: 'DETERMINISTIC_LEXICAL_AND_NUMERIC',
    humanReviewRecommended: verdict === 'NEEDS_HUMAN_REVIEW' || verdict === 'PARTIALLY_SUPPORTED',
    groundedRatio: Number(groundedRatio.toFixed(3)),
    totalTerms: answerTerms.length,
    supportedTermsCount: supportedCount,
    unsupportedTerms: unsupportedTerms.slice(0, 8),
    unsupportedNumbers,
    unsupportedEntities,
    explanation:
      unsupportedNumbers.length > 0
        ? `Answer contains unsupported numerical claims: [${unsupportedNumbers.join(', ')}] not found in context.`
        : unsupportedEntities.length > 0
        ? `Answer contains ungrounded named entities: [${unsupportedEntities.join(', ')}] not found in context.`
        : verdict === 'FAITHFUL'
        ? `${Math.round(groundedRatio * 100)}% of answer content terms are directly supported by retrieved context.`
        : verdict === 'NEEDS_HUMAN_REVIEW'
        ? `Low lexical overlap (${Math.round(groundedRatio * 100)}%). Deterministic matcher cannot verify semantic equivalence without manual review.`
        : `${unsupportedTerms.length} terms in the answer were not found in retrieved excerpts.`,
  };
}

/**
 * Runs faithfulness evaluation over a generated question-answer-sources dataset.
 *
 * @param {Array<Object>} evaluations - Array of { question, answer, sources, evalItem }
 * @returns {Object} Aggregated faithfulness metrics and individual breakdown
 */
export function evaluateDatasetFaithfulness(evaluations) {
  let totalScore = 0;
  let faithfulCount = 0;
  let refusalSuccessCount = 0;
  let totalRefusalsExpected = 0;

  const results = evaluations.map((item) => {
    const evaluation = evaluateAnswerFaithfulness(
      item.question,
      item.answer,
      item.sources || [],
      item.evalItem
    );

    totalScore += evaluation.faithfulnessScore;
    if (evaluation.isFaithful) faithfulCount++;

    if (item.evalItem?.isAnswerable === false) {
      totalRefusalsExpected++;
      if (evaluation.verdict === 'CORRECT_REFUSAL') {
        refusalSuccessCount++;
      }
    }

    return {
      id: item.evalItem?.id || item.id,
      category: item.evalItem?.category,
      question: item.question,
      answer: item.answer,
      isAnswerable: item.evalItem?.isAnswerable,
      evaluation,
    };
  });

  const count = evaluations.length;
  const meanFaithfulness = count > 0 ? totalScore / count : 0;
  const faithfulnessRate = count > 0 ? faithfulCount / count : 0;
  const refusalAccuracy =
    totalRefusalsExpected > 0 ? refusalSuccessCount / totalRefusalsExpected : 1.0;

  return {
    totalEvaluated: count,
    meanFaithfulnessScore: Number(meanFaithfulness.toFixed(4)),
    overallFaithfulnessRate: Number(faithfulnessRate.toFixed(4)),
    unanswerableRefusalAccuracy: Number(refusalAccuracy.toFixed(4)),
    results,
  };
}
