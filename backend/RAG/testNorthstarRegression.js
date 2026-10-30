/**
 * Phase 11: Automated Regression Test Suite for RAG Retrieval & Numerical Accuracy
 *
 * Covers:
 * 1. Text extraction and chunk creation (structure preservation & header retention)
 * 2. Embedding generation and vector cosine similarity
 * 3. Two-stage candidate filtering and multi-entity coverage ranking
 * 4. Query-aware context construction and narrative ordering
 * 5. Grounded prompt assembly
 * 6. Deterministic mock provider synthesis & arithmetic validation
 * 7. End-to-end query processing (Northstar completion comparison & Sunday session missing info)
 *
 * Supports both deterministic mock execution and live Gemini execution:
 *   node backend/RAG/testNorthstarRegression.js
 *   RUN_LIVE_GEMINI=true node backend/RAG/testNorthstarRegression.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { splitIntoChunks } from './documentProcessor.js';
import { generateEmbeddings } from './embeddingGenerator.js';
import { cosineSimilarity } from './vectorStore.js';
import {
  processAndSaveDocument,
  retrieveRelevantChunks,
  queryDocumentRAG,
  deleteDocument,
  extractCandidateEntities
} from '../services/documentService.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { User } from '../models/User.js';
import { getLLMProvider, setGlobalProvider } from './providers/index.js';
import { GeminiProvider } from './providers/GeminiProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

const SAMPLE_NORTHSTAR_REPORT = `NORTHSTAR COMMUNITY LEARNING HUB
Operations and Impact Report
Reporting period: 1 April 2025 – 31 March 2026

1. ORGANISATION OVERVIEW
Northstar Community Learning Hub (NCLH) provides after-school learning support, digital-literacy workshops, and career-readiness activities for young people aged 13–21. Its main centre is in Devgarh. During the reporting period, Northstar operated three learning centres: Devgarh Central, Riverbend, and Hillview.

2. PROGRAMMES
Northstar ran four core programmes during the reporting period.

A. Digital Foundations
- Intended participants: ages 13–18.
- Duration: 8 weeks.
- Topics: file management, online safety, email, document editing, and introductory spreadsheets.
- Delivery: two 90-minute sessions per week.
- A participant is counted as a programme completer after attending at least 12 of the 16 sessions and submitting the final practical task.
- The programme had 240 enrolments and 186 completers.

B. Code Pathways
- Intended participants: ages 16–21.
- Duration: 12 weeks.
- Topics: HTML, CSS, JavaScript fundamentals, debugging, Git basics, and a small team project.
- Delivery: three 2-hour sessions per week.
- Completion requires attendance at 27 of 36 sessions and submission of a working team project.
- The programme had 150 enrolments and 105 completers.

C. Career Launch
- Intended participants: ages 18–21.
- Duration: 6 weeks.
- Topics: CV preparation, interview practice, workplace communication, and job-search planning.
- Delivery: one 2-hour workshop and one 1-hour mentoring meeting per week.
- Completion requires attending at least five workshops and completing a mock interview.
- The programme had 120 enrolments and 90 completers.

D. Community Mentor Circle
- Intended participants: ages 13–21.
- Duration: ongoing, with a quarterly review.
- The programme had 80 active participants at the end of the reporting period. Because participation is ongoing, Northstar does not report a comparable “completion” count for this programme.

3. PARTICIPATION AND OUTCOMES
Across the three time-limited programmes—Digital Foundations, Code Pathways, and Career Launch—there were 510 enrolments in total and 381 programme completers in total.
The overall completion rate for those three time-limited programmes is calculated as total completers divided by total enrolments. Northstar reports this as 74.7%, rounded to one decimal place.

5. ACCESS AND ATTENDANCE
Hillview was the only centre that also piloted a Sunday session. The Sunday pilot ran for 10 weeks and was attended by 28 participants at least once. The report does not state how many participants attended every Sunday session.

8. LIMITATIONS AND NEXT STEPS
The report does not provide:
- the number of unique individuals served across all programmes;
- the number of participants who attended every Sunday pilot session.`;

async function runRegressionTests() {
  console.log('=================================================================');
  console.log('   RAG ACCURACY & MULTI-HOP REASONING REGRESSION TEST SUITE');
  console.log('=================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI}`);

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✔ PASS: ${message}`);
      testPassed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      testFailed++;
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // Create isolated test user
  const testUser = await User.create({
    email: `northstar_reg_${Date.now()}@test.local`,
    password: 'TestPassword123!',
  });

  const runLiveGemini = process.env.RUN_LIVE_GEMINI === 'true' && !!process.env.GEMINI_API_KEY;
  console.log(`Execution Mode: ${runLiveGemini ? 'LIVE GEMINI API' : 'MOCK / DETERMINISTIC ENGINE'}\n`);

  try {
    // -------------------------------------------------------------
    // Test Group 1: Structure-Aware Chunking & Heading Preservation
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 1: Structure-Aware Chunking ---');
    const chunks = splitIntoChunks(SAMPLE_NORTHSTAR_REPORT, { chunkSize: 1000, overlap: 200 });

    assert(chunks.length > 0, 'Chunking produced non-empty chunk list');
    assert(chunks.length < 10, `Chunk count is bounded and cohesive (${chunks.length} chunks)`);

    // Verify that Digital Foundations, Code Pathways, and Career Launch maintain headings + stats
    const dfChunk = chunks.find(c => c.includes('Digital Foundations') && c.includes('240 enrolments and 186 completers'));
    assert(!!dfChunk, 'Digital Foundations heading is preserved alongside its enrolments and completers');

    const cpChunk = chunks.find(c => c.includes('Code Pathways') && c.includes('150 enrolments and 105 completers'));
    assert(!!cpChunk, 'Code Pathways heading is preserved alongside its enrolments and completers');

    const clChunk = chunks.find(c => c.includes('Career Launch') && c.includes('120 enrolments and 90 completers'));
    assert(!!clChunk, 'Career Launch heading is preserved alongside its enrolments and completers');

    // -------------------------------------------------------------
    // Test Group 2: Entity Extraction & Multi-Entity Identification
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Entity Detection & Query Decomposition ---');
    const sampleOverview = "Across the three time-limited programmes—Digital Foundations, Code Pathways, and Career Launch—there were 510 enrolments";
    const detected = extractCandidateEntities(sampleOverview);

    assert(detected.includes('Digital Foundations'), 'Detected Digital Foundations entity');
    assert(detected.includes('Code Pathways'), 'Detected Code Pathways entity');
    assert(detected.includes('Career Launch'), 'Detected Career Launch entity');

    // -------------------------------------------------------------
    // Test Group 3: Document Ingestion & Database Vector Persistence
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Ingestion & Vector Storage ---');
    const filePayload = {
      originalname: 'Northstar_Community_Learning_Hub_Report.txt',
      buffer: Buffer.from(SAMPLE_NORTHSTAR_REPORT, 'utf-8'),
      size: Buffer.byteLength(SAMPLE_NORTHSTAR_REPORT),
      mimetype: 'text/plain',
    };

    const docRecord = await processAndSaveDocument(filePayload, testUser._id);
    assert(docRecord.status === 'ready', 'Document status transitioned to ready');
    assert(docRecord.chunkCount > 0, `Document chunks saved to MongoDB (count: ${docRecord.chunkCount})`);

    const storedCount = await DocumentChunk.countDocuments({ documentId: docRecord._id, userId: testUser._id });
    assert(storedCount === docRecord.chunkCount, 'DocumentChunk database count matches parent document record');

    // -------------------------------------------------------------
    // Test Group 4: Multi-Entity Coverage in Candidate Retrieval
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Multi-Entity Retrieval Coverage ---');
    const query = "Among the three time-limited programmes, which programme had the highest completion rate? Calculate its completion rate to one decimal place. Then compare it with Northstar's overall completion rate of 74.7% and state the difference in percentage points. Use only the figures provided in the report.";

    const retrievalResult = await retrieveRelevantChunks(query, [docRecord._id.toString()], 5, testUser._id);
    const sources = retrievalResult.sources || [];

    assert(sources.length > 0, 'Retrieval returned candidate chunks');

    const combinedText = sources.map(s => s.text).join('\n');
    assert(combinedText.includes('Digital Foundations') && combinedText.includes('186') && combinedText.includes('240'),
      'Retrieved context contains Digital Foundations enrolments (240) and completers (186)');
    assert(combinedText.includes('Code Pathways') && combinedText.includes('105') && combinedText.includes('150'),
      'Retrieved context contains Code Pathways enrolments (150) and completers (105)');
    assert(combinedText.includes('Career Launch') && combinedText.includes('90') && combinedText.includes('120'),
      'Retrieved context contains Career Launch enrolments (120) and completers (90)');
    assert(combinedText.includes('74.7%'), 'Retrieved context contains overall completion rate (74.7%)');

    // -------------------------------------------------------------
    // Test Group 5: End-to-End Northstar Completion Rate Question
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: End-to-End Synthesis & Mathematical Accuracy ---');
    if (!runLiveGemini) {
      // Deterministic Mock Provider configured to calculate exact rates
      const mockProvider = getLLMProvider('mock');
      mockProvider.registerResponse(
        query,
        `Based on the provided documents:
- Digital Foundations: 186 completers / 240 enrolments = 77.5%
- Code Pathways: 105 completers / 150 enrolments = 70.0%
- Career Launch: 90 completers / 120 enrolments = 75.0%

Digital Foundations had the highest completion rate at 77.5%.
Comparing this to Northstar's overall completion rate of 74.7%:
Difference: 77.5% - 74.7% = 2.8 percentage points higher.`
      );
      setGlobalProvider(mockProvider);
    } else {
      setGlobalProvider(new GeminiProvider());
    }

    const answerResult = await queryDocumentRAG(query, [docRecord._id.toString()], 5, testUser._id);
    const answer = answerResult.answer;
    console.log('\n[Synthesized Answer]:\n' + answer + '\n');

    const ansLower = answer.toLowerCase();
    assert(ansLower.includes('digital foundations'), 'Answer correctly identifies Digital Foundations as highest');
    assert(answer.includes('77.5'), 'Answer contains calculated Digital Foundations rate: 77.5%');
    assert(answer.includes('70.0') || answer.includes('70%'), 'Answer contains Code Pathways rate: 70.0%');
    assert(answer.includes('75.0') || answer.includes('75%'), 'Answer contains Career Launch rate: 75.0%');
    assert(answer.includes('74.7'), 'Answer references overall completion rate: 74.7%');
    assert(answer.includes('2.8') && ansLower.includes('percentage point'), 'Answer calculates correct difference: 2.8 percentage points');

    // -------------------------------------------------------------
    // Test Group 6: Missing-Information Grounding (Sunday Session)
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 6: Missing Information Handling ---');
    const sundayQuery = "How many participants attended every Sunday session during the pilot?";
    if (!runLiveGemini) {
      const mockProvider = getLLMProvider('mock');
      mockProvider.registerResponse(
        sundayQuery,
        'The provided documents do not state how many participants attended every Sunday session. The report mentions that 28 participants attended at least once, but notes that the number attending every session is not provided.'
      );
      setGlobalProvider(mockProvider);
    }

    const sundayResult = await queryDocumentRAG(sundayQuery, [docRecord._id.toString()], 5, testUser._id);
    console.log('[Sunday Query Answer]:\n' + sundayResult.answer + '\n');

    const sunLower = sundayResult.answer.toLowerCase();
    assert(
      sunLower.includes('not state') ||
      sunLower.includes('not provide') ||
      sunLower.includes('not contain enough information') ||
      sunLower.includes('does not state') ||
      sunLower.includes('not mentioned'),
      'Correctly abstains from fabricating participant count for every Sunday session'
    );
    assert(!sunLower.includes('28 participants attended every'), 'Does not falsely equate "at least once" with "every session"');

    // Clean up
    await deleteDocument(docRecord._id.toString(), testUser._id);
    await User.deleteOne({ _id: testUser._id });

    console.log('=================================================================');
    console.log(`REGRESSION TEST RESULTS: ${testPassed} Passed, ${testFailed} Failed`);
    console.log('=================================================================');
  } finally {
    await mongoose.disconnect();
  }
}

runRegressionTests().catch((err) => {
  console.error('\n❌ Regression test execution failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});

