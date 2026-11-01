import { calculatePositionBiasMetrics } from '../metrics/judgeMetrics.js';

/**
 * Runs Position Bias Experiment.
 * Evaluates candidate pairs in forward order (A vs B) and swapped reverse order (B vs A).
 *
 * @param {BaseJudge} judge
 * @param {Array<Object>} dataset
 * @param {Object} [options={}]
 * @returns {Promise<{ metrics: Object, pairedResults: Array<Object> }>}
 */
export async function runPositionBiasExperiment(judge, dataset, options = {}) {
  const pairedResults = [];

  for (const item of dataset) {
    // 1. Forward run (A in Position 1, B in Position 2)
    const forwardEval = await judge.evaluatePair(item, {
      answerA: item.answerA,
      answerB: item.answerB,
      ...options,
    });

    // 2. Swapped reverse run (B in Position 1, A in Position 2)
    const reverseEval = await judge.evaluatePair(item, {
      answerA: item.answerB,
      answerB: item.answerA,
      ...options,
    });

    pairedResults.push({
      itemId: item.id,
      category: item.category,
      forwardWinner: forwardEval.winner,
      reverseWinner: reverseEval.winner,
      forwardScoresA: forwardEval.scoresA,
      forwardScoresB: forwardEval.scoresB,
      reverseScoresA: reverseEval.scoresA, // Evaluated in Position 1 (which was original B)
      reverseScoresB: reverseEval.scoresB, // Evaluated in Position 2 (which was original A)
      forwardExplanation: forwardEval.explanation,
      reverseExplanation: reverseEval.explanation,
    });
  }

  const metrics = calculatePositionBiasMetrics(pairedResults);

  return {
    metrics,
    pairedResults,
  };
}

