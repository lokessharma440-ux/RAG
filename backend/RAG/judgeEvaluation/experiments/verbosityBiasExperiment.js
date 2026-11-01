import { calculateVerbosityBiasMetrics } from '../metrics/judgeMetrics.js';

/**
 * Runs Verbosity Bias Experiment across controlled length pairs.
 * Evaluates whether longer answers receive unfairly higher scores.
 *
 * @param {BaseJudge} judge
 * @param {Array<Object>} dataset
 * @param {Object} [options={}]
 * @returns {Promise<{ metrics: Object, results: Array<Object> }>}
 */
export async function runVerbosityBiasExperiment(judge, dataset, options = {}) {
  // Target verbosity categories
  const targetCategories = new Set([
    'concise_vs_verbose_equivalent',
    'verbose_filler_vs_concise',
    'verbose_hallucinated_vs_concise',
  ]);

  const verbositySubset = dataset.filter((item) => targetCategories.has(item.category));
  const results = [];

  for (const item of verbositySubset) {
    const evaluation = await judge.evaluatePair(item, options);
    results.push({
      item,
      decision: evaluation.winner,
      scoresA: evaluation.scoresA,
      scoresB: evaluation.scoresB,
      explanation: evaluation.explanation,
    });
  }

  const metrics = calculateVerbosityBiasMetrics(results);

  return {
    metrics,
    results,
  };
}

