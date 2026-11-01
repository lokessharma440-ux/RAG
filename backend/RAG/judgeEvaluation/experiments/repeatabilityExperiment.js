import { calculateRepeatabilityMetrics } from '../metrics/judgeMetrics.js';

/**
 * Runs Repeatability & Variance Experiment.
 * Evaluates a selected sample of answer pairs across repeated iterations.
 * Measures decision consistency and score variance across runs.
 *
 * @param {BaseJudge} judge
 * @param {Array<Object>} dataset
 * @param {number} [iterations=3]
 * @param {number} [sampleSize=8]
 * @param {Object} [options={}]
 * @returns {Promise<{ metrics: Object, runHistory: Array<Object> }>}
 */
export async function runRepeatabilityExperiment(judge, dataset, iterations = 3, sampleSize = 8, options = {}) {
  // Select diverse subset across categories
  const sampledItems = dataset.slice(0, sampleSize);
  const repeatedItems = [];

  for (const item of sampledItems) {
    const decisions = [];
    const scoreAHistory = [];
    const scoreBHistory = [];

    for (let run = 1; run <= iterations; run++) {
      const evaluation = await judge.evaluatePair(item, {
        ...options,
        runIndex: run,
      });

      decisions.push(evaluation.winner);
      scoreAHistory.push(evaluation.scoresA.overallScore);
      scoreBHistory.push(evaluation.scoresB.overallScore);
    }

    repeatedItems.push({
      itemId: item.id,
      category: item.category,
      decisions,
      scoreAHistory,
      scoreBHistory,
      isConsistent: new Set(decisions).size === 1,
    });
  }

  const metrics = calculateRepeatabilityMetrics(repeatedItems);

  return {
    metrics: {
      ...metrics,
      iterations,
      sampleSize,
    },
    runHistory: repeatedItems,
  };
}

