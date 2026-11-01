/**
 * Comprehensive Unit and Integration Test Suite for LLM-as-a-Judge Evaluation Framework.
 *
 * Usage:
 *   node backend/RAG/judgeEvaluation/testJudgeEvaluation.js
 */

import assert from 'assert';
import {
  extractJsonString,
  clampScore,
  normalizeRubricScores,
  normalizeWinner,
  parsePairwiseJudgeResponse,
} from './utils/jsonParser.js';
import {
  calculateCohenKappa,
  calculatePositionBiasMetrics,
  calculateVerbosityBiasMetrics,
  calculateHumanAgreementMetrics,
  calculateRepeatabilityMetrics,
} from './metrics/judgeMetrics.js';
import { MockJudge } from './judges/MockJudge.js';
import { JUDGE_BENCHMARK_DATASET } from './dataset/judgeBenchmarkDataset.js';
import { runPositionBiasExperiment } from './experiments/positionBiasExperiment.js';
import { runBiasMitigationExperiment } from './experiments/biasMitigationExperiment.js';

console.log('\n=================================================================');
console.log('   LLM-AS-A-JUDGE FRAMEWORK TEST SUITE                           ');
console.log('=================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✔ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✔ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

// -------------------------------------------------------------
// GROUP 1: JSON Parser & Schema Sanitizer
// -------------------------------------------------------------
console.log('--- TEST GROUP 1: JSON Parser & Schema Sanitizer ---');

runTest('Extracts JSON from markdown code block fences', () => {
  const raw = '```json\n{"winner": "A", "scoresA": {"factualCorrectness": 5}}\n```';
  const extracted = extractJsonString(raw);
  assert.strictEqual(extracted, '{"winner": "A", "scoresA": {"factualCorrectness": 5}}');
});

runTest('Extracts JSON embedded inside conversational text', () => {
  const raw = 'Here is the evaluation result:\n{"winner": "B", "confidence": 0.9}\nHope this helps!';
  const extracted = extractJsonString(raw);
  assert.strictEqual(extracted, '{"winner": "B", "confidence": 0.9}');
});

runTest('Clamps scores strictly within [0, 5] bounds', () => {
  assert.strictEqual(clampScore(7.5), 5.0);
  assert.strictEqual(clampScore(-2.0), 0.0);
  assert.strictEqual(clampScore(4.2), 4.2);
  assert.strictEqual(clampScore('invalid', 3.0), 3.0);
});

runTest('Normalizes winner strings accurately to A, B, or TIE', () => {
  assert.strictEqual(normalizeWinner('Answer A'), 'A');
  assert.strictEqual(normalizeWinner('winner: B'), 'B');
  assert.strictEqual(normalizeWinner('tie'), 'TIE');
  assert.strictEqual(normalizeWinner('EQUAL QUALITY'), 'TIE');
  assert.strictEqual(normalizeWinner(null), 'TIE');
});

runTest('Validates complete pairwise judge response structure', () => {
  const validJson = JSON.stringify({
    scoresA: { factualCorrectness: 4.5, faithfulness: 4.8, relevance: 5, completeness: 4, citationCorrectness: 5 },
    scoresB: { factualCorrectness: 3.0, faithfulness: 3.5, relevance: 4, completeness: 3, citationCorrectness: 3 },
    winner: 'A',
    explanation: 'Answer A is more grounded in the document.',
    confidence: 0.95,
  });

  const parsed = parsePairwiseJudgeResponse(validJson);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.data.winner, 'A');
  assert.strictEqual(parsed.data.scoresA.factualCorrectness, 4.5);
  assert.strictEqual(parsed.data.scoresA.overallScore, 4.66);
  assert.strictEqual(parsed.data.confidence, 0.95);
});

runTest('Gracefully catches malformed JSON without crashing', () => {
  const malformed = 'Not valid JSON at all';
  const parsed = parsePairwiseJudgeResponse(malformed);
  assert.strictEqual(parsed.success, false);
  assert(parsed.error.includes('JSON parse error') || parsed.error.includes('missing JSON'));
});

// -------------------------------------------------------------
// GROUP 2: Statistical Metrics & Cohen's Kappa
// -------------------------------------------------------------
console.log('\n--- TEST GROUP 2: Statistical Metric Calculators ---');

runTest('Calculates perfect Cohen Kappa when two judges agree 100%', () => {
  const judge1 = ['A', 'B', 'TIE', 'A', 'B'];
  const judge2 = ['A', 'B', 'TIE', 'A', 'B'];
  const res = calculateCohenKappa(judge1, judge2);
  assert.strictEqual(res.kappa, 1.0);
  assert.strictEqual(res.observedAgreement, 1.0);
});

runTest('Calculates 0 Kappa when agreement matches random chance', () => {
  const judge1 = ['A', 'A', 'A', 'A'];
  const judge2 = ['B', 'B', 'B', 'B'];
  const res = calculateCohenKappa(judge1, judge2);
  assert.strictEqual(res.observedAgreement, 0.0);
  assert(res.kappa <= 0.0);
});

