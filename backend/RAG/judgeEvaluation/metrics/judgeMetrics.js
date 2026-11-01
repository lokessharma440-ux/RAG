/**
 * Statistical Metrics for LLM-as-a-Judge Evaluation Framework.
 * Computes Position Bias, Verbosity Bias, Self-Preference,
 * Inter-Judge Cohen's Kappa, Human Agreement, and Repeatability.
 */

/**
 * Computes standard Cohen's Kappa coefficient for two categorical judges.
 *
 * @param {Array<string>} ratings1 - Array of categorical decisions ('A', 'B', 'TIE')
 * @param {Array<string>} ratings2 - Array of categorical decisions ('A', 'B', 'TIE')
 * @param {Array<string>} [categories=['A', 'B', 'TIE']]
 * @returns {{ kappa: number, observedAgreement: number, chanceAgreement: number, total: number }}
 */
export function calculateCohenKappa(ratings1 = [], ratings2 = [], categories = ['A', 'B', 'TIE']) {
  const n = Math.min(ratings1.length, ratings2.length);
  if (n === 0) {
    return { kappa: 0, observedAgreement: 0, chanceAgreement: 0, total: 0 };
  }

  // Count observed agreement
  let agreeCount = 0;
  const count1 = { A: 0, B: 0, TIE: 0 };
  const count2 = { A: 0, B: 0, TIE: 0 };

  for (let i = 0; i < n; i++) {
    const r1 = (ratings1[i] || 'TIE').toUpperCase();
    const r2 = (ratings2[i] || 'TIE').toUpperCase();

    if (r1 === r2) agreeCount++;
    if (count1[r1] !== undefined) count1[r1]++;
    if (count2[r2] !== undefined) count2[r2]++;
  }

  const Po = agreeCount / n;

  // Calculate chance agreement (Pe)
  let Pe = 0;
  for (const cat of categories) {
    const p1 = (count1[cat] || 0) / n;
    const p2 = (count2[cat] || 0) / n;
    Pe += p1 * p2;
  }

  // Kappa = (Po - Pe) / (1 - Pe)
  let kappa = 1.0;
  if (Pe < 1.0) {
    kappa = (Po - Pe) / (1 - Pe);
  }

  return {
    kappa: Math.round(kappa * 10000) / 10000,
    observedAgreement: Math.round(Po * 1000) / 1000,
    chanceAgreement: Math.round(Pe * 1000) / 1000,
    total: n,
  };
}

/**
 * Computes Position Bias metrics comparing forward (A vs B) and reverse (B vs A) runs.
 *
 * @param {Array<{ itemId: string, forwardWinner: string, reverseWinner: string, forwardScoresA: Object, forwardScoresB: Object, reverseScoresA: Object, reverseScoresB: Object }>} pairedResults
 * @returns {Object}
 */
export function calculatePositionBiasMetrics(pairedResults = []) {
  if (!pairedResults || pairedResults.length === 0) {
    return {
      totalPairs: 0,
      positionFlipRate: 0,
      positionConsistency: 1.0,
      firstPositionWinRate: 0.5,
      secondPositionWinRate: 0.5,
      meanScoreDelta: 0,
      flipsCount: 0,
    };
  }

  let flipsCount = 0;
  let firstPosWins = 0;
  let secondPosWins = 0;
  let tiesCount = 0;
  let totalScoreDelta = 0;

  for (const res of pairedResults) {
    // In forward run: Pos 1 is A, Pos 2 is B.
    // In reverse run: Pos 1 is B, Pos 2 is A.
    // reverseWinner is from the perspective of reverse run (where 'A' meant original B, 'B' meant original A).
    // Let's normalize reverseWinner back to original A/B coordinates:
    let normalizedReverseWinner = 'TIE';
    if (res.reverseWinner === 'A') normalizedReverseWinner = 'B';
    else if (res.reverseWinner === 'B') normalizedReverseWinner = 'A';

    // Position flip occurs if forward and reverse disagree on the true winner
    if (res.forwardWinner !== normalizedReverseWinner) {
      flipsCount++;
    }

    // Measure raw first-position preference
    if (res.forwardWinner === 'A') firstPosWins++;
    else if (res.forwardWinner === 'B') secondPosWins++;
    else tiesCount++;

    if (res.reverseWinner === 'A') firstPosWins++;
    else if (res.reverseWinner === 'B') secondPosWins++;
    else tiesCount++;

    // Compute absolute score difference for candidate A between forward and reverse
    const scoreAForward = res.forwardScoresA?.overallScore ?? 3;
    const scoreAReverse = res.reverseScoresB?.overallScore ?? 3; // In reverse, Answer A was evaluated as B
    totalScoreDelta += Math.abs(scoreAForward - scoreAReverse);
  }

  const totalEvaluations = pairedResults.length * 2;
  const totalPairs = pairedResults.length;

  return {
    totalPairs,
    flipsCount,
    positionFlipRate: Math.round((flipsCount / totalPairs) * 1000) / 1000,
    positionConsistency: Math.round((1 - flipsCount / totalPairs) * 1000) / 1000,
    firstPositionWinRate: Math.round((firstPosWins / totalEvaluations) * 1000) / 1000,
    secondPositionWinRate: Math.round((secondPosWins / totalEvaluations) * 1000) / 1000,
    tieRate: Math.round((tiesCount / totalEvaluations) * 1000) / 1000,
    meanScoreDelta: Math.round((totalScoreDelta / totalPairs) * 1000) / 1000,
  };
}

