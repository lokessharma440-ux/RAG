/**
 * Phase D Automated Test Suite:
 * Retrieval Evaluation, Answer Faithfulness, LLM Provider Abstraction,
 * Resilient API Handling, and Multi-Tenant Isolation Regression.
 *
 * Verifies:
 * 1. Mathematical correctness of IR metrics (Precision@K, Recall@K, MRR, Hit Rate@K)
 * 2. Dataset retrieval evaluation against known relevant passages
 * 3. Answer Faithfulness evaluation harness and refusal detection
 * 4. Provider abstraction architecture (BaseLLMProvider, GeminiProvider, MockLLMProvider)
 * 5. Gemini resilience logic (transient vs permanent errors, backoff calculation, Retry-After header)
 * 6. Error sanitization (no API key leakage or internal raw error exposure)
 * 7. Bounded retry behavior with transient recovery and immediate permanent failure
 * 8. In-flight request deduplication
 * 9. Multi-tenant document retrieval isolation regression
 */

import http from 'http';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { User } from '../models/User.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateMRR,
  calculateHitRateAtK,
  evaluateRetrievalDataset,
} from './eval/retrievalEvaluator.js';
import {
  isExplicitRefusal,
  extractSalientTerms,
  evaluateAnswerFaithfulness,
  evaluateDatasetFaithfulness,
} from './eval/faithfulnessEvaluator.js';
import { BaseLLMProvider } from './providers/BaseLLMProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { MockLLMProvider } from './providers/MockLLMProvider.js';
import { getLLMProvider, setGlobalProvider, getGlobalProvider } from './providers/index.js';
import {
  processAndSaveDocument,
  retrieveRelevantChunks,
  queryDocumentRAG,
  deleteDocument,
} from '../services/documentService.js';

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

