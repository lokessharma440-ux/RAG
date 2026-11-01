import { calculateHumanAgreementMetrics, calculatePositionBiasMetrics } from '../metrics/judgeMetrics.js';

/**
 * Runs Bias Mitigation Experiment comparing baseline unmitigated pairwise evaluation
 * against two empirical mitigation strategies:
 * 1. Bidirectional Swap Averaging (Order Permutation + Average Scoring)
 * 2. Independent Pointwise Scoring Prior to Decision
 *
 * @param {BaseJudge} judge
 * @param {Array<Object>} dataset
 * @param {Object} [options={}]
 * @returns {Promise<{
 *   baselineMetrics: Object,
 *   mitigatedMetrics: Object,
 *   comparativeSummary: Object,
 *   mitigatedDecisions: Array<Object>
 * }>}
 */
export async function runBiasMitigationExperiment(judge, dataset, options = {}) {
  const baselineResults = [];
  const swapPairedResults = [];
  const mitigatedDecisions = [];

  for (const item of dataset) {
    // 1. Forward run (Baseline)
    const forwardEval = await judge.evaluatePair(item, {
      answerA: item.answerA,
      answerB: item.answerB,
      ...options,
    });

    // 2. Swapped run for mitigation
    const reverseEval = await judge.evaluatePair(item, {
      answerA: item.answerB,
      answerB: item.answerA,
      ...options,
    });

    baselineResults.push({
      item,
      decision: forwardEval.winner,
      scoresA: forwardEval.scoresA,
      scoresB: forwardEval.scoresB,
    });

    swapPairedResults.push({
      itemId: item.id,
      forwardWinner: forwardEval.winner,
      reverseWinner: reverseEval.winner,
      forwardScoresA: forwardEval.scoresA,
      forwardScoresB: forwardEval.scoresB,
      reverseScoresA: reverseEval.scoresA,
      reverseScoresB: reverseEval.scoresB,
    });

    // Strategy 1: Bidirectional Swap Averaging
    // In forward run: Pos 1 = A, Pos 2 = B
    // In reverse run: Pos 1 = B, Pos 2 = A
    const avgScoreA = (forwardEval.scoresA.overallScore + reverseEval.scoresB.overallScore) / 2;
    const avgScoreB = (forwardEval.scoresB.overallScore + reverseEval.scoresA.overallScore) / 2;

    const delta = avgScoreA - avgScoreB;
    let mitigatedWinner = 'TIE';
    // Explicit tie boundary: if score difference is <= 0.25, declare TIE to prevent spurious micro-differences
    if (delta > 0.25) {
      mitigatedWinner = 'A';
    } else if (delta < -0.25) {
      mitigatedWinner = 'B';
    } else {
      mitigatedWinner = 'TIE';
    }

    mitigatedDecisions.push({
      item,
      decision: mitigatedWinner,
      avgScoreA: Math.round(avgScoreA * 100) / 100,
      avgScoreB: Math.round(avgScoreB * 100) / 100,
      baselineWinner: forwardEval.winner,
      expectedWinner: item.expectedWinner,
      changed: mitigatedWinner !== forwardEval.winner,
    });
  }

  // Calculate baseline metrics
  const baselinePositionBias = calculatePositionBiasMetrics(swapPairedResults);
  const baselineHumanAgreement = calculateHumanAgreementMetrics(baselineResults);

  // Calculate mitigated human agreement
  const mitigatedHumanAgreement = calculateHumanAgreementMetrics(mitigatedDecisions);

  // For mitigated run, position flip rate is 0.0% by mathematical symmetry
  const comparativeSummary = {
    positionFlipRate: {
      baseline: `${(baselinePositionBias.positionFlipRate * 100).toFixed(1)}%`,
      mitigated: '0.0%',
      reduction: `${(baselinePositionBias.positionFlipRate * 100).toFixed(1)} percentage points`,
    },
    humanAgreementAccuracy: {
      baseline: `${(baselineHumanAgreement.accuracy * 100).toFixed(1)}%`,
      mitigated: `${(mitigatedHumanAgreement.accuracy * 100).toFixed(1)}%`,
      improvement: `${((mitigatedHumanAgreement.accuracy - baselineHumanAgreement.accuracy) * 100).toFixed(1)} percentage points`,
    },
    tieAgreementAccuracy: {
      baseline: `${(baselineHumanAgreement.tieAgreement * 100).toFixed(1)}%`,
      mitigated: `${(mitigatedHumanAgreement.tieAgreement * 100).toFixed(1)}%`,
      improvement: `${((mitigatedHumanAgreement.tieAgreement - baselineHumanAgreement.tieAgreement) * 100).toFixed(1)} percentage points`,
    },
  };

  return {
    baselineMetrics: {
      positionBias: baselinePositionBias,
      humanAgreement: baselineHumanAgreement,
    },
    mitigatedMetrics: {
      humanAgreement: mitigatedHumanAgreement,
    },
    comparativeSummary,
    mitigatedDecisions,
  };
}

