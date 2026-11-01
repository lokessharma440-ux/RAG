import { calculateCohenKappa } from '../metrics/judgeMetrics.js';

/**
 * Runs Inter-Judge Agreement Experiment between two independent judges.
 * Computes observed agreement, chance agreement, and Cohen's Kappa coefficient.
 *
 * @param {BaseJudge} judge1 - Primary Judge (e.g. GeminiJudge)
 * @param {BaseJudge} judge2 - Baseline Judge (e.g. MockJudge)
 * @param {Array<Object>} dataset
 * @param {Object} [options={}]
 * @returns {Promise<{ metrics: Object, comparativeResults: Array<Object> }>}
 */
export async function runInterJudgeAgreementExperiment(judge1, judge2, dataset, options = {}) {
  const ratings1 = [];
  const ratings2 = [];
  const comparativeResults = [];

  for (const item of dataset) {
    const eval1 = await judge1.evaluatePair(item, options);
    const eval2 = await judge2.evaluatePair(item, options);

    ratings1.push(eval1.winner);
    ratings2.push(eval2.winner);

    comparativeResults.push({
      itemId: item.id,
      category: item.category,
      expectedWinner: item.expectedWinner,
      judge1Winner: eval1.winner,
      judge2Winner: eval2.winner,
      judge1Scores: { A: eval1.scoresA.overallScore, B: eval1.scoresB.overallScore },
      judge2Scores: { A: eval2.scoresA.overallScore, B: eval2.scoresB.overallScore },
      agreed: eval1.winner === eval2.winner,
    });
  }

  const metrics = calculateCohenKappa(ratings1, ratings2);

  // Category breakdown of agreement
  const categoryMap = {};
  for (const res of comparativeResults) {
    if (!categoryMap[res.category]) {
      categoryMap[res.category] = { total: 0, agreed: 0 };
    }
    categoryMap[res.category].total++;
    if (res.agreed) categoryMap[res.category].agreed++;
  }

  const categoryAgreement = {};
  for (const [cat, data] of Object.entries(categoryMap)) {
    categoryAgreement[cat] = {
      total: data.total,
      agreed: data.agreed,
      rate: Math.round((data.agreed / data.total) * 1000) / 1000,
    };
  }

  return {
    metrics: {
      ...metrics,
      judge1Name: judge1.name,
      judge2Name: judge2.name,
      categoryAgreement,
    },
    comparativeResults,
  };
}

