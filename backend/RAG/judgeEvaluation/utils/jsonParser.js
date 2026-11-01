/**
 * Resilient JSON Parser for LLM-as-a-Judge outputs.
 * Strips markdown code blocks, handles partial framing, and validates rubric schema.
 */

const REQUIRED_RUBRIC_KEYS = [
  'factualCorrectness',
  'faithfulness',
  'relevance',
  'completeness',
  'citationCorrectness',
];

/**
 * Strips Markdown code block delimiters and extracts clean JSON string.
 *
 * @param {string} raw
 * @returns {string}
 */
export function extractJsonString(raw) {
  if (!raw || typeof raw !== 'string') return '';

  let cleaned = raw.trim();

  // Match ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Find first { and last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

/**
 * Clamps numeric score between 0 and 5.
 *
 * @param {*} val
 * @param {number} [fallback=3]
 * @returns {number}
 */
export function clampScore(val, fallback = 3) {
  const num = parseFloat(val);
  if (isNaN(num)) return fallback;
  return Math.max(0, Math.min(5, Math.round(num * 10) / 10));
}

/**
 * Normalizes rubric score object ensuring all 5 dimensions exist and are within [0, 5].
 *
 * @param {Object} scoresObj
 * @returns {Object}
 */
export function normalizeRubricScores(scoresObj = {}) {
  const normalized = {};
  for (const key of REQUIRED_RUBRIC_KEYS) {
    normalized[key] = clampScore(scoresObj[key], 3.0);
  }
  // Calculate aggregate score (average across dimensions)
  const sum = REQUIRED_RUBRIC_KEYS.reduce((acc, k) => acc + normalized[k], 0);
  normalized.overallScore = Math.round((sum / REQUIRED_RUBRIC_KEYS.length) * 100) / 100;
  return normalized;
}

/**
 * Normalizes winner string to 'A', 'B', or 'TIE'.
 *
 * @param {*} rawWinner
 * @returns {'A' | 'B' | 'TIE'}
 */
export function normalizeWinner(rawWinner) {
  if (!rawWinner || typeof rawWinner !== 'string') return 'TIE';
  const clean = rawWinner.trim().toUpperCase();
  if (clean === 'A' || clean.includes('ANSWER A') || clean.includes('WINNER: A')) return 'A';
  if (clean === 'B' || clean.includes('ANSWER B') || clean.includes('WINNER: B')) return 'B';
  return 'TIE';
}

/**
 * Parses and validates pairwise judge response into structured object.
 *
 * @param {string} rawText - Raw text output from LLM.
 * @returns {{
 *   success: boolean,
 *   data?: {
 *     winner: 'A' | 'B' | 'TIE',
 *     scoresA: Object,
 *     scoresB: Object,
 *     explanation: string,
 *     contextReferences: Array<string>,
 *     confidence: number
 *   },
 *   error?: string
 * }}
 */
export function parsePairwiseJudgeResponse(rawText) {
  try {
    const jsonStr = extractJsonString(rawText);
    if (!jsonStr) {
      return { success: false, error: 'Empty or missing JSON payload in response' };
    }

    const parsed = JSON.parse(jsonStr);

    const scoresA = normalizeRubricScores(parsed.scoresA || parsed.scores_a || parsed.answerA || {});
    const scoresB = normalizeRubricScores(parsed.scoresB || parsed.scores_b || parsed.answerB || {});
    const winner = normalizeWinner(parsed.winner || parsed.overallWinner || parsed.preference);

    const explanation = typeof parsed.explanation === 'string'
      ? parsed.explanation.trim()
      : 'No explanation provided.';

    const contextReferences = Array.isArray(parsed.contextReferences)
      ? parsed.contextReferences.map(String)
      : [];

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.85;

    return {
      success: true,
      data: {
        winner,
        scoresA,
        scoresB,
        explanation,
        contextReferences,
        confidence,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err.message}`,
    };
  }
}