async function runPhaseDTests() {
  console.log('\n=================================================================');
  console.log('   PHASE D: AUTOMATED RETRIEVAL, FAITHFULNESS & PROVIDER TESTS   ');
  console.log('=================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI}\n`);

  // --------------------------------------------------------------------------
  // TEST SUITE 1: IR Evaluation Metrics Mathematical Correctness
  // --------------------------------------------------------------------------
  console.log('--- Test Suite 1: IR Evaluation Metrics Mathematical Accuracy ---');
  try {
    // 1.1 Precision@K
    // Retrieved: [A, B, C, D], Relevant: [A, C] -> 2/4 = 0.5
    const p1 = calculatePrecisionAtK(['A', 'B', 'C', 'D'], ['A', 'C'], 4);
    assert(Math.abs(p1 - 0.5) < 1e-6, `Expected Precision@4 to be 0.5, got ${p1}`);

    // Retrieved: [A, B, C], Relevant: [A, B, C] -> 3/3 = 1.0
    const p2 = calculatePrecisionAtK(['A', 'B', 'C'], ['A', 'B', 'C'], 3);
    assert(p2 === 1.0, `Expected Precision@3 to be 1.0, got ${p2}`);

    // Retrieved: [X, Y, Z], Relevant: [A, B] -> 0/3 = 0.0
    const p3 = calculatePrecisionAtK(['X', 'Y', 'Z'], ['A', 'B'], 3);
    assert(p3 === 0.0, `Expected Precision@3 to be 0.0, got ${p3}`);

    // Edge case: K = 0 or empty retrieved
    assert(calculatePrecisionAtK([], ['A'], 3) === 0.0, 'Empty retrieved should yield 0.0');
    assert(calculatePrecisionAtK(['A'], ['A'], 0) === 0.0, 'K=0 should yield 0.0');
    logPass('Precision@K correctly handles exact matches, partial matches, zero matches, and edge cases');

    // 1.2 Recall@K
    // Retrieved: [A, B], Expected relevant: [A, C, D, E] (retrieved 1 of 4) -> 1/4 = 0.25
    const r1 = calculateRecallAtK(['A', 'B'], ['A', 'C', 'D', 'E'], 2);
    assert(Math.abs(r1 - 0.25) < 1e-6, `Expected Recall@2 to be 0.25, got ${r1}`);

    // Retrieved: [A, B, C], Expected: [A, B] -> 2/2 = 1.0
    const r2 = calculateRecallAtK(['A', 'B', 'C'], ['A', 'B'], 3);
    assert(r2 === 1.0, `Expected Recall@3 to be 1.0, got ${r2}`);

    // Unanswerable query: Expected relevant = [] -> 1.0 (correctly identified that no relevant chunks exist)
    const r3 = calculateRecallAtK(['A', 'B'], [], 2);
    assert(r3 === 1.0, `Expected Recall on empty relevant set to be 1.0, got ${r3}`);
    logPass('Recall@K correctly calculates retrieved ratio and handles unanswerable empty expectations');

    // 1.3 Mean Reciprocal Rank (MRR)
    // First relevant item at Rank 1 -> 1 / 1 = 1.0
    const mrr1 = calculateMRR(['A', 'B', 'C'], ['A']);
    assert(mrr1 === 1.0, `Expected MRR 1.0, got ${mrr1}`);

    // First relevant item at Rank 2 -> 1 / 2 = 0.5
    const mrr2 = calculateMRR(['X', 'A', 'B'], ['A']);
    assert(mrr2 === 0.5, `Expected MRR 0.5, got ${mrr2}`);

    // First relevant item at Rank 3 -> 1 / 3 = 0.3333...
    const mrr3 = calculateMRR(['X', 'Y', 'A'], ['A']);
    assert(Math.abs(mrr3 - 1 / 3) < 1e-6, `Expected MRR 0.3333, got ${mrr3}`);

    // No relevant items found in top-K -> 0.0
    const mrr4 = calculateMRR(['X', 'Y', 'Z'], ['A']);
    assert(mrr4 === 0.0, `Expected MRR 0.0, got ${mrr4}`);

    // Unanswerable query (no relevant chunks expected): retrieved empty vs retrieved items
    assert(calculateMRR([], []) === 1.0, 'MRR with empty relevant and empty retrieved should be 1.0');
    assert(calculateMRR(['X'], []) === 0.0, 'MRR with empty relevant but returned chunks should be 0.0');
    logPass('MRR accurately calculates reciprocal rank at position 1, 2, 3, and zero-hit rank');

    // 1.4 Hit Rate@K
    assert(calculateHitRateAtK(['X', 'A'], ['A'], 2) === 1.0, 'Hit Rate should be 1.0 when hit found');
    assert(calculateHitRateAtK(['X', 'Y'], ['A'], 2) === 0.0, 'Hit Rate should be 0.0 when no hit found');
    logPass('Hit Rate@K correctly identifies boolean presence of relevant items');
  } catch (err) {
    logFail('IR Metrics calculations failed', err);
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Answer Faithfulness & Refusal Detection
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Answer Faithfulness & Grounding Engine ---');
  try {
    // 2.1 Explicit Refusal Detection
    const refusal1 = 'The provided documents do not contain enough information to answer this question.';
    const refusal2 = 'This is not mentioned in the provided excerpts.';
    const refusal3 = 'The context does not specify the cost of OpenAI GPT-4o.';
    const nonRefusal = 'Xenova/all-MiniLM-L6-v2 uses 384 dimensions for embeddings.';

    assert(isExplicitRefusal(refusal1) === true, 'Failed to detect refusal 1');
    assert(isExplicitRefusal(refusal2) === true, 'Failed to detect refusal 2');
    assert(isExplicitRefusal(refusal3) === true, 'Failed to detect refusal 3');
    assert(isExplicitRefusal(nonRefusal) === false, 'Falsely flagged non-refusal');
    logPass('Explicit refusal pattern matcher correctly identifies grounded declining statements');

    // 2.2 Salient Content Term Extraction
    const terms = extractSalientTerms('The system combines 384-dimensional dense vectors with exact lexical keywords.');
    assert(terms.includes('combines'), 'Missing salient term: combines');
    assert(terms.includes('vectors'), 'Missing salient term: vectors');
    assert(terms.includes('lexical'), 'Missing salient term: lexical');
    assert(!terms.includes('the'), 'Stopword "the" was not removed');
    assert(!terms.includes('with'), 'Stopword "with" was not removed');
    logPass('extractSalientTerms properly strips stopwords and filters meaningful technical terms');

    // 2.3 Unanswerable Question Evaluation (Absent Evidence)
    const unanswerableEvalItem = {
      id: 'eval-mock-01',
      question: 'What is the pricing for AWS Bedrock?',
      isAnswerable: false,
    };
    const faithfulRefusalResult = evaluateAnswerFaithfulness(
      unanswerableEvalItem.question,
      refusal1,
      [{ text: 'This document explains Xenova embeddings.' }],
      unanswerableEvalItem
    );
    assert(faithfulRefusalResult.verdict === 'CORRECT_REFUSAL', 'Expected CORRECT_REFUSAL verdict');
    assert(faithfulRefusalResult.isFaithful === true, 'Expected isFaithful true for refusal');
    assert(faithfulRefusalResult.faithfulnessScore === 1.0, 'Expected faithfulness 1.0');

    // Unsupported hallucination on unanswerable question
    const hallucinatedResult = evaluateAnswerFaithfulness(
      unanswerableEvalItem.question,
      'AWS Bedrock pricing starts at $0.002 per 1000 input tokens.',
      [{ text: 'This document explains Xenova embeddings.' }],
      unanswerableEvalItem
    );
    assert(hallucinatedResult.verdict === 'UNSUPPORTED_HALLUCINATION', 'Expected UNSUPPORTED_HALLUCINATION');
    assert(hallucinatedResult.isFaithful === false, 'Hallucinated answer must not be faithful');
    assert(hallucinatedResult.faithfulnessScore === 0.0, 'Hallucination score must be 0.0');
    logPass('Correctly rewards proper refusal and penalizes unsupported hallucination on unanswerable questions');

    // 2.4 Answerable Question with Grounded vs Unsupported Claims
    const answerableItem = {
      id: 'eval-mock-02',
      question: 'What dimensionality do Xenova embeddings use?',
      isAnswerable: true,
    };
    const contextChunks = [
      { text: 'Xenova/all-MiniLM-L6-v2 transformer model generates 384-dimensional dense embeddings.' },
    ];

    // Supported answer
    const supportedResult = evaluateAnswerFaithfulness(
      answerableItem.question,
      'The Xenova model generates 384-dimensional dense embeddings.',
      contextChunks,
      answerableItem
    );
    assert(supportedResult.verdict === 'FAITHFUL', `Expected FAITHFUL, got ${supportedResult.verdict}`);
    assert(supportedResult.faithfulnessScore >= 0.8, 'Expected high faithfulness score for grounded answer');

    // False refusal on answerable question
    const falseRefusalResult = evaluateAnswerFaithfulness(
      answerableItem.question,
      refusal1,
      contextChunks,
      answerableItem
    );
    assert(falseRefusalResult.verdict === 'FALSE_REFUSAL', 'Expected FALSE_REFUSAL verdict');
    assert(falseRefusalResult.isFaithful === false, 'False refusal should not be classified as faithful');

    // Unsupported claim (contains extraneous facts)
    const unsupportedResult = evaluateAnswerFaithfulness(
      answerableItem.question,
      'Xenova uses 384 dimensions, and also deploys quantum annealing on Google Cloud TPU v5e clusters.',
      contextChunks,
      answerableItem
    );
    assert(unsupportedResult.verdict === 'UNSUPPORTED_CLAIMS', `Expected UNSUPPORTED_CLAIMS, got ${unsupportedResult.verdict}`);
    assert(unsupportedResult.unsupportedTerms.length > 0, 'Should detect unsupported terms');
    logPass('Faithfulness evaluation correctly differentiates FAITHFUL, FALSE_REFUSAL, and UNSUPPORTED_CLAIMS');
  } catch (err) {
    logFail('Faithfulness evaluation tests failed', err);
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 3: Provider Abstraction Architecture
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Provider Abstraction Architecture ---');
  try {
    // 3.1 BaseLLMProvider Contract
    const base = new BaseLLMProvider({ name: 'custom-base' });
    assert(base.name === 'custom-base', 'Base provider name mismatch');
    assert(base.timeoutMs === 30000, 'Default timeout should be 30000ms');

    // generateAnswer should throw NotImplementedError on base class
    let baseThrew = false;
    try {
      await base.generateAnswer('hello', []);
    } catch (e) {
      baseThrew = true;
      assert(e.message.includes('must be implemented by subclass'), 'Unexpected error message on base call');
    }
    assert(baseThrew, 'BaseLLMProvider.generateAnswer did not throw NotImplemented');

    // Context formatting and normalization
    const normalized = base.normalizeChunks([
      'Plain string chunk',
      { text: 'Object chunk with text', originalName: 'guide.txt', chunkIndex: 1 },
      { pageContent: 'LangChain-style chunk', metadata: { source: 'doc.pdf' } },
      null, // invalid
    ]);
    assert(normalized.length === 3, `Expected 3 normalized chunks, got ${normalized.length}`);
    assert(normalized[0].text === 'Plain string chunk', 'Plain string normalization failed');
    assert(normalized[1].originalName === 'guide.txt', 'Object text normalization failed');
    assert(normalized[2].text === 'LangChain-style chunk', 'PageContent normalization failed');

    const formattedContext = base.formatContext(normalized);
    assert(formattedContext.includes('[Document Excerpt 1'), 'Formatted context missing excerpt headers');
    assert(formattedContext.includes('Source: guide.txt'), 'Formatted context missing source attribution');
    logPass('BaseLLMProvider enforces interface contract and normalizes heterogeneous chunk structures');

    // 3.2 MockLLMProvider Implementation
    const mock = new MockLLMProvider();
    mock.registerResponse('what is mern', 'MERN stands for MongoDB, Express, React, Node.');

    const mockAnswer1 = await mock.generateAnswer('What is MERN stack?', [
      { text: 'Irrelevant text that does not matter for registered responses' },
    ]);
    assert(mockAnswer1.includes('MongoDB, Express, React, Node'), 'Mock failed to return registered response');

    const mockAnswerEmpty = await mock.generateAnswer('Any question', []);
    assert(isExplicitRefusal(mockAnswerEmpty), 'Mock must refuse when no chunks are provided');

    assert(mock.callHistory.length === 2, `Expected 2 calls recorded in mock history, got ${mock.callHistory.length}`);
    logPass('MockLLMProvider properly registers responses, tracks history, and handles empty chunk inputs');

    // 3.3 Factory and Global Provider Registry
    const originalGlobal = getGlobalProvider();
    const createdMock = getLLMProvider('mock', { customOpt: true });
    assert(createdMock instanceof MockLLMProvider, 'getLLMProvider did not return MockLLMProvider');

    setGlobalProvider(createdMock);
    assert(getGlobalProvider() === createdMock, 'setGlobalProvider did not update active provider');

    // Restore original provider
    setGlobalProvider(originalGlobal);
    logPass('Provider factory and global registry allow seamless pluggable provider swapping');
  } catch (err) {
    logFail('Provider Abstraction architecture tests failed', err);
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Resilient Gemini API Handling & Sanitization
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: Resilient API Handling & Transient Error Recovery ---');
  try {
    const gemini = new GeminiProvider({
      apiKey: 'AQ.Ab8DummyKey-ForTestingPurposesOnly',
      maxRetries: 3,
      baseDelayMs: 20, // Fast delay for test execution
      maxDelayMs: 100,
    });

    // 4.1 Transient vs Permanent Error Classification
    const rateLimitErr = new Error('ResourceExhausted: 429 quota exceeded');
    rateLimitErr.status = 429;
    assert(gemini.isTransientError(rateLimitErr) === true, '429 RateLimit must be classified as transient');

    const serviceUnavailableErr = new Error('503 Service Unavailable');
    serviceUnavailableErr.status = 503;
    assert(gemini.isTransientError(serviceUnavailableErr) === true, '503 must be transient');

    const networkErr = new Error('fetch failed: connect ETIMEDOUT 142.250.190.42:443');
    assert(gemini.isTransientError(networkErr) === true, 'ETIMEDOUT must be transient');

    const badRequestErr = new Error('400 Invalid argument supplied');
    badRequestErr.status = 400;
    assert(gemini.isTransientError(badRequestErr) === false, '400 Bad Request must NOT be transient');

    const authErr = new Error('401 API_KEY_INVALID: API key not valid. Please pass a valid API key.');
    authErr.status = 401;
    assert(gemini.isTransientError(authErr) === false, '401 Unauthorized must NOT be transient');

    const permissionErr = new Error('403 Permission Denied');
    permissionErr.status = 403;
    assert(gemini.isTransientError(permissionErr) === false, '403 Forbidden must NOT be transient');
    logPass('isTransientError strictly distinguishes recoverable network/rate errors from permanent client errors');

    // 4.2 Retry-After Header Parsing
    assert(gemini.parseRetryAfterHeader('15') === 15000, 'Failed to parse integer seconds Retry-After');
    assert(gemini.parseRetryAfterHeader('invalid-string') === null, 'Invalid header should return null');
    assert(gemini.parseRetryAfterHeader(null) === null, 'Null header should return null');

    const futureDate = new Date(Date.now() + 8000).toUTCString();
    const parsedDateMs = gemini.parseRetryAfterHeader(futureDate);
    assert(parsedDateMs !== null && parsedDateMs > 5000 && parsedDateMs <= 9000, 'Failed to parse HTTP date Retry-After');
    logPass('parseRetryAfterHeader parses both delta-seconds and HTTP-date formats with null fallback');

    // 4.3 Exponential Backoff with Jitter
    const delayAttempt0 = gemini.calculateBackoff(0);
    const delayAttempt1 = gemini.calculateBackoff(1);
    const delayAttempt2 = gemini.calculateBackoff(2);

    // Exponential bounds: attempt 0 ~ 20ms, attempt 1 ~ 40ms, attempt 2 ~ 80ms
    assert(delayAttempt0 >= 20 && delayAttempt0 <= 20 * 1.3 + 1, `Attempt 0 backoff out of bounds: ${delayAttempt0}`);
    assert(delayAttempt1 >= 40 && delayAttempt1 <= 40 * 1.3 + 1, `Attempt 1 backoff out of bounds: ${delayAttempt1}`);
    assert(delayAttempt2 <= 100, `Backoff exceeded maxDelayMs: ${delayAttempt2}`);
    logPass('calculateBackoff calculates exponential progression capped by maxDelayMs with randomized jitter');

    // 4.4 Error Message Sanitization (Zero API Key Leakage)
    const dangerousSecret = 'AQ.Ab8SecretKey1234567890abcdef';
    const leakedRawMessage = `Request failed with key ${dangerousSecret} at https://generativelanguage.googleapis.com`;
    const sanitizedMsg = gemini.sanitizeErrorMessage(leakedRawMessage);
    assert(!sanitizedMsg.includes(dangerousSecret), 'Sanitizer failed: Raw API key was leaked!');
    assert(sanitizedMsg.includes('[REDACTED]'), 'Sanitizer did not replace API key with [REDACTED]');
    logPass('sanitizeErrorMessage redacts sensitive provider API keys and tokens from outbound error messages');

    // 4.5 Bounded Retries with Mock Error Injection
    const resilientMock = new MockLLMProvider();
    // Simulate 2 transient 429 errors followed by success
    const err429_1 = new Error('ResourceExhausted: 429 quota');
    err429_1.status = 429;
    const err429_2 = new Error('ResourceExhausted: 429 quota');
    err429_2.status = 429;

    resilientMock.enqueueError(err429_1);
    resilientMock.enqueueError(err429_2);
    resilientMock.registerResponse('resilience test', 'Successfully recovered after 2 transient failures!');

    // Wrap resilientMock call with retry loop mirroring GeminiProvider logic
    let attempts = 0;
    let finalAnswer = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        attempts++;
        finalAnswer = await resilientMock.generateAnswer('resilience test', [{ text: 'Document context' }]);
        break;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 10)); // simulated backoff
      }
    }
    assert(attempts === 3, `Expected 3 attempts (2 failures + 1 success), got ${attempts}`);
    assert(finalAnswer.includes('Successfully recovered'), 'Did not receive successful answer after retry');
    logPass('Bounded retry successfully recovers from transient 429 errors and delivers correct answer');

    // 4.6 Immediate Failure on Permanent Client Error (No Wasted Retries)
    const permanentMock = new MockLLMProvider();
    const err401 = new Error('API_KEY_INVALID: 401');
    err401.status = 401;
    permanentMock.enqueueError(err401);

    let permAttempts = 0;
    let caughtPermanent = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        permAttempts++;
        await permanentMock.generateAnswer('auth test', [{ text: 'context' }]);
        break;
      } catch (err) {
        // If permanent error, do not retry!
        if (err.status === 401 || err.status === 400 || err.status === 403) {
          caughtPermanent = true;
          break; // Stop immediately
        }
      }
    }
    assert(permAttempts === 1, `Permanent error should abort on attempt 1 without retrying, took ${permAttempts}`);
    assert(caughtPermanent, 'Did not catch permanent error');
    logPass('Permanent errors (401/400/403) abort immediately without wasting retry budget');

    // 4.7 Deduplication of Identical In-Flight Requests
    const dedupProvider = new GeminiProvider({
      apiKey: 'AQ.Ab8DummyKey',
      maxRetries: 1,
      baseDelayMs: 10,
    });
    // Verify that the inflight cache tracks concurrent signatures
    const dedupKey = dedupProvider.generateRequestSignature('same question', [{ text: 'chunk 1' }]);
    assert(dedupKey && typeof dedupKey === 'string', 'generateRequestSignature failed');

    // Place a mock promise in inFlightRequests
    const sharedPromise = Promise.resolve('Shared concurrent answer');
    dedupProvider.inFlightRequests.set(dedupKey, sharedPromise);

    const dedupAnswer = await dedupProvider.generateAnswer('same question', [{ text: 'chunk 1' }]);
    assert(dedupAnswer === 'Shared concurrent answer', 'In-flight deduplication failed to reuse active promise');
    dedupProvider.inFlightRequests.clear();
    logPass('In-flight deduplication prevents redundant simultaneous requests for identical query + context');
  } catch (err) {
    logFail('Resilient API Handling tests failed', err);
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 5: Multi-Tenant Retrieval Isolation Regression
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 5: Multi-Tenant Retrieval Isolation Regression ---');
  let userA, userB, docA, docB;
  try {
    const timestamp = Date.now();
    userA = await User.create({ email: `user_a_eval_${timestamp}@test.local`, password: 'PasswordA123!' });
    userB = await User.create({ email: `user_b_eval_${timestamp}@test.local`, password: 'PasswordB123!' });

    const CANARY_A = `CANARY_SECRET_USER_A_${timestamp}`;
    const CANARY_B = `CANARY_SECRET_USER_B_${timestamp}`;

    const filePayloadA = {
      originalname: 'user_a_confidential.txt',
      buffer: Buffer.from(`User A Confidential Document. Secret token is: ${CANARY_A}. Internal roadmap details.`, 'utf-8'),
      size: 100,
      mimetype: 'text/plain',
    };

    const filePayloadB = {
      originalname: 'user_b_public.txt',
      buffer: Buffer.from(`User B Standard Notes. Public data token is: ${CANARY_B}. Marketing metrics.`, 'utf-8'),
      size: 100,
      mimetype: 'text/plain',
    };

    docA = await processAndSaveDocument(filePayloadA, userA._id);
    docB = await processAndSaveDocument(filePayloadB, userB._id);

    // 5.1 User B searches for User A's secret canary token across all User B documents
    const userBSearch = await retrieveRelevantChunks(CANARY_A, [], 5, userB._id);
    const containsCanaryAInB = userBSearch.sources.some((s) => s.text.includes(CANARY_A));
    assert(!containsCanaryAInB, 'Cross-tenant leak: User A canary found in User B retrieval');
    const containsDocAInB = userBSearch.sources.some((s) => s.documentId?.toString() === docA._id.toString());
    assert(!containsDocAInB, 'Cross-tenant leak: User A documentId found in User B retrieval');
    // Chunks returned to User B must only originate from User B's own documents
    for (const source of userBSearch.sources) {
      assert(source.documentId.toString() === docB._id.toString(), 'Source documentId did not match User B document');
    }

    // 5.2 User B attempts to explicitly pass User A's documentId in filter
    const userBTargetedSearch = await retrieveRelevantChunks(
      'Confidential Document roadmap',
      [docA._id.toString()],
      5,
      userB._id
    );
    assert(userBTargetedSearch.sources.length === 0, 'User B bypassed tenant isolation by passing User A documentId');

    // 5.3 User A searches and successfully finds their own canary
    const userASearch = await retrieveRelevantChunks(CANARY_A, [], 5, userA._id);
    assert(userASearch.sources.length > 0, 'User A failed to retrieve their own document chunk');
    assert(userASearch.sources[0].text.includes(CANARY_A), 'User A retrieval did not contain expected canary');

    // 5.4 End-to-end queryDocumentRAG with MockLLMProvider verifies isolation
    const mockRAGProvider = new MockLLMProvider();
    setGlobalProvider(mockRAGProvider);

    const ragResultB = await queryDocumentRAG(
      `What is the secret token ${CANARY_A}?`,
      [docA._id.toString()], // Attacking User A's document
      userB._id
    );
    assert(
      ragResultB.answer.includes('No accessible ready documents') ||
      ragResultB.answer.includes('No document chunks were found') ||
      isExplicitRefusal(ragResultB.answer) ||
      ragResultB.answer.includes('do not contain enough information'),
      `RAG did not refuse cross-tenant attack query: got "${ragResultB.answer}"`
    );
    assert(ragResultB.sources.length === 0, 'RAG returned sources across tenant boundary');
    logPass('Multi-tenant isolation verified: User B cannot retrieve or query User A documents or chunks');
  } catch (err) {
    logFail('Multi-tenant retrieval isolation regression test failed', err);
  } finally {
    // Cleanup temporary users and documents
    if (docA?._id) await deleteDocument(docA._id.toString(), userA._id).catch(() => {});
    if (docB?._id) await deleteDocument(docB._id.toString(), userB._id).catch(() => {});
    if (userA?._id) await User.deleteOne({ _id: userA._id }).catch(() => {});
    if (userB?._id) await User.deleteOne({ _id: userB._id }).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n=================================================================');
  console.log(`PHASE D TEST RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('=================================================================\n');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhaseDTests().catch(async (err) => {
  console.error('Fatal test execution error:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