/**
 * Computes Verbosity Bias metrics across controlled length pairs.
 *
 * @param {Array<{ item: Object, decision: string, scoresA: Object, scoresB: Object }>} results
 * @returns {Object}
 */
export function calculateVerbosityBiasMetrics(results = []) {
  // 1. Equivalent pairs (concise vs verbose equivalent facts, expected TIE)
  const equivResults = results.filter((r) => r.item.category === 'concise_vs_verbose_equivalent');
  let equivTotal = equivResults.length;
  let verboseWinsInEquiv = 0;
  let conciseWinsInEquiv = 0;
  let tiesInEquiv = 0;
  let scoreDiffSumEquiv = 0;

  for (const r of equivResults) {
    const isA_Longer = (r.item.metadata?.lengthA ?? r.item.answerA.length) > (r.item.metadata?.lengthB ?? r.item.answerB.length);
    const verboseLabel = isA_Longer ? 'A' : 'B';
    const conciseLabel = isA_Longer ? 'B' : 'A';

    if (r.decision === verboseLabel) verboseWinsInEquiv++;
    else if (r.decision === conciseLabel) conciseWinsInEquiv++;
    else tiesInEquiv++;

    const verboseScore = isA_Longer ? r.scoresA.overallScore : r.scoresB.overallScore;
    const conciseScore = isA_Longer ? r.scoresB.overallScore : r.scoresA.overallScore;
    scoreDiffSumEquiv += (verboseScore - conciseScore);
  }

  // 2. Verbose Filler pairs (concise vs verbose containing irrelevant fluff)
  const fillerResults = results.filter((r) => r.item.category === 'verbose_filler_vs_concise');
  let fillerTotal = fillerResults.length;
  let conciseWinsOverFiller = 0;
  let fillerWins = 0;

  for (const r of fillerResults) {
    const expected = r.item.expectedWinner;
    if (r.decision === expected || r.decision === 'TIE') {
      conciseWinsOverFiller++;
    } else {
      fillerWins++;
    }
  }

  // 3. Verbose Hallucinated pairs (concise correct vs verbose hallucinated)
  const hallucinatedResults = results.filter((r) => r.item.category === 'verbose_hallucinated_vs_concise');
  let hallucinationTotal = hallucinatedResults.length;
  let correctConciseWins = 0;
  let hallucinationMaskedByLength = 0;

  for (const r of hallucinatedResults) {
    if (r.decision === r.item.expectedWinner) {
      correctConciseWins++;
    } else {
      hallucinationMaskedByLength++;
    }
  }

  return {
    equivalentCases: {
      total: equivTotal,
      verbosePreferenceRate: equivTotal > 0 ? Math.round((verboseWinsInEquiv / equivTotal) * 1000) / 1000 : 0,
      concisePreferenceRate: equivTotal > 0 ? Math.round((conciseWinsInEquiv / equivTotal) * 1000) / 1000 : 0,
      tieRate: equivTotal > 0 ? Math.round((tiesInEquiv / equivTotal) * 1000) / 1000 : 0,
      meanScoreDiffVerboseMinusConcise: equivTotal > 0 ? Math.round((scoreDiffSumEquiv / equivTotal) * 1000) / 1000 : 0,
    },
    fillerCases: {
      total: fillerTotal,
      conciseWinRate: fillerTotal > 0 ? Math.round((conciseWinsOverFiller / fillerTotal) * 1000) / 1000 : 0,
      fillerWinRate: fillerTotal > 0 ? Math.round((fillerWins / fillerTotal) * 1000) / 1000 : 0,
    },
    hallucinationCases: {
      total: hallucinationTotal,
      accuracyUnderVerbosity: hallucinationTotal > 0 ? Math.round((correctConciseWins / hallucinationTotal) * 1000) / 1000 : 0,
      hallucinationFavoredByLengthRate: hallucinationTotal > 0 ? Math.round((hallucinationMaskedByLength / hallucinationTotal) * 1000) / 1000 : 0,
    },
  };
}

/**
 * Computes Self-Preference metrics comparing blind evaluation vs model-tagged evaluation.
 *
 * @param {Array<{ item: Object, blindWinner: string, taggedWinner: string }>} results
 * @returns {Object}
 */