runTest('Computes Position Bias metrics detecting order flips', () => {
  const syntheticPairs = [
    { forwardWinner: 'A', reverseWinner: 'B', forwardScoresA: { overallScore: 4.5 }, reverseScoresB: { overallScore: 4.5 } }, // Consistent (in reverse, A was B, winner was B -> consistent A)
    { forwardWinner: 'A', reverseWinner: 'A', forwardScoresA: { overallScore: 4.5 }, reverseScoresB: { overallScore: 2.0 } }, // Flips! In forward Pos 1 won; in reverse Pos 1 won!
  ];
  const metrics = calculatePositionBiasMetrics(syntheticPairs);
  assert.strictEqual(metrics.totalPairs, 2);
  assert.strictEqual(metrics.flipsCount, 1);
  assert.strictEqual(metrics.positionFlipRate, 0.5);
  assert.strictEqual(metrics.positionConsistency, 0.5);
});

runTest('Computes Repeatability metrics and score variance', () => {
  const repeatData = [
    { itemId: 'item-1', decisions: ['A', 'A', 'A'], scoreAHistory: [4.5, 4.5, 4.5] },
    { itemId: 'item-2', decisions: ['B', 'A', 'B'], scoreAHistory: [3.0, 4.0, 3.5] },
  ];
  const metrics = calculateRepeatabilityMetrics(repeatData);
  assert.strictEqual(metrics.itemsCount, 2);
  assert.strictEqual(metrics.decisionConsistencyRate, 0.5);
  assert(metrics.meanScoreVariance > 0);
});

// -------------------------------------------------------------
// GROUP 3: Benchmark Dataset Integrity
// -------------------------------------------------------------
console.log('\n--- TEST GROUP 3: Benchmark Dataset Integrity ---');

runTest('Dataset scale meets specification requirements (>= 30 cases)', () => {
  assert(JUDGE_BENCHMARK_DATASET.length >= 30, `Dataset size ${JUDGE_BENCHMARK_DATASET.length} < 30`);
  assert(JUDGE_BENCHMARK_DATASET.length <= 50, `Dataset size ${JUDGE_BENCHMARK_DATASET.length} > 50`);
});

runTest('Every dataset item contains required fields and valid expectedWinner', () => {
  const validWinners = new Set(['A', 'B', 'TIE']);
  for (const item of JUDGE_BENCHMARK_DATASET) {
    assert(typeof item.id === 'string' && item.id.length > 0, `Item missing id: ${JSON.stringify(item)}`);
    assert(typeof item.question === 'string' && item.question.length > 0, `Item ${item.id} missing question`);
    assert(typeof item.sourceContext === 'string' && item.sourceContext.length > 0, `Item ${item.id} missing context`);
    assert(typeof item.answerA === 'string' && item.answerA.length > 0, `Item ${item.id} missing answerA`);
    assert(typeof item.answerB === 'string' && item.answerB.length > 0, `Item ${item.id} missing answerB`);
    assert(validWinners.has(item.expectedWinner), `Item ${item.id} has invalid expectedWinner: ${item.expectedWinner}`);
    assert(item.metadata && typeof item.metadata.humanRationale === 'string', `Item ${item.id} missing human rationale`);
  }
});

runTest('All required bias evaluation categories are populated', () => {
  const categories = new Set(JUDGE_BENCHMARK_DATASET.map((d) => d.category));
  const required = [
    'factual_vs_incorrect',
    'faithful_vs_hallucinated',
    'relevant_vs_irrelevant',
    'complete_vs_incomplete',
    'concise_vs_verbose_equivalent',
    'verbose_filler_vs_concise',
    'verbose_hallucinated_vs_concise',
    'conflicting_claims',
    'unsupported_citations',
    'writing_styles',
    'self_preference_control',
  ];
  for (const req of required) {
    assert(categories.has(req), `Missing required evaluation category: ${req}`);
  }
});

// -------------------------------------------------------------
// GROUP 4: Mock Judge & Mitigation Execution
// -------------------------------------------------------------
console.log('\n--- TEST GROUP 4: Judge Execution & Bias Mitigation ---');

await runAsyncTest('MockJudge correctly evaluates factual answer over false answer', async () => {
  const judge = new MockJudge();
  const item = JUDGE_BENCHMARK_DATASET.find((d) => d.id === 'judge-01');
  const res = await judge.evaluatePair(item);
  assert.strictEqual(res.winner, 'A');
  assert(res.scoresA.factualCorrectness > res.scoresB.factualCorrectness);
});

await runAsyncTest('MockJudge detects simulated position bias when injected', async () => {
  const biasedJudge = new MockJudge({ simulatedPositionBias: true });
  const smallSubset = JUDGE_BENCHMARK_DATASET.slice(0, 4);
  const result = await runPositionBiasExperiment(biasedJudge, smallSubset);
  assert(result.metrics.firstPositionWinRate > 0.5, 'Biased judge should exhibit > 50% Position 1 win rate');
});

await runAsyncTest('Bias Mitigation eliminates position flip rate (0.0% by construction)', async () => {
  const biasedJudge = new MockJudge({ simulatedPositionBias: true });
  const smallSubset = JUDGE_BENCHMARK_DATASET.slice(0, 6);
  const mitigationRes = await runBiasMitigationExperiment(biasedJudge, smallSubset);
  assert.strictEqual(mitigationRes.comparativeSummary.positionFlipRate.mitigated, '0.0%');
});

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log('\n=================================================================');
console.log(`TOTAL TESTS: ${passedTests + failedTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log('=================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

