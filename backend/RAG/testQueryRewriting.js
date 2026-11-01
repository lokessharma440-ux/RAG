import assert from 'assert';
import mongoose from 'mongoose';
import { rewriteQuery } from './queryRewriter.js';
import { MockLLMProvider } from './providers/MockLLMProvider.js';
import { queryDocumentRAG } from '../services/documentService.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { User } from '../models/User.js';

let passed = 0;
let failed = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✔ PASS: ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${description}`);
    console.error(err);
    failed++;
  }
}

async function itAsync(description, fn) {
  try {
    await fn();
    console.log(`  ✔ PASS: ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${description}`);
    console.error(err);
    failed++;
  }
}

async function runSuite() {
  console.log('=================================================================');
  console.log('   QUERY REWRITING COMPREHENSIVE TEST SUITE');
  console.log('=================================================================\n');

  // Set up mock provider
  const mockProvider = new MockLLMProvider();

  // Test 1: Clear questions remain semantically preserved
  console.log('--- TEST GROUP 1: Clear & Standalone Queries ---');
  mockProvider.registerRewrite(
    'what is the highest completion rate in northstar',
    'What is the highest completion rate reported in Northstar?'
  );
  await itAsync('Clear question retains its semantic intent', async () => {
    const res = await rewriteQuery('what is the highest completion rate in northstar', [], {
      provider: mockProvider,
    });
    assert.ok(res.rewrittenQuery.toLowerCase().includes('completion rate'));
    assert.ok(res.rewrittenQuery.toLowerCase().includes('northstar'));
  });

  // Test 2: Short / ambiguous questions & acronyms (CP not working WFH)
  console.log('\n--- TEST GROUP 2: Abbreviations & Short Queries ---');
  mockProvider.registerRewrite(
    'cp not working wfh',
    'How can I troubleshoot a computer or network connection issue while working from home?'
  );
  await itAsync('Expands common abbreviations (CP, WFH) into clear retrieval query', async () => {
    const res = await rewriteQuery('CP not working WFH', [], { provider: mockProvider });
    assert.strictEqual(
      res.rewrittenQuery,
      'How can I troubleshoot a computer or network connection issue while working from home?'
    );
    assert.strictEqual(res.wasRewritten, true);
  });

  // Test 3: Spelling mistakes correction
  console.log('\n--- TEST GROUP 3: Spelling & Grammar Correction ---');
  mockProvider.registerRewrite(
    'whr is dockr config file',
    'Where is the Docker configuration file located?'
  );
  await itAsync('Corrects spelling mistakes (whr -> Where, dockr -> Docker)', async () => {
    const res = await rewriteQuery('whr is dockr config file', [], { provider: mockProvider });
    assert.strictEqual(res.rewrittenQuery, 'Where is the Docker configuration file located?');
  });

  // Test 4: Hinglish questions
  console.log('\n--- TEST GROUP 4: Hinglish Reformulation ---');
  mockProvider.registerRewrite(
    'leave policy kya hai',
    "What is the organization's leave policy?"
  );
  await itAsync('Reformulates Hinglish query into standard retrieval query', async () => {
    const res = await rewriteQuery('leave policy kya hai', [], { provider: mockProvider });
    assert.strictEqual(res.rewrittenQuery, "What is the organization's leave policy?");
  });

  // Test 5: Technical terms, error codes, and versions
  console.log('\n--- TEST GROUP 5: Technical Precision & Error Codes ---');
  mockProvider.registerRewrite(
    'fix err_conn_refused on port 5000 in node v20.1',
    'How to resolve ERR_CONN_REFUSED error on port 5000 in Node.js v20.1?'
  );
  await itAsync('Preserves exact error codes, port numbers, and versions', async () => {
    const res = await rewriteQuery('fix err_conn_refused on port 5000 in node v20.1', [], {
      provider: mockProvider,
    });
    assert.ok(res.rewrittenQuery.includes('ERR_CONN_REFUSED'));
    assert.ok(res.rewrittenQuery.includes('5000'));
    assert.ok(res.rewrittenQuery.includes('v20.1'));
  });

  // Test 6: Anaphora resolution with conversation history
  console.log('\n--- TEST GROUP 6: Anaphora Resolution with History ---');
  const history = [
    { role: 'user', content: 'Tell me about Docker container security.' },
    { role: 'assistant', content: 'Docker containers isolate processes using cgroups and namespaces...' },
  ];
  mockProvider.registerRewrite(
    'explain that again',
    'Can you explain Docker container security and isolation again?'
  );
  await itAsync('Resolves "explain that again" using previous turn topic', async () => {
    const res = await rewriteQuery('explain that again', history, { provider: mockProvider });
    assert.ok(res.rewrittenQuery.toLowerCase().includes('docker'));
    assert.ok(res.rewrittenQuery.toLowerCase().includes('container'));
  });

  // Test 7: Anaphora without history falls back cleanly
  console.log('\n--- TEST GROUP 7: Anaphora Without Context Fallback ---');
  mockProvider.registerRewrite(
    'explain that again',
    'explain that again'
  );
  await itAsync('Does not invent facts if context is missing, preserves original query', async () => {
    const res = await rewriteQuery('explain that again', [], { provider: mockProvider });
    assert.strictEqual(res.rewrittenQuery, 'explain that again');
  });

  // Test 8: Malformed / Invalid JSON handling
  console.log('\n--- TEST GROUP 8: Malformed Provider Output Fallback ---');
  const faultyProvider = new MockLLMProvider();
  faultyProvider.generateDirectText = async () => 'Not a JSON string at all!';
  await itAsync('Falls back safely to original query when model returns non-JSON text', async () => {
    const res = await rewriteQuery('what is quantum computing', [], { provider: faultyProvider });
    assert.strictEqual(res.rewrittenQuery, 'what is quantum computing');
    assert.strictEqual(res.wasRewritten, false);
    assert.ok(res.reason.includes('fallback'));
  });

  // Test 9: Empty rewriting output fallback
  console.log('\n--- TEST GROUP 9: Empty Model Output Fallback ---');
  const emptyProvider = new MockLLMProvider();
  emptyProvider.generateDirectText = async () => '{"rewrittenQuery": ""}';
  await itAsync('Falls back to original query when rewrittenQuery is blank', async () => {
    const res = await rewriteQuery('what is react', [], { provider: emptyProvider });
    assert.strictEqual(res.rewrittenQuery, 'what is react');
    assert.strictEqual(res.wasRewritten, false);
  });

  // Test 10: Provider timeout or network error fallback
  console.log('\n--- TEST GROUP 10: Timeout & Error Resilience ---');
  const errorProvider = new MockLLMProvider();
  errorProvider.generateDirectText = async () => {
    throw new Error('Gemini API 503 Service Unavailable');
  };
  await itAsync('Falls back gracefully to original query on provider error without crashing', async () => {
    const res = await rewriteQuery('how does mongodb indexing work', [], { provider: errorProvider });
    assert.strictEqual(res.rewrittenQuery, 'how does mongodb indexing work');
    assert.strictEqual(res.wasRewritten, false);
    assert.ok(res.reason.includes('error_fallback'));
  });

  // Test 11: Feature flag disabling
  console.log('\n--- TEST GROUP 11: Feature Flag Configuration ---');
  process.env.QUERY_REWRITING_ENABLED = 'false';
  await itAsync('Bypasses rewriting immediately when QUERY_REWRITING_ENABLED=false', async () => {
    const res = await rewriteQuery('cp not working wfh', [], { provider: mockProvider });
    assert.strictEqual(res.rewrittenQuery, 'cp not working wfh');
    assert.strictEqual(res.wasRewritten, false);
    assert.strictEqual(res.reason, 'feature_disabled');
  });
  delete process.env.QUERY_REWRITING_ENABLED; // restore

  // Test 12 & 13: End-to-end integration, User isolation, and Tenant security
  console.log('\n--- TEST GROUP 12: End-to-End RAG Integration & Tenant Isolation ---');
  await mongoose.connect('mongodb://127.0.0.1:27017/mern_dev_db');

  const testUserA = new mongoose.Types.ObjectId();
  const testUserB = new mongoose.Types.ObjectId();

  // Create isolated document for User A
  const docA = await Document.create({
    userId: testUserA,
    originalName: 'Company_Policy_2026.txt',
    fileType: 'txt',
    fileSize: 500,
    status: 'ready',
    chunkCount: 1,
  });

  await DocumentChunk.create({
    userId: testUserA,
    documentId: docA._id,
    chunkIndex: 0,
    originalName: 'Company_Policy_2026.txt',
    text: 'The organization leave policy provides 24 paid vacation days and 10 sick leave days per calendar year.',
    embedding: new Array(384).fill(0.05),
  });

  const integrationProvider = new MockLLMProvider();
  integrationProvider.registerRewrite('leave policy kya hai', "What is the organization's leave policy?");
  integrationProvider.registerResponse(
    'leave policy kya hai',
    'The organization leave policy provides 24 paid vacation days and 10 sick leave days per calendar year.'
  );

  // User A query
  await itAsync('User A successfully retrieves chunks using rewritten query', async () => {
    const result = await queryDocumentRAG('leave policy kya hai', [docA._id.toString()], 2, testUserA, {
      provider: integrationProvider,
    });
    assert.strictEqual(result.rewrittenQuery, "What is the organization's leave policy?");
    assert.strictEqual(result.wasRewritten, true);
    assert.ok(result.sources.length > 0);
    assert.strictEqual(result.sources[0].originalName, 'Company_Policy_2026.txt');
  });

  // User B query on User A doc - MUST BE BLOCKED
  await itAsync('User B is strictly blocked from accessing User A documents even with rewritten query', async () => {
    const result = await queryDocumentRAG('leave policy kya hai', [docA._id.toString()], 2, testUserB, {
      provider: integrationProvider,
    });
    assert.ok(result.sources.length === 0);
    assert.ok(result.answer.includes('No accessible ready documents found'));
  });

  // Cleanup test documents
  await Document.deleteOne({ _id: docA._id });
  await DocumentChunk.deleteMany({ documentId: docA._id });
  await mongoose.disconnect();

  console.log('\n=================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('=================================================================');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