export function calculateSelfPreferenceMetrics(results = []) {
  if (!results || results.length === 0) {
    return {
      status: 'UNAVAILABLE',
      totalCases: 0,
      blindSelfWinRate: 0,
      taggedSelfWinRate: 0,
      selfPreferenceDelta: 0,
    };
  }

  let selfWinsBlind = 0;
  let selfWinsTagged = 0;
  let totalValid = 0;

  for (const r of results) {
    // Only cases where modelA or modelB is explicitly 'Gemini'
    const isModelA_Self = (r.item.metadata?.modelA || '').toLowerCase().includes('gemini');
    const isModelB_Self = (r.item.metadata?.modelB || '').toLowerCase().includes('gemini');

    if (isModelA_Self || isModelB_Self) {
      totalValid++;
      const selfLabel = isModelA_Self ? 'A' : 'B';

      if (r.blindWinner === selfLabel) selfWinsBlind++;
      if (r.taggedWinner === selfLabel) selfWinsTagged++;
    }
  }

  if (totalValid === 0) {
    return {
      status: 'UNAVAILABLE',
      reason: 'No provenance-controlled cases in evaluation subset.',
      totalCases: 0,
    };
  }

  const blindRate = Math.round((selfWinsBlind / totalValid) * 1000) / 1000;
  const taggedRate = Math.round((selfWinsTagged / totalValid) * 1000) / 1000;
  const delta = Math.round((taggedRate - blindRate) * 1000) / 1000;

  return {
    status: 'ACTIVE',
    totalCases: totalValid,
    blindSelfWinRate: blindRate,
    taggedSelfWinRate: taggedRate,
    selfPreferenceDelta: delta,
    biasDetected: delta > 0.15,
  };
}

/**
 * Computes Human Agreement Metrics (Accuracy against human ground truth labels).
 *
 * @param {Array<{ item: Object, decision: string }>} results
 * @returns {Object}
 */
export function calculateHumanAgreementMetrics(results = []) {
  if (!results || results.length === 0) {
    return { accuracy: 0, total: 0, categoryBreakdown: {} };
  }

  let correctCount = 0;
  let humanTies = 0;
  let judgeTiesOnHumanTies = 0;
  const categoryMap = {};

  for (const r of results) {
    const expected = r.item.expectedWinner;
    const actual = r.decision;
    const isCorrect = actual === expected;

    if (isCorrect) correctCount++;

    if (expected === 'TIE') {
      humanTies++;
      if (actual === 'TIE') judgeTiesOnHumanTies++;
    }

    const cat = r.item.category;
    if (!categoryMap[cat]) {
      categoryMap[cat] = { total: 0, correct: 0 };
    }
    categoryMap[cat].total++;
    if (isCorrect) categoryMap[cat].correct++;
  }

  const categoryBreakdown = {};
  for (const [cat, data] of Object.entries(categoryMap)) {
    categoryBreakdown[cat] = {
      total: data.total,
      correct: data.correct,
      accuracy: Math.round((data.correct / data.total) * 1000) / 1000,
    };
  }

  return {
    total: results.length,
    correct: correctCount,
    accuracy: Math.round((correctCount / results.length) * 1000) / 1000,
    tieAgreement: humanTies > 0 ? Math.round((judgeTiesOnHumanTies / humanTies) * 1000) / 1000 : 1.0,
    categoryBreakdown,
  };
}

/**
 * Computes Repeatability / Score Variance metrics across repeated runs.
 *
 * @param {Array<{ itemId: string, decisions: Array<string>, scoreAHistory: Array<number>, scoreBHistory: Array<number> }>} repeatedItems
 * @returns {Object}
 */
export function calculateRepeatabilityMetrics(repeatedItems = []) {
  if (!repeatedItems || repeatedItems.length === 0) {
    return { itemsCount: 0, decisionConsistencyRate: 1.0, meanScoreVariance: 0 };
  }

  let consistentItemsCount = 0;
  let totalVarianceSum = 0;

  for (const item of repeatedItems) {
    // Check if all decisions in this item match
    const uniqueDecisions = new Set(item.decisions);
    if (uniqueDecisions.size === 1) {
      consistentItemsCount++;
    }

    // Calculate variance of scoreA
    const scoresA = item.scoreAHistory;
    if (scoresA.length > 1) {
      const meanA = scoresA.reduce((a, b) => a + b, 0) / scoresA.length;
      const varA = scoresA.reduce((a, b) => a + Math.pow(b - meanA, 2), 0) / (scoresA.length - 1);
      totalVarianceSum += varA;
    }
  }

  return {
    itemsCount: repeatedItems.length,
    decisionConsistencyRate: Math.round((consistentItemsCount / repeatedItems.length) * 1000) / 1000,
    meanScoreVariance: Math.round((totalVarianceSum / repeatedItems.length) * 10000) / 10000,
  };
}

