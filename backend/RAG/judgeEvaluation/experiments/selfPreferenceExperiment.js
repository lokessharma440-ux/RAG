import { calculateSelfPreferenceMetrics } from '../metrics/judgeMetrics.js';

/**
 * Runs Self-Preference Bias Experiment.
 * Evaluates whether judge prefers answers produced by its own model identity.
 * Compares judgments under blind condition vs explicit model provenance metadata.
 *
 * @param {BaseJudge} judge
 * @param {Array<Object>} dataset
 * @param {Object} [options={}]
 * @returns {Promise<{ metrics: Object, results: Array<Object> }>}
 */
export async function runSelfPreferenceExperiment(judge, dataset, options = {}) {
  const controlSubset = dataset.filter((d) => d.category === 'self_preference_control');

  if (controlSubset.length === 0) {
    return {
      metrics: {
        status: 'UNAVAILABLE',
        reason: 'No provenance-controlled cases in dataset.',
      },
      results: [],
    };
  }

  const results = [];

  for (const item of controlSubset) {
    // 1. Blind condition (no model provenance in prompt)
    const blindEval = await judge.evaluatePair(item, {
      ...options,
      modelTagA: null,
      modelTagB: null,
    });

    // 2. Provenance-tagged condition (model identities explicitly shown)
    const taggedEval = await judge.evaluatePair(item, {
      ...options,
      modelTagA: item.metadata?.modelA || 'Model-A',
      modelTagB: item.metadata?.modelB || 'Model-B',
    });

    results.push({
      item,
      blindWinner: blindEval.winner,
      taggedWinner: taggedEval.winner,
      blindScoresA: blindEval.scoresA,
      blindScoresB: blindEval.scoresB,
      taggedScoresA: taggedEval.scoresA,
      taggedScoresB: taggedEval.scoresB,
    });
  }

  const metrics = calculateSelfPreferenceMetrics(results);

  return {
    metrics,
    results,
  };
}

