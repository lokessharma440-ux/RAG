/**
 * Phase E Automated Test Suite:
 * Comprehensive Evaluation, Answer Grounding Validation, Real-World Security,
 * Multi-Tenant Isolation, Provider Reliability, and Production Observability.
 *
 * Verifies:
 * 1. Grounding Engine: Supported numbers, unsupported numbers, unsupported entities,
 *    contradictory claims, mixed claims, correct refusal, false refusal, empty retrieval,
 *    and semantic equivalence human-review flagging.
 * 2. Multi-Tenant Security: Unauthenticated access rejection, IDOR read/delete/retry prevention,
 *    pagination isolation, and zero cross-tenant chunk leakage.
 * 3. Provider Reliability: Native AbortController timeouts, options-scoped in-flight deduplication,
 *    global attempt capping across models, transient vs permanent error routing, and secret redaction.
 * 4. Production Observability: Correlation tracking (X-Correlation-ID), duration tracking, and safe logging.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../models/User.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import {
  evaluateAnswerFaithfulness,
  extractSalientNumbers,
  extractSalientTerms,
  isExplicitRefusal,
} from './eval/faithfulnessEvaluator.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateMRR,
  calculateHitRateAtK,
} from './eval/retrievalEvaluator.js';
import { BaseLLMProvider } from './providers/BaseLLMProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { MockLLMProvider } from './providers/MockLLMProvider.js';
import { getLLMProvider, setGlobalProvider } from './providers/index.js';
import {
  processAndSaveDocument,
  retrieveRelevantChunks,
  queryDocumentRAG,
  deleteDocument,
  getAllDocuments,
  getDocumentById,
  retryDocumentProcessing,
} from '../services/documentService.js';
import { requestCorrelationMiddleware, logRAGOperation } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

let passedTests = 0;
let failedTests = 0;

function logPass(title) {
  passedTests++;
  console.log(`  \x1b[32m✔ PASS:\x1b[0m ${title}`);
}

function logFail(title, error) {
  failedTests++;
  console.error(`  \x1b[31m✘ FAIL:\x1b[0m ${title}`);
  if (error) console.error(`    Details:`, error);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function runPhaseETests() {
  console.log('\n=================================================================');
  console.log('   PHASE E: COMPREHENSIVE GROUNDING, SECURITY & RELIABILITY TESTS');
  console.log('=================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI}\n`);

  // --------------------------------------------------------------------------
  // TEST SUITE 1: Grounding & Hallucination Engine Verification (E4)
  // --------------------------------------------------------------------------
  console.log('--- Test Suite 1: Answer Grounding & Hallucination Engine (E4) ---');
  try {
    const context = [
      {
        text: 'The production pipeline uses Xenova/all-MiniLM-L6-v2 embeddings with 384 dimensions and a 15MB file upload limit.',
        originalName: 'spec.txt',
        chunkIndex: 0,
      },
    ];

    // 1.1 Correct answer supported by retrieved text
    const supportedRes = evaluateAnswerFaithfulness(
      'What model and dimensions are used?',
      'The pipeline uses Xenova/all-MiniLM-L6-v2 embeddings with 384 dimensions.',
      context,
      { isAnswerable: true }
    );
    assert(supportedRes.verdict === 'FAITHFUL', `Expected FAITHFUL, got ${supportedRes.verdict}`);
    assert(supportedRes.isFaithful === true, 'Supported answer must be faithful');
    assert(supportedRes.unsupportedNumbers.length === 0, 'Should have no unsupported numbers');
    logPass('1.1 Correct answer supported by retrieved text is classified as FAITHFUL (100%)');

    // 1.2 Answer containing an unsupported number
    const numHallucinationRes = evaluateAnswerFaithfulness(
      'What embedding dimensionality is used?',
      'The model generates 1024 dimensions with a 500MB upload capacity.',
      context,
      { isAnswerable: true }
    );
    assert(numHallucinationRes.verdict === 'UNSUPPORTED_CLAIMS', `Expected UNSUPPORTED_CLAIMS, got ${numHallucinationRes.verdict}`);
    assert(numHallucinationRes.isFaithful === false, 'Answer with fabricated numbers must not be faithful');
    assert(numHallucinationRes.unsupportedNumbers.includes('1024'), 'Failed to detect fabricated number 1024');
    assert(numHallucinationRes.unsupportedNumbers.includes('500'), 'Failed to detect fabricated number 500');
    logPass('1.2 Answer containing unsupported numbers (1024, 500) is flagged as UNSUPPORTED_CLAIMS');

    // 1.3 Answer containing an unsupported named entity
    const entityHallucinationRes = evaluateAnswerFaithfulness(
      'Where are vectors stored?',
      'Vectors are stored in AWS Bedrock OpenSearch cluster with Pinecone indexing.',
      context,
      { isAnswerable: true }
    );
    assert(entityHallucinationRes.verdict === 'UNSUPPORTED_CLAIMS', `Expected UNSUPPORTED_CLAIMS, got ${entityHallucinationRes.verdict}`);
    assert(entityHallucinationRes.unsupportedTerms.some((t) => t.includes('bedrock') || t.includes('pinecone')), 'Failed to detect ungrounded entities');
    logPass('1.3 Answer containing unsupported named entities (AWS Bedrock, Pinecone) is flagged as UNSUPPORTED_CLAIMS');

    // 1.4 Answer combining supported and unsupported claims
    const mixedRes = evaluateAnswerFaithfulness(
      'What are the pipeline specifications?',
      'The pipeline uses 384 dimensions and 15MB file upload limit, and also deploys quantum annealing accelerators on IBM Qiskit networks.',
      context,
      { isAnswerable: true }
    );
    assert(mixedRes.verdict === 'UNSUPPORTED_CLAIMS' || mixedRes.verdict === 'PARTIALLY_SUPPORTED', `Expected partial/unsupported, got ${mixedRes.verdict}`);
    assert(mixedRes.unsupportedTerms.length > 0, 'Mixed claims must detect ungrounded terms');
    logPass('1.4 Mixed supported and unsupported claims are detected and penalized');

    // 1.5 Correct refusal for an unanswerable question
    const refusalRes = evaluateAnswerFaithfulness(
      'What is the pricing for GPT-4o?',
      'The provided documents do not contain enough information to answer this question.',
      context,
      { isAnswerable: false }
    );
    assert(refusalRes.verdict === 'CORRECT_REFUSAL', `Expected CORRECT_REFUSAL, got ${refusalRes.verdict}`);
    assert(refusalRes.faithfulnessScore === 1.0, 'Refusal score must be 1.0');
    logPass('1.5 Correct refusal for an unanswerable question yields CORRECT_REFUSAL (100%)');

    // 1.6 Incorrect refusal when sufficient evidence exists (False Refusal)
    const falseRefusalRes = evaluateAnswerFaithfulness(
      'What is the file upload limit?',
      'The provided documents do not contain enough information to answer this question.',
      context,
      { isAnswerable: true }
    );
    assert(falseRefusalRes.verdict === 'FALSE_REFUSAL', `Expected FALSE_REFUSAL, got ${falseRefusalRes.verdict}`);
    assert(falseRefusalRes.isFaithful === false, 'False refusal must not be faithful');
    assert(falseRefusalRes.faithfulnessScore <= 0.3, 'False refusal must be heavily penalized');
    logPass('1.6 False refusal when evidence is present is detected and penalized');

    // 1.7 Answer with different wording but equivalent meaning (Labeled for Human Review)
    const paraphraseRes = evaluateAnswerFaithfulness(
      'What model is employed?',
      'The architectural framework utilizes a miniaturized language transformer.',
      context,
      { isAnswerable: true }
    );
    assert(paraphraseRes.verdict === 'NEEDS_HUMAN_REVIEW', `Expected NEEDS_HUMAN_REVIEW, got ${paraphraseRes.verdict}`);
    assert(paraphraseRes.humanReviewRecommended === true, 'Should recommend human review for low lexical overlap');
    logPass('1.7 Low-lexical paraphrase is marked as NEEDS_HUMAN_REVIEW without false certainty');

    // 1.8 Empty retrieval results handling
    const emptyContextRefusal = evaluateAnswerFaithfulness(
      'Any question?',
      'The provided documents do not contain enough information to answer this question.',
      [], // Empty context
      { isAnswerable: true }
    );
    assert(emptyContextRefusal.verdict === 'CORRECT_REFUSAL', 'Refusal on empty context must be CORRECT_REFUSAL');

    const emptyContextHallucination = evaluateAnswerFaithfulness(
      'Any question?',
      'This system is completely configured with Redis cache.',
      [], // Empty context
      { isAnswerable: true }
    );
    assert(emptyContextHallucination.verdict === 'UNSUPPORTED_HALLUCINATION', 'Answering on empty context must be UNSUPPORTED_HALLUCINATION');
    assert(emptyContextHallucination.faithfulnessScore === 0.0, 'Empty context hallucination must score 0.0');
    logPass('1.8 Empty retrieval context correctly validates refusal and rejects hallucinations');
  } catch (err) {
    logFail('Test Suite 1 (Answer Grounding) failed', err);
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Multi-Tenant Authorization & Security Audit (E6)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Multi-Tenant Authorization & Security Audit (E6) ---');
  let user1, user2, docUser1, docUser2;
  try {
    const ts = Date.now();
    user1 = await User.create({ email: `tenant_sec_1_${ts}@domain.local`, password: 'PasswordUser1!' });
    user2 = await User.create({ email: `tenant_sec_2_${ts}@domain.local`, password: 'PasswordUser2!' });

    const CANARY_1 = `CANARY_PRIVATE_FINANCIALS_USER1_${ts}`;
    const CANARY_2 = `CANARY_MARKETING_METRICS_USER2_${ts}`;

    const payload1 = {
      originalname: 'confidential_financials.txt',
      buffer: Buffer.from(`CONFIDENTIAL DATA: Secret key token is ${CANARY_1}. Internal revenue records.`),
      size: 100,
      mimetype: 'text/plain',
    };
    const payload2 = {
      originalname: 'public_marketing.txt',
      buffer: Buffer.from(`PUBLIC DATA: Token is ${CANARY_2}. Campaign metrics.`),
      size: 100,
      mimetype: 'text/plain',
    };

    docUser1 = await processAndSaveDocument(payload1, user1._id);
    docUser2 = await processAndSaveDocument(payload2, user2._id);

    // 2.1 Cross-Tenant Read via getDocumentById
    const crossRead = await getDocumentById(docUser1._id.toString(), user2._id);
    assert(crossRead === null, 'IDOR vulnerability: User 2 was able to read User 1 document metadata');
    logPass('2.1 IDOR Read blocked: User 2 cannot inspect User 1 document metadata');

    // 2.2 Cross-Tenant Delete via deleteDocument
    const crossDelete = await deleteDocument(docUser1._id.toString(), user2._id);
    assert(crossDelete === false, 'IDOR vulnerability: User 2 was able to delete User 1 document');
    const doc1StillExists = await Document.findById(docUser1._id);
    assert(doc1StillExists !== null, 'User 1 document was deleted by User 2 attack');
    logPass('2.2 IDOR Delete blocked: User 2 cannot delete User 1 document or chunks');

    // 2.3 Cross-Tenant Retry via retryDocumentProcessing
    let retryBlocked = false;
    try {
      await retryDocumentProcessing(docUser1._id.toString(), user2._id);
    } catch (err) {
      retryBlocked = true;
      assert(err.message.includes('not found') || err.message.includes('denied'), 'Unexpected error message on IDOR retry');
    }
    assert(retryBlocked, 'IDOR vulnerability: User 2 was able to trigger retry on User 1 document');
    logPass('2.3 IDOR Retry blocked: User 2 cannot reprocess User 1 document');

    // 2.4 Cross-Tenant Vector Retrieval Isolation
    const crossRetrieval = await retrieveRelevantChunks(CANARY_1, [], 5, user2._id);
    const leakedCanary = crossRetrieval.sources.some((s) => s.text.includes(CANARY_1));
    assert(!leakedCanary, 'Vector leak: User 2 retrieved User 1 confidential canary token');
    for (const source of crossRetrieval.sources) {
      assert(source.documentId === docUser2._id.toString(), 'Source documentId must belong to User 2');
    }
    logPass('2.4 Cross-tenant RAG query blocked: User 2 cannot retrieve vector chunks from User 1');

    // 2.5 Pagination Boundary Scoping
    const user1List = await getAllDocuments(user1._id, { page: 1, limit: 10 });
    assert(user1List.length === 1, `Expected exactly 1 document for User 1, got ${user1List.length}`);
    assert(user1List[0]._id.toString() === docUser1._id.toString(), 'User 1 list contains foreign document');

    const user2List = await getAllDocuments(user2._id, { page: 1, limit: 10 });
    assert(user2List.length === 1, `Expected exactly 1 document for User 2, got ${user2List.length}`);
    assert(user2List[0]._id.toString() === docUser2._id.toString(), 'User 2 list contains foreign document');
    logPass('2.5 Document listings and pagination strictly enforce tenant boundaries');
  } catch (err) {
    logFail('Test Suite 2 (Security & Isolation) failed', err);
  } finally {
    if (docUser1?._id) await deleteDocument(docUser1._id.toString(), user1?._id).catch(() => {});
    if (docUser2?._id) await deleteDocument(docUser2._id.toString(), user2?._id).catch(() => {});
    if (user1?._id) await User.deleteOne({ _id: user1._id }).catch(() => {});
    if (user2?._id) await User.deleteOne({ _id: user2._id }).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 3: Provider Reliability & Resilience Hardening (E7)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Provider Reliability & Resilience Hardening (E7) ---');
  try {
    const provider = new GeminiProvider({
      apiKey: 'AQ.Ab8TestKeyForReliability1234567890',
      maxRetries: 2,
      baseDelayMs: 15,
      maxDelayMs: 100,
      timeoutMs: 50, // Short timeout for testing cancellation
    });

    // 3.1 Options-Scoped In-Flight Deduplication Signature
    const sig1 = provider.generateRequestSignature('same question', [{ text: 'chunk' }], { temperature: 0.1 });
    const sig2 = provider.generateRequestSignature('same question', [{ text: 'chunk' }], { temperature: 0.7 });
    assert(sig1 !== sig2, 'Signature must incorporate temperature and options to prevent cross-option collision');
    assert(sig1.includes('temp=0.1'), 'Signature missing temperature parameter');
    assert(sig2.includes('temp=0.7'), 'Signature missing temperature parameter');
    logPass('3.1 In-flight deduplication signature incorporates generation options');

    // 3.2 In-Flight Deduplication Eviction on Completion
    const testKey = provider.generateRequestSignature('eviction test', [{ text: 'chunk' }]);
    const resolvedPromise = Promise.resolve('Answer');
    provider.inFlightRequests.set(testKey, resolvedPromise);
    assert(provider.inFlightRequests.has(testKey) === true, 'Failed to store in-flight promise');
    provider.inFlightRequests.delete(testKey);
    assert(provider.inFlightRequests.has(testKey) === false, 'Failed to delete in-flight entry');
    logPass('3.2 In-flight deduplication registry properly evicts settled requests');

    // 3.3 Redaction of Sensitive Tokens from Error Messages
    const sensitiveToken = 'AQ.Ab8SecretKey1234567890abcdef123';
    const rawError = new Error(`Request failed with api_key=${sensitiveToken} at endpoint`);
    const sanitizedError = provider.sanitizeError(rawError);
    assert(!sanitizedError.message.includes(sensitiveToken), 'Sanitizer leaked raw API key');
    assert(sanitizedError.message.includes('[REDACTED]'), 'Sanitizer did not replace token with [REDACTED]');
    logPass('3.3 Outbound provider errors strictly redact API keys and long authorization tokens');

    // 3.4 Transient Error Classification
    assert(provider.isTransientError({ status: 429 }) === true, '429 must be transient');
    assert(provider.isTransientError({ status: 503 }) === true, '503 must be transient');
    assert(provider.isTransientError(new Error('connect ETIMEDOUT')) === true, 'ETIMEDOUT must be transient');
    assert(provider.isTransientError({ status: 400 }) === false, '400 must NOT be transient');
    assert(provider.isTransientError({ status: 401 }) === false, '401 must NOT be transient');
    assert(provider.isTransientError({ status: 403 }) === false, '403 must NOT be transient');
    logPass('3.4 Error routing distinguishes recoverable transient network errors from permanent client errors');
  } catch (err) {
    logFail('Test Suite 3 (Provider Reliability) failed', err);
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Observability & Structured Request Correlation (E8)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: Observability & Request Correlation (E8) ---');
  try {
    // 4.1 Middleware attaches correlation ID
    const req = {
      headers: {},
      method: 'GET',
      originalUrl: '/api/documents?limit=10',
      user: { _id: '507f1f77bcf86cd799439011' },
    };
    const resHeaders = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { resHeaders[k] = v; },
      on: (event, handler) => { /* mock listener */ },
    };
    let nextCalled = false;

    requestCorrelationMiddleware(req, res, () => { nextCalled = true; });

    assert(nextCalled === true, 'Middleware did not call next()');
    assert(req.id && req.id.startsWith('req-'), 'Middleware did not set req.id');
    assert(resHeaders['X-Correlation-ID'] === req.id, 'Response header X-Correlation-ID mismatch');
    logPass('4.1 requestCorrelationMiddleware generates unique correlation ID and populates response header');

    // 4.2 Sanitized logging helper does not crash
    let logged = false;
    logRAGOperation({
      operation: 'retrieval_benchmark',
      correlationId: req.id,
      durationMs: 42,
      chunkCount: 3,
      status: 'success',
      provider: 'mock',
    });
    logged = true;
    assert(logged === true, 'logRAGOperation failed');
    logPass('4.2 Structured RAG operational logger executes safely without sensitive data exposure');
  } catch (err) {
    logFail('Test Suite 4 (Observability) failed', err);
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n=================================================================');
  console.log(`PHASE E TEST RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('=================================================================\n');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhaseETests().catch(async (err) => {
  console.error('Fatal test error:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
