/**
 * Phase E Benchmark Runner:
 * Executes Retrieval Evaluation (Precision@K, Recall@K, MRR, Hit Rate)
 * for both K = 3 and K = 4, category-by-category breakdowns,
 * and Answer Faithfulness Evaluation across the expanded 24-item dataset.
 *
 * Usage:
 *   node backend/RAG/runEvaluation.js
 *   RUN_LIVE_GEMINI_EVAL=true node backend/RAG/runEvaluation.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { EVAL_DOCUMENTS, EVAL_DATASET } from './eval/dataset.js';
import { evaluateRetrievalDataset } from './eval/retrievalEvaluator.js';
import { evaluateDatasetFaithfulness } from './eval/faithfulnessEvaluator.js';
import {
  processAndSaveDocument,
  retrieveRelevantChunks,
  deleteDocument,
} from '../services/documentService.js';
import { User } from '../models/User.js';
import { getLLMProvider, setGlobalProvider } from './providers/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

export async function runEvaluationBenchmark() {
  console.log('\n=================================================================');
  console.log('   PHASE E: EXPANDED RETRIEVAL EVALUATION & FAITHFULNESS BENCHMARK');
  console.log('=================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI}`);

  // Create temporary evaluation user
  const evalUserEmail = `eval_benchmark_${Date.now()}@testdomain.local`;
  const evalUser = await User.create({
    email: evalUserEmail,
    password: 'EvalPassword2026!',
  });
  console.log(`Created benchmark user: ${evalUser.email}`);

  const useLiveGemini = process.env.RUN_LIVE_GEMINI_EVAL === 'true' && !!process.env.GEMINI_API_KEY;
  const provider = getLLMProvider(useLiveGemini ? 'gemini' : 'mock');
  setGlobalProvider(provider);
  console.log(`Active Evaluation LLM Provider: ${provider.name.toUpperCase()} (Live: ${useLiveGemini})\n`);

  const createdDocRecords = [];

  try {
    // 1. Ingest all evaluation reference documents
    console.log('[Step 1/4] Ingesting evaluation reference documents...');
    for (const docSpec of EVAL_DOCUMENTS) {
      const filePayload = {
        originalname: docSpec.originalName,
        buffer: Buffer.from(docSpec.text, 'utf-8'),
        size: Buffer.byteLength(docSpec.text),
        mimetype: 'text/plain',
      };
      const rec = await processAndSaveDocument(filePayload, evalUser._id);
      createdDocRecords.push(rec);
      console.log(`  ✓ Indexed: ${docSpec.originalName} (ID: ${rec._id}, Chunks: ${rec.chunkCount})`);
    }
    console.log('');

    const docIds = createdDocRecords.map((d) => d._id.toString());
    const retrievalFn = async (query, k) => {
      const res = await retrieveRelevantChunks(query, docIds, k, evalUser._id);
      return res.sources || [];
    };

    // 2. Evaluate Information Retrieval metrics at K = 3 and K = 4
    console.log('[Step 2/4] Running Retrieval Evaluation comparison (K = 3 vs K = 4)...');
    const retrievalK3 = await evaluateRetrievalDataset(EVAL_DATASET, retrievalFn, 3);
    const retrievalK4 = await evaluateRetrievalDataset(EVAL_DATASET, retrievalFn, 4);

    console.log('\n' + '='.repeat(68));
    console.log('           RETRIEVAL METRICS COMPARISON (K=3 vs K=4)            ');
    console.log('='.repeat(68));
    console.log(`  Metric                      |   K = 3       |   K = 4       `);
    console.log('-'.repeat(68));
    console.log(`  Precision@K                 |   ${(retrievalK3.metrics.precisionAtK * 100).toFixed(1).padStart(5)}%      |   ${(retrievalK4.metrics.precisionAtK * 100).toFixed(1).padStart(5)}%      `);
    console.log(`  Recall@K                    |   ${(retrievalK3.metrics.recallAtK * 100).toFixed(1).padStart(5)}%      |   ${(retrievalK4.metrics.recallAtK * 100).toFixed(1).padStart(5)}%      `);
    console.log(`  Mean Reciprocal Rank (MRR)  |   ${retrievalK3.metrics.mrr.toFixed(4).padStart(7)}     |   ${retrievalK4.metrics.mrr.toFixed(4).padStart(7)}     `);
    console.log(`  Hit Rate@K                  |   ${(retrievalK3.metrics.hitRateAtK * 100).toFixed(1).padStart(5)}%      |   ${(retrievalK4.metrics.hitRateAtK * 100).toFixed(1).padStart(5)}%      `);
    console.log(`  False Positive Retrieval    |   ${(retrievalK3.metrics.falsePositiveRetrievalRate * 100).toFixed(1).padStart(5)}%      |   ${(retrievalK4.metrics.falsePositiveRetrievalRate * 100).toFixed(1).padStart(5)}%      `);
    console.log(`  Evaluated Queries           |   ${String(retrievalK3.totalQueries).padStart(3)} queries  |   ${String(retrievalK4.totalQueries).padStart(3)} queries  `);
    console.log(`  (Answerable / Unanswerable) |   (${retrievalK3.answerableQueries} / ${retrievalK3.unanswerableQueries})       |   (${retrievalK4.answerableQueries} / ${retrievalK4.unanswerableQueries})       `);
    console.log('='.repeat(68) + '\n');

    // Category breakdown at K = 4
    console.log('--- RETRIEVAL CATEGORY BREAKDOWN (K = 4) ---');
    console.log('CATEGORY                     TOTAL  ANS  UNANS   P@4     R@4     MRR     HIT@4');
    console.log('-'.repeat(75));
    for (const [catName, c] of Object.entries(retrievalK4.categoryBreakdown)) {
      const p = c.precisionAtK !== null ? `${(c.precisionAtK * 100).toFixed(0)}%` : 'N/A';
      const r = c.recallAtK !== null ? `${(c.recallAtK * 100).toFixed(0)}%` : 'N/A';
      const mrr = c.mrr > 0 ? c.mrr.toFixed(2) : 'N/A';
      const hit = c.hitRateAtK > 0 ? `${(c.hitRateAtK * 100).toFixed(0)}%` : (c.unanswerableQueries > 0 ? 'N/A' : '0%');
      console.log(
        `${catName.padEnd(28)} ${String(c.totalQueries).padEnd(6)} ${String(c.answerableQueries).padEnd(4)} ${String(c.unanswerableQueries).padEnd(7)} ${p.padEnd(7)} ${r.padEnd(7)} ${mrr.padEnd(7)} ${hit}`
      );
    }
    console.log('-'.repeat(75) + '\n');

    // 3. Run Answer Faithfulness Evaluation
    console.log('[Step 3/4] Generating answers and assessing faithfulness across dataset...');
    const faithfulnessInputs = [];

    for (const item of EVAL_DATASET) {
      const retrieved = await retrievalFn(item.question, 4);
      const answer = await provider.generateAnswer(item.question, retrieved);
      faithfulnessInputs.push({
        id: item.id,
        question: item.question,
        answer,
        sources: retrieved,
        evalItem: item,
      });
    }

    const faithfulnessResults = evaluateDatasetFaithfulness(faithfulnessInputs);

    console.log('\n--- FAITHFULNESS METRICS SUMMARY ---');
    console.log(`  Total Queries Evaluated:        ${faithfulnessResults.totalEvaluated}`);
    console.log(`  Mean Faithfulness Score:        ${(faithfulnessResults.meanFaithfulnessScore * 100).toFixed(1)}%`);
    console.log(`  Overall Faithfulness Rate:      ${(faithfulnessResults.overallFaithfulnessRate * 100).toFixed(1)}%`);
    console.log(`  Unanswerable Refusal Accuracy:  ${(faithfulnessResults.unanswerableRefusalAccuracy * 100).toFixed(1)}%\n`);

    // 4. Detailed Per-Query Table
    console.log('='.repeat(110));
    console.log('ID       CATEGORY                      P@4    R@4    HIT    VERDICT                   FAITHFULNESS');
    console.log('='.repeat(110));

    faithfulnessResults.results.forEach((r, idx) => {
      const retItem = retrievalK4.results[idx]?.metrics;
      const p4 = retItem?.precision !== null && retItem?.precision !== undefined ? `${(retItem.precision * 100).toFixed(0)}%` : 'N/A';
      const r4 = retItem?.recall !== null && retItem?.recall !== undefined ? `${(retItem.recall * 100).toFixed(0)}%` : 'N/A';
      const hit = retItem?.isAnswerable ? (retItem.hit ? 'YES' : 'NO') : 'N/A';
      const verdict = r.evaluation.verdict.padEnd(25);
      const faithScore = `${(r.evaluation.faithfulnessScore * 100).toFixed(0)}%`;

      console.log(
        `${r.id.padEnd(8)} ${r.category.padEnd(29)} ${p4.padEnd(6)} ${r4.padEnd(6)} ${hit.padEnd(6)} ${verdict} ${faithScore}`
      );
    });
    console.log('='.repeat(110));

    return {
      retrievalK3,
      retrievalK4,
      faithfulness: faithfulnessResults,
    };
  } finally {
    // Clean up all benchmark documents
    for (const rec of createdDocRecords) {
      await deleteDocument(rec._id.toString(), evalUser._id).catch(() => {});
    }
    await User.deleteOne({ _id: evalUser._id }).catch(() => {});
    await mongoose.disconnect();
    console.log('\nCleaned up all benchmark database artifacts and disconnected.\n');
  }
}

// Allow running directly
if (process.argv[1] && process.argv[1].endsWith('runEvaluation.js')) {
  runEvaluationBenchmark().catch((err) => {
    console.error('Benchmark execution error:', err);
    process.exit(1);
  });
}
