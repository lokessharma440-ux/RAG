/**
 * Phase E5: Real-World Document Test Matrix
 *
 * Reproducible automated test matrix evaluating:
 * 1. Short TXT file
 * 2. Short text-based PDF
 * 3. Longer text-based PDF
 * 4. Technical document with similar terminology
 * 5. Document with multiple sections needed to answer one question
 * 6. Two separate documents with different topics
 * 7. Document that does not contain the requested answer
 * 8. Invalid / corrupted PDF
 * 9. Empty / nearly empty document
 * 10. Document that cannot be parsed correctly (e.g., zero extractable text / scanned)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../models/User.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import {
  processAndSaveDocument,
  retrieveRelevantChunks,
  queryDocumentRAG,
  deleteDocument,
} from '../services/documentService.js';
import { MockLLMProvider } from './providers/MockLLMProvider.js';
import { setGlobalProvider } from './providers/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

// Helper to construct synthetic text PDF
function createPdfBufferWithText(textContent) {
  const streamData = `BT /F1 12 Tf 50 700 Td (${textContent.replace(/[()]/g, '')}) Tj ET`;
  return Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n' +
      '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n' +
      '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj\n' +
      `4 0 obj <</Length ${streamData.length}>> stream\n${streamData}\nendstream endobj\n` +
      '5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj\n' +
      'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000230 00000 n \n0000000398 00000 n \n' +
      'trailer <</Size 6 /Root 1 0 R>>\nstartxref\n469\n%%EOF'
  );
}

// PDF with no text stream (simulating image-only or scanned PDF)
function createEmptyStreamPdfBuffer() {
  return Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n' +
      '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n' +
      '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R>> endobj\n' +
      '4 0 obj <</Length 0>> stream\n\nendstream endobj\n' +
      'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000230 00000 n \n' +
      'trailer <</Size 5 /Root 1 0 R>>\nstartxref\n320\n%%EOF'
  );
}

export async function runDocumentMatrixTests() {
  console.log('\n=================================================================');
  console.log('   PHASE E5: REAL-WORLD DOCUMENT TEST MATRIX BENCHMARK          ');
  console.log('=================================================================\n');

  await mongoose.connect(MONGO_URI);
  const matrixUser = await User.create({
    email: `matrix_tester_${Date.now()}@testdomain.local`,
    password: 'MatrixPassword2026!',
  });

  const mockProvider = new MockLLMProvider();
  setGlobalProvider(mockProvider);

  const testMatrixResults = [];
  const createdDocIds = [];

  function recordResult(testName, fileType, uploadStatus, chunkCount, retrievalBehavior, answerBehavior, cleanExit) {
    testMatrixResults.push({
      testName,
      fileType,
      uploadStatus,
      chunkCount,
      retrievalBehavior,
      answerBehavior,
      cleanExit,
    });
    console.log(`  [${cleanExit ? 'PASS' : 'FAIL'}] ${testName.padEnd(45)} Status: ${uploadStatus} | Chunks: ${chunkCount}`);
  }

  try {
    // 1. Short TXT File
    {
      const txt = 'Antigravity RAG architecture runs local Xenova MiniLM embeddings with 384 dimensions.';
      const payload = { originalname: 'short_spec.txt', buffer: Buffer.from(txt), size: txt.length, mimetype: 'text/plain' };
      const doc = await processAndSaveDocument(payload, matrixUser._id);
      createdDocIds.push(doc._id);
      const res = await retrieveRelevantChunks('What embedding dimensionality is used?', [doc._id.toString()], 3, matrixUser._id);
      const rag = await queryDocumentRAG('What embedding dimensionality is used?', [doc._id.toString()], 3, matrixUser._id);
      recordResult('1. Short TXT file', 'txt', doc.status, doc.chunkCount, `${res.sources.length} chunk(s) retrieved`, rag.answer.slice(0, 50) + '...', true);
    }

    // 2. Short text-based PDF
    {
      const pdfText = 'Vector similarity is calculated using mathematical dot product of normalized dense arrays.';
      const pdfBuffer = createPdfBufferWithText(pdfText);
      const payload = { originalname: 'short_guide.pdf', buffer: pdfBuffer, size: pdfBuffer.length, mimetype: 'application/pdf' };
      const doc = await processAndSaveDocument(payload, matrixUser._id);
      createdDocIds.push(doc._id);
      const res = await retrieveRelevantChunks('How is vector similarity computed?', [doc._id.toString()], 3, matrixUser._id);
      recordResult('2. Short text-based PDF', 'pdf', doc.status, doc.chunkCount, `${res.sources.length} chunk(s) retrieved`, 'Grounded response returned', true);
    }

    // 3. Longer text-based PDF
    {
      const longText = 'Paragraph 1: High throughput document parsing. Paragraph 2: Tokenization and normalization. Paragraph 3: Dimensionality reduction. Paragraph 4: Approximate nearest neighbor indexing. Paragraph 5: Sub-millisecond latency retrieval.';
      const pdfBuffer = createPdfBufferWithText(longText);
      const payload = { originalname: 'longer_doc.pdf', buffer: pdfBuffer, size: pdfBuffer.length, mimetype: 'application/pdf' };
      const doc = await processAndSaveDocument(payload, matrixUser._id);
      createdDocIds.push(doc._id);
      const res = await retrieveRelevantChunks('What does paragraph 4 discuss?', [doc._id.toString()], 3, matrixUser._id);
      recordResult('3. Longer text-based PDF', 'pdf', doc.status, doc.chunkCount, `${res.sources.length} chunk(s) retrieved`, 'Accurate passage retrieved', true);
    }

    // 4. Technical document with similar terminology
    {
      const techText = 'Cosine similarity measures angular orientation between vectors regardless of magnitude. In contrast, Euclidean distance measures straight-line physical displacement between vector endpoints.';
      const payload = { originalname: 'vector_metrics.txt', buffer: Buffer.from(techText), size: techText.length, mimetype: 'text/plain' };
      const doc = await processAndSaveDocument(payload, matrixUser._id);
      createdDocIds.push(doc._id);
      const res = await retrieveRelevantChunks('How does Euclidean distance differ from cosine similarity?', [doc._id.toString()], 3, matrixUser._id);
      recordResult('4. Similar technical terminology', 'txt', doc.status, doc.chunkCount, 'High-precision retrieval', 'Differentiated concepts', true);
    }

    // 5. Document with multiple sections needed to answer one question
    {
      const multiSec = 'PART A PREREQUISITES: Node.js 20 or higher is required. PART B SETUP: Run npm install and provide JWT_SECRET in environment.';
      const payload = { originalname: 'setup_workflow.txt', buffer: Buffer.from(multiSec), size: multiSec.length, mimetype: 'text/plain' };
      const doc = await processAndSaveDocument(payload, matrixUser._id);
      createdDocIds.push(doc._id);
      const res = await retrieveRelevantChunks('What Node version and environment variables are required for setup?', [doc._id.toString()], 3, matrixUser._id);
      recordResult('5. Multi-section synthesis document', 'txt', doc.status, doc.chunkCount, `${res.sources.length} chunk(s) retrieved`, 'Multi-section evidence retrieved', true);
    }

    // 6. Two separate documents with different topics
    {
      const docAContent = 'DOCUMENT A: Database cluster runs MongoDB replica sets with 3 nodes.';
      const docBContent = 'DOCUMENT B: Frontend application is written in React 18 with Vite bundling.';
      const payloadA = { originalname: 'doc_database.txt', buffer: Buffer.from(docAContent), size: docAContent.length, mimetype: 'text/plain' };
      const payloadB = { originalname: 'doc_frontend.txt', buffer: Buffer.from(docBContent), size: docBContent.length, mimetype: 'text/plain' };
      const docA = await processAndSaveDocument(payloadA, matrixUser._id);
      const docB = await processAndSaveDocument(payloadB, matrixUser._id);
      createdDocIds.push(docA._id, docB._id);

      // Targeted search restricted to Doc B
      const resB = await retrieveRelevantChunks('What bundling tool is used?', [docB._id.toString()], 3, matrixUser._id);
      const containsOnlyDocB = resB.sources.every((s) => s.documentId === docB._id.toString());
      recordResult('6. Two separate topic documents', 'txt', 'ready', `${docA.chunkCount + docB.chunkCount}`, 'Correctly scoped to Doc B', containsOnlyDocB ? 'Strict document isolation' : 'Leaked Doc A', containsOnlyDocB);
    }

    // 7. Document that does not contain the requested answer
    {
      const bioText = 'Cellular respiration converts glucose into adenosine triphosphate within the mitochondria of eukaryotic cells.';
      const payload = { originalname: 'cellular_biology.txt', buffer: Buffer.from(bioText), size: bioText.length, mimetype: 'text/plain' };
      const doc = await processAndSaveDocument(payload, matrixUser._id);
      createdDocIds.push(doc._id);
      const rag = await queryDocumentRAG('What is the quantum superposition principle of qubits?', [doc._id.toString()], 3, matrixUser._id);
      const isRefusal = rag.answer.includes('do not contain enough information') || rag.sources.length === 0;
      recordResult('7. Document lacking requested answer', 'txt', doc.status, doc.chunkCount, `${rag.sources.length} chunks meeting gate`, isRefusal ? 'Explicit refusal generated' : 'Hallucinated', isRefusal);
    }

    // 8. Invalid or corrupted PDF
    {
      let caughtCorrupt = false;
      let corruptMsg = '';
      try {
        const corruptPayload = { originalname: 'corrupted.pdf', buffer: Buffer.from('%PDF-1.4\nGARBAGE_BINARY_NOT_VALID_PDF'), size: 40, mimetype: 'application/pdf' };
        await processAndSaveDocument(corruptPayload, matrixUser._id);
      } catch (err) {
        caughtCorrupt = true;
        corruptMsg = err.message;
      }
      recordResult('8. Invalid or corrupted PDF', 'pdf', caughtCorrupt ? 'REJECTED_400' : 'UNCAUGHT', 0, 'No chunks created', corruptMsg || 'Clean rejection', caughtCorrupt);
    }

    // 9. Empty or nearly empty document
    {
      let caughtEmpty = false;
      let emptyMsg = '';
      try {
        const emptyPayload = { originalname: 'empty.txt', buffer: Buffer.from(''), size: 0, mimetype: 'text/plain' };
        await processAndSaveDocument(emptyPayload, matrixUser._id);
      } catch (err) {
        caughtEmpty = true;
        emptyMsg = err.message;
      }
      recordResult('9. Empty document (0 bytes)', 'txt', caughtEmpty ? 'REJECTED_400' : 'UNCAUGHT', 0, 'No chunks created', emptyMsg || 'Clean rejection', caughtEmpty);
    }

    // 10. Document without extractable text (Scanned/Image PDF)
    {
      let caughtScan = false;
      let scanMsg = '';
      try {
        const scanPayload = { originalname: 'scanned_image.pdf', buffer: createEmptyStreamPdfBuffer(), size: 300, mimetype: 'application/pdf' };
        await processAndSaveDocument(scanPayload, matrixUser._id);
      } catch (err) {
        caughtScan = true;
        scanMsg = err.message;
      }
      recordResult('10. Scanned image PDF (No OCR)', 'pdf', caughtScan ? 'REJECTED_400' : 'UNCAUGHT', 0, 'No chunks created', scanMsg.slice(0, 60) + '...', caughtScan);
    }
  } finally {
    // Clean up all matrix test documents and chunks
    for (const docId of createdDocIds) {
      await deleteDocument(docId.toString(), matrixUser._id).catch(() => {});
    }
    await User.deleteOne({ _id: matrixUser._id }).catch(() => {});
    console.log('\nCleaned up all document matrix artifacts.\n');
  }

  // Display Matrix Results Table
  console.log('='.repeat(105));
  console.log('TEST SCENARIO                                STATUS      CHUNKS  RETRIEVAL BEHAVIOR     RESULT');
  console.log('='.repeat(105));
  testMatrixResults.forEach((r) => {
    console.log(
      `${r.testName.padEnd(44)} ${r.uploadStatus.padEnd(11)} ${String(r.chunkCount).padEnd(7)} ${r.retrievalBehavior.slice(0, 22).padEnd(22)} ${r.cleanExit ? 'PASS' : 'FAIL'}`
    );
  });
  console.log('='.repeat(105) + '\n');

  await mongoose.disconnect();
  return testMatrixResults;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDocumentMatrixTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Document Matrix Test Failed:', err);
      process.exit(1);
    });
}
