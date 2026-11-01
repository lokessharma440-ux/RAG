/**
 * Unified CLI Runner for Phase 4: LLM-as-a-Judge Bias & Reliability Framework.
 *
 * Usage:
 *   node backend/RAG/judgeEvaluation/runJudgeEvaluation.js
 *   RUN_LIVE_GEMINI_JUDGE=true node backend/RAG/judgeEvaluation/runJudgeEvaluation.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { JUDGE_BENCHMARK_DATASET } from './dataset/judgeBenchmarkDataset.js';
import { GeminiJudge } from './judges/GeminiJudge.js';
import { MockJudge } from './judges/MockJudge.js';
import { runPositionBiasExperiment } from './experiments/positionBiasExperiment.js';
import { runVerbosityBiasExperiment } from './experiments/verbosityBiasExperiment.js';
import { runSelfPreferenceExperiment } from './experiments/selfPreferenceExperiment.js';
import { runInterJudgeAgreementExperiment } from './experiments/interJudgeAgreement.js';
import { runRepeatabilityExperiment } from './experiments/repeatabilityExperiment.js';
import { runBiasMitigationExperiment } from './experiments/biasMitigationExperiment.js';
import { calculateHumanAgreementMetrics } from './metrics/judgeMetrics.js';
import { generateJudgeEvaluationReport } from './judgeEvaluationReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export async function runJudgeEvaluationBenchmark() {
  const overallStartTime = Date.now();

  console.log('\n' + '='.repeat(68));
  console.log('   DEVMIND AI: LLM-AS-A-JUDGE BIAS & RELIABILITY FRAMEWORK   ');
  console.log('='.repeat(68) + '\n');

  const useLiveGemini = process.env.RUN_LIVE_GEMINI_JUDGE === 'true' && Boolean(process.env.GEMINI_API_KEY);
  const primaryJudge = useLiveGemini
    ? new GeminiJudge({ temperature: 0.0 })
    : new MockJudge({ simulatedPositionBias: false, simulatedVerbosityBias: false });

  const secondaryJudge = new MockJudge({ simulatedPositionBias: false, simulatedVerbosityBias: false });

  console.log(`Active Evaluation Mode:  ${useLiveGemini ? '🔥 LIVE GEMINI 1.5 FLASH' : '⚡ DETERMINISTIC MOCK JUDGE'}`);
  console.log(`Benchmark Dataset Scale: ${JUDGE_BENCHMARK_DATASET.length} Human-Reviewed Answer Pairs`);
  console.log(`Inter-Judge Baseline:    ${secondaryJudge.name}\n`);

  // -------------------------------------------------------------
  // EXPERIMENT 1: POSITION BIAS
  // -------------------------------------------------------------
  console.log('[1/6] Executing Position Bias Experiment (Order Permutation)...');
  const posBiasResult = await runPositionBiasExperiment(primaryJudge, JUDGE_BENCHMARK_DATASET);
  console.log(`  ✓ Position Consistency: ${(posBiasResult.metrics.positionConsistency * 100).toFixed(1)}%`);
  console.log(`  ✓ Position Flip Rate:    ${(posBiasResult.metrics.positionFlipRate * 100).toFixed(1)}% (${posBiasResult.metrics.flipsCount} flips / ${posBiasResult.metrics.totalPairs} pairs)`);
  console.log(`  ✓ First Position Wins:   ${(posBiasResult.metrics.firstPositionWinRate * 100).toFixed(1)}%`);
  console.log(`  ✓ Mean Score Drift:      ${posBiasResult.metrics.meanScoreDelta} pts\n`);

  // -------------------------------------------------------------
  // EXPERIMENT 2: VERBOSITY BIAS
  // -------------------------------------------------------------
  console.log('[2/6] Executing Verbosity Bias Experiment (Length vs. Quality)...');
  const verbosityResult = await runVerbosityBiasExperiment(primaryJudge, JUDGE_BENCHMARK_DATASET);
  console.log(`  ✓ Equivalent Length Preference: ${(verbosityResult.metrics.equivalentCases.verbosePreferenceRate * 100).toFixed(1)}% (Verbose) vs ${(verbosityResult.metrics.equivalentCases.tieRate * 100).toFixed(1)}% (TIE)`);
  console.log(`  ✓ Fluff Rejection Rate:         ${(verbosityResult.metrics.fillerCases.conciseWinRate * 100).toFixed(1)}%`);
  console.log(`  ✓ Hallucination Under Length:   ${(verbosityResult.metrics.hallucinationCases.accuracyUnderVerbosity * 100).toFixed(1)}% correct identification\n`);

  // -------------------------------------------------------------
  // EXPERIMENT 3: SELF-PREFERENCE BIAS
  // -------------------------------------------------------------
  console.log('[3/6] Executing Self-Preference Experiment (Provenance Sensitivity)...');
  const selfPrefResult = await runSelfPreferenceExperiment(primaryJudge, JUDGE_BENCHMARK_DATASET);
  if (selfPrefResult.metrics.status === 'ACTIVE') {
    console.log(`  ✓ Blind Win Rate:   ${(selfPrefResult.metrics.blindSelfWinRate * 100).toFixed(1)}%`);
    console.log(`  ✓ Tagged Win Rate:  ${(selfPrefResult.metrics.taggedSelfWinRate * 100).toFixed(1)}%`);
    console.log(`  ✓ Provenance Delta: ${(selfPrefResult.metrics.selfPreferenceDelta * 100).toFixed(1)}% (Significant Bias: ${selfPrefResult.metrics.biasDetected ? 'YES' : 'NO'})\n`);
  } else {
    console.log(`  ℹ Self-preference test marked: ${selfPrefResult.metrics.status}\n`);
  }

  // -------------------------------------------------------------
  // EXPERIMENT 4: INTER-JUDGE AGREEMENT
  // -------------------------------------------------------------
  console.log('[4/6] Executing Inter-Judge Agreement (Cohen\'s Kappa)...');
  const interJudgeResult = await runInterJudgeAgreementExperiment(primaryJudge, secondaryJudge, JUDGE_BENCHMARK_DATASET);
  console.log(`  ✓ Observed Agreement: ${(interJudgeResult.metrics.observedAgreement * 100).toFixed(1)}%`);
  console.log(`  ✓ Chance Agreement:   ${(interJudgeResult.metrics.chanceAgreement * 100).toFixed(1)}%`);
  console.log(`  ✓ Cohen's Kappa:      κ = ${interJudgeResult.metrics.kappa}\n`);

  // -------------------------------------------------------------
  // EXPERIMENT 5: REPEATABILITY & VARIANCE
  // -------------------------------------------------------------
  console.log('[5/6] Executing Repeatability Experiment (3 Repeated Iterations)...');
  const repeatabilityResult = await runRepeatabilityExperiment(primaryJudge, JUDGE_BENCHMARK_DATASET, 3, 8);
  console.log(`  ✓ Decision Consistency: ${(repeatabilityResult.metrics.decisionConsistencyRate * 100).toFixed(1)}%`);
  console.log(`  ✓ Mean Score Variance:  ${repeatabilityResult.metrics.meanScoreVariance}\n`);

  // -------------------------------------------------------------
  // EXPERIMENT 6: BIAS MITIGATION & HUMAN AGREEMENT
  // -------------------------------------------------------------
  console.log('[6/6] Executing Bias Mitigation & Human Agreement Benchmark...');
  const mitigationResult = await runBiasMitigationExperiment(primaryJudge, JUDGE_BENCHMARK_DATASET);
  console.log(`  ✓ Baseline Human Agreement:   ${mitigationResult.comparativeSummary.humanAgreementAccuracy.baseline}`);
  console.log(`  ✓ Mitigated Human Agreement:  ${mitigationResult.comparativeSummary.humanAgreementAccuracy.mitigated}`);
  console.log(`  ✓ Mitigated Position Flips:   ${mitigationResult.comparativeSummary.positionFlipRate.mitigated} (Reduced from ${mitigationResult.comparativeSummary.positionFlipRate.baseline})\n`);

  // Compute final human agreement across baseline
  const humanAgreement = calculateHumanAgreementMetrics(
    posBiasResult.pairedResults.map((r) => ({
      item: JUDGE_BENCHMARK_DATASET.find((d) => d.id === r.itemId),
      decision: r.forwardWinner,
    }))
  );

  const durationMs = Date.now() - overallStartTime;

  // Compile final results payload
  const finalResultsPayload = {
    executedAt: new Date().toISOString(),
    durationMs,
    datasetSize: JUDGE_BENCHMARK_DATASET.length,
    judgeModel: primaryJudge.name + (useLiveGemini ? ' (gemini-1.5-flash)' : ' (deterministic)'),
    promptVersion: 'DevMind-Rubric-v1.0-5D',
    positionBias: posBiasResult.metrics,
    verbosityBias: verbosityResult.metrics,
    selfPreference: selfPrefResult.metrics,
    interJudge: interJudgeResult.metrics,
    humanAgreement,
    repeatability: repeatabilityResult.metrics,
    mitigation: mitigationResult,
  };

  // Generate Reports
  const { reportFile, resultsFile } = generateJudgeEvaluationReport(finalResultsPayload);

  console.log('='.repeat(68));
  console.log('           JUDGE EVALUATION BENCHMARK COMPLETE                   ');
  console.log('='.repeat(68));
  console.log(`  Total Dataset Pairs:      ${JUDGE_BENCHMARK_DATASET.length}`);
  console.log(`  Position Consistency:     ${(posBiasResult.metrics.positionConsistency * 100).toFixed(1)}%`);
  console.log(`  Human Agreement Accuracy: ${(humanAgreement.accuracy * 100).toFixed(1)}%`);
  console.log(`  Mitigated Accuracy:       ${mitigationResult.comparativeSummary.humanAgreementAccuracy.mitigated}`);
  console.log(`  Cohen's Kappa (Inter):    κ = ${interJudgeResult.metrics.kappa}`);
  console.log(`  Written Markdown Report:  ${reportFile}`);
  console.log(`  Written JSON Artifact:    ${resultsFile}`);
  console.log('='.repeat(68) + '\n');

  return finalResultsPayload;
}

// Auto-run if executed directly via CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runJudgeEvaluationBenchmark()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ [BENCHMARK RUNNER ERROR]:', err);
      process.exit(1);
    });
}

