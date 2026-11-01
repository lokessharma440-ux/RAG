/**
 * Structured Judge Prompts & Rubrics for LLM-as-a-Judge Evaluation.
 * Enforces 5-dimensional evaluation:
 * 1. Factual Correctness (0-5)
 * 2. Faithfulness to Context (0-5)
 * 3. Relevance (0-5)
 * 4. Completeness (0-5)
 * 5. Citation Correctness (0-5)
 */

export const JUDGE_RUBRIC_SPECIFICATION = `
EVALUATION DIMENSIONS (Score each from 0.0 to 5.0):
1. Factual Correctness: Are the factual statements, figures, calculations, and claims accurate? (5 = completely accurate, 0 = entirely false).
2. Faithfulness to Context: Is the answer strictly grounded in the provided Source Context without external hallucinations? (5 = 100% grounded, 0 = entirely fabricated).
3. Relevance: Does the answer directly answer the user's question without off-topic tangents? (5 = perfectly relevant, 0 = completely irrelevant).
4. Completeness: Does the answer address all parts of the user question supported by the context? (5 = comprehensive, 0 = completely misses question).
5. Citation Correctness: Are quoted sections, document references, or section names accurate and supported? (5 = accurate references or not needed, 0 = deceptive/fabricated citations).

CRITICAL BIAS PREVENTION RULES:
- DO NOT reward an answer simply because it is longer, more verbose, or uses elaborate formatting. A concise answer that covers all facts accurately is equally good or superior to a lengthy answer.
- Penalize fluff, repetitive filler, and ungrounded extrapolations.
- If both answers provide equivalent factual quality and correctness, declare a "TIE".
- Judge solely on content quality, not answer position.
`;

export const PAIRWISE_JUDGE_SYSTEM_PROMPT = `You are an expert, impartial AI Quality Judge evaluating two candidate answers (Answer A and Answer B) to a user's question based strictly on provided Source Context.

${JUDGE_RUBRIC_SPECIFICATION}

OUTPUT FORMAT:
You MUST output ONLY a valid JSON object matching this exact schema:
{
  "scoresA": {
    "factualCorrectness": 5.0,
    "faithfulness": 5.0,
    "relevance": 5.0,
    "completeness": 5.0,
    "citationCorrectness": 5.0
  },
  "scoresB": {
    "factualCorrectness": 4.0,
    "faithfulness": 4.0,
    "relevance": 4.0,
    "completeness": 3.0,
    "citationCorrectness": 5.0
  },
  "winner": "A",
  "explanation": "Concise factual reason why Answer A was chosen over Answer B or why it is a TIE.",
  "contextReferences": ["Quote or excerpt supporting decision"],
  "confidence": 0.95
}

Winner must be exactly "A", "B", or "TIE". Output ONLY valid JSON with no introductory or markdown text.`;

export const INDEPENDENT_JUDGE_SYSTEM_PROMPT = `You are an expert, impartial AI Quality Judge evaluating a single candidate answer to a user's question based strictly on provided Source Context.

${JUDGE_RUBRIC_SPECIFICATION}

OUTPUT FORMAT:
You MUST output ONLY a valid JSON object matching this exact schema:
{
  "scores": {
    "factualCorrectness": 5.0,
    "faithfulness": 5.0,
    "relevance": 5.0,
    "completeness": 5.0,
    "citationCorrectness": 5.0
  },
  "overallScore": 5.0,
  "explanation": "Concise factual assessment of the answer.",
  "confidence": 0.95
}
Output ONLY valid JSON with no introductory text.`;

/**
 * Builds user prompt for pairwise evaluation.
 *
 * @param {Object} params
 * @param {string} params.question
 * @param {string} params.context
 * @param {string} [params.referenceAnswer]
 * @param {string} params.answerA
 * @param {string} params.answerB
 * @param {Object} [params.options]
 * @returns {string}
 */
export function buildPairwiseUserPrompt({
  question,
  context,
  referenceAnswer,
  answerA,
  answerB,
  options = {},
}) {
  let prompt = `[USER QUESTION]\n${question}\n\n[SOURCE CONTEXT]\n${context}\n\n`;

  if (referenceAnswer) {
    prompt += `[REFERENCE GROUND TRUTH (For Comparison)]\n${referenceAnswer}\n\n`;
  }

  // Model provenance tagging if enabled for self-preference testing
  const tagA = options.modelTagA ? ` (Model: ${options.modelTagA})` : '';
  const tagB = options.modelTagB ? ` (Model: ${options.modelTagB})` : '';

  prompt += `[CANDIDATE ANSWER A]${tagA}\n${answerA}\n\n`;
  prompt += `[CANDIDATE ANSWER B]${tagB}\n${answerB}\n\n`;
  prompt += `Task: Score both answers on the 5 dimensions, determine the overall winner ("A", "B", or "TIE"), and output valid JSON.`;

  return prompt;
}

/**
 * Builds user prompt for independent pointwise evaluation.
 *
 * @param {Object} params
 * @param {string} params.question
 * @param {string} params.context
 * @param {string} [params.referenceAnswer]
 * @param {string} params.answer
 * @returns {string}
 */
export function buildIndependentUserPrompt({
  question,
  context,
  referenceAnswer,
  answer,
}) {
  let prompt = `[USER QUESTION]\n${question}\n\n[SOURCE CONTEXT]\n${context}\n\n`;
  if (referenceAnswer) {
    prompt += `[REFERENCE GROUND TRUTH]\n${referenceAnswer}\n\n`;
  }
  prompt += `[CANDIDATE ANSWER]\n${answer}\n\n`;
  prompt += `Task: Score the candidate answer across all 5 dimensions and output valid JSON.`;
  return prompt;
}

