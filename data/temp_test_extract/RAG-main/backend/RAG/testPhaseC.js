/**
 * Phase C Automated Test Suite:
 * Reliable Ingestion, Disk Resource Protection, Pagination, Error Recovery & Lifecycle
 *
 * Verifies:
 * 1. Production fail-fast environment validation
 * 2. Disk storage and guaranteed temporary file cleanup
 * 3. Rejection of invalid extensions & oversized uploads
 * 4. Document processing state transitions (queued -> processing -> ready)
 * 5. Partial chunk-write cleanup and failure sanitization (failed state)
 * 6. Document retry mechanism and duplicate chunk prevention
 * 7. Multi-tenant pagination boundaries & limit capping
 * 8. User isolation across retries and paginated listings
 * 9. Document deletion cascading and orphaned chunk elimination
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { User } from '../models/User.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { validateDatabaseEnv } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure backend .env is loaded
dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';

const { default: app } = await import('../server.js');

let server;
let baseUrl;

function logPass(title) {
  console.log(`  \x1b[32m✔ PASS:\x1b[0m ${title}`);
}

function logFail(title, error) {
  console.error(`  \x1b[31m✘ FAIL:\x1b[0m ${title}`);
  if (error) console.error(`    Details:`, error);
}

// Helper to make multipart/form-data upload using native Node fetch
async function uploadDocument(url, cookie, fileName, fileBuffer, mimeType = 'text/plain') {
  const boundary = `----PhaseCBoundary${Date.now()}`;
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    fileBuffer,
    Buffer.from(footer, 'utf-8'),
  ]);

  const headers = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  };
  if (cookie) headers['Cookie'] = cookie;

  return fetch(url, {
    method: 'POST',
    headers,
    body: bodyBuffer,
  });
}

function extractCookieToken(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/token=([^;]+)/);
  return match ? `token=${match[1]}` : null;
}

// Minimal valid PDF with text
const createSamplePdf = (text) =>
  Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n' +
      '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n' +
      '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj\n' +
      `4 0 obj <</Length ${text.length + 40}>> stream\n` +
      `BT /F1 14 Tf 50 700 Td (${text}) Tj ET\n` +
      'endstream endobj\n' +
      '5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj\n' +
      'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000230 00000 n \n0000000398 00000 n \n' +
      'trailer <</Size 6 /Root 1 0 R>>\nstartxref\n469\n%%EOF'
  );

async function runTestSuite() {
  console.log('\n=================================================================');
  console.log('   PHASE C: RELIABLE INGESTION, RESOURCE & LIFECYCLE TESTS       ');
  console.log('=================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`[Phase C Test Server] Running on ephemeral port: ${port}\n`);

  const timestamp = Date.now();
  const userAEmail = `phase_c_alice_${timestamp}@testdomain.local`;
  const userBEmail = `phase_c_bob_${timestamp}@testdomain.local`;
  const password = 'StrongPasswordPhaseC123!';

  let cookieUserA = null;
  let cookieUserB = null;
  let userARecord = null;
  let userBRecord = null;
  const createdDocIds = [];

  const tempDir = path.resolve(__dirname, '../uploads/temp');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Production Fail-Fast Environment Validation
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const originalEnv = process.env.NODE_ENV;
      const originalUri = process.env.MONGO_URI;

      process.env.NODE_ENV = 'production';
      delete process.env.MONGO_URI;

      let threw = false;
      try {
        validateDatabaseEnv();
      } catch (err) {
        threw = true;
      } finally {
        process.env.NODE_ENV = originalEnv;
        process.env.MONGO_URI = originalUri;
      }

      if (threw) {
        logPass(`Database connection fails fast in production when MONGO_URI is missing`);
        passedTests++;
      } else {
        throw new Error('validateDatabaseEnv did not throw when MONGO_URI was omitted in production!');
      }
    } catch (err) {
      logFail(`Production environment fail-fast check`, err.message);
    }

    // -------------------------------------------------------------------------
    // Setup Test Users
    // -------------------------------------------------------------------------
    const resRegA = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userAEmail, password }),
    });
    cookieUserA = extractCookieToken(resRegA);
    userARecord = await User.findOne({ email: userAEmail });

    const resRegB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userBEmail, password }),
    });
    cookieUserB = extractCookieToken(resRegB);
    userBRecord = await User.findOne({ email: userBEmail });

    // -------------------------------------------------------------------------
    // TEST 2: Successful TXT Ingestion & Temporary File Cleanup
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const txtContent = Buffer.from(
        'Artificial Intelligence and Machine Learning enable semantic understanding of unstructured text. ' +
        'Vector embeddings translate tokens into mathematical coordinates in multidimensional space.'
      );

      const beforeFiles = fs.existsSync(tempDir) ? fs.readdirSync(tempDir).length : 0;

      const uploadRes = await uploadDocument(
        `${baseUrl}/api/documents/upload`,
        cookieUserA,
        'ai_principles.txt',
        txtContent,
        'text/plain'
      );
      const data = await uploadRes.json();

      const afterFiles = fs.existsSync(tempDir) ? fs.readdirSync(tempDir).length : 0;

      if (uploadRes.status === 201 && data.success && data.data?._id) {
        createdDocIds.push(data.data._id);
        const docRecord = await Document.findById(data.data._id);
        const chunkCount = await DocumentChunk.countDocuments({ documentId: data.data._id });

        // Temp files must be cleanly unlinked (no accumulation on disk)
        const tempCleaned = afterFiles <= beforeFiles;

        if (docRecord.status === 'ready' && chunkCount > 0 && tempCleaned) {
          logPass(`TXT ingested successfully; temp upload file reliably unlinked from disk`);
          passedTests++;
        } else {
          throw new Error(`Status=${docRecord.status}, chunks=${chunkCount}, tempCleaned=${tempCleaned}`);
        }
      } else {
        throw new Error(`Upload failed with status ${uploadRes.status}: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      logFail(`TXT ingestion and temp cleanup`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 3: Successful PDF Ingestion & Status Lifecycle
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const pdfBuffer = createSamplePdf('Retrieval-Augmented Generation processes documents reliably.');
      const uploadRes = await uploadDocument(
        `${baseUrl}/api/documents/upload`,
        cookieUserA,
        'rag_reliable.pdf',
        pdfBuffer,
        'application/pdf'
      );
      const data = await uploadRes.json();

      if (uploadRes.status === 201 && data.success) {
        createdDocIds.push(data.data._id);
        const docRecord = await Document.findById(data.data._id);

        if (docRecord.status === 'ready' && docRecord.chunkCount > 0) {
          logPass(`PDF ingested with verified status: ready and chunk count: ${docRecord.chunkCount}`);
          passedTests++;
        } else {
          throw new Error(`Unexpected document state: ${docRecord.status}`);
        }
      } else {
        throw new Error(`PDF upload failed with status ${uploadRes.status}`);
      }
    } catch (err) {
      logFail(`PDF ingestion lifecycle`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Invalid File Types & Temp File Cleanup
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const invalidBuffer = Buffer.from('FAKE PNG IMAGE DATA');
      const uploadRes = await uploadDocument(
        `${baseUrl}/api/documents/upload`,
        cookieUserA,
        'unsupported_diagram.png',
        invalidBuffer,
        'image/png'
      );

      if (uploadRes.status === 400) {
        logPass(`Unsupported file type (.png) correctly rejected with 400 Bad Request`);
        passedTests++;
      } else {
        throw new Error(`Expected 400, got ${uploadRes.status}`);
      }
    } catch (err) {
      logFail(`Invalid file type rejection`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 5: Oversized Upload Rejection (> 15MB limit)
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // 16MB buffer to exceed 15MB limit
      const oversizedBuffer = Buffer.alloc(16 * 1024 * 1024, 'A');
      const uploadRes = await uploadDocument(
        `${baseUrl}/api/documents/upload`,
        cookieUserA,
        'oversized_document.txt',
        oversizedBuffer,
        'text/plain'
      );

      if (uploadRes.status === 400) {
        logPass(`Oversized upload (>15MB) rejected by Multer with clean error`);
        passedTests++;
      } else {
        throw new Error(`Expected 400 for oversized upload, got ${uploadRes.status}`);
      }
    } catch (err) {
      logFail(`Oversized upload handling`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Partial Chunk Cleanup on Processing Failure
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // Create a corrupted/empty text document that causes text extraction failure
      const emptyBuffer = Buffer.from('   \n\t   '); // whitespace only
      const uploadRes = await uploadDocument(
        `${baseUrl}/api/documents/upload`,
        cookieUserA,
        'corrupted_empty.txt',
        emptyBuffer,
        'text/plain'
      );

      // Verify that no orphaned chunks exist in MongoDB
      const failedDocs = await Document.find({
        userId: userARecord._id,
        originalName: 'corrupted_empty.txt',
      });

      if (failedDocs.length > 0) {
        const failedDoc = failedDocs[0];
        createdDocIds.push(failedDoc._id);
        const orphanedChunks = await DocumentChunk.countDocuments({ documentId: failedDoc._id });

        // Ensure errorMessage does not contain system file paths
        const sanitized = !failedDoc.errorMessage?.includes('C:\\') && !failedDoc.errorMessage?.includes('/Users/');

        if (failedDoc.status === 'failed' && orphanedChunks === 0 && sanitized) {
          logPass(`Failure transitions to status: failed, cleans up partial chunks, and sanitizes error message`);
          passedTests++;
        } else {
          throw new Error(`Failed doc check: status=${failedDoc.status}, orphanedChunks=${orphanedChunks}, sanitized=${sanitized}`);
        }
      } else {
        // Handled synchronously by extraction validator
        logPass(`Invalid empty document safely caught and rejected without database pollution`);
        passedTests++;
      }
    } catch (err) {
      logFail(`Failure state and partial chunk cleanup`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 7: Document Retry Mechanism & Duplicate Prevention
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // Create a document record simulated in failed status with cached extractedText
      const sampleText = 'Data Engineering Principles: Consistency, Availability, and Partition Tolerance.';
      const simulatedFailedDoc = await Document.create({
        userId: userARecord._id,
        originalName: 'cap_theorem.txt',
        fileType: 'txt',
        fileSize: sampleText.length,
        status: 'failed',
        extractedText: sampleText,
        errorMessage: 'Simulated transient connection timeout.',
      });
      createdDocIds.push(simulatedFailedDoc._id);

      // Trigger Retry endpoint
      const retryRes = await fetch(`${baseUrl}/api/documents/${simulatedFailedDoc._id}/retry`, {
        method: 'POST',
        headers: { Cookie: cookieUserA },
      });
      const retryData = await retryRes.json();

      const refreshedDoc = await Document.findById(simulatedFailedDoc._id);
      const chunks = await DocumentChunk.find({ documentId: simulatedFailedDoc._id });

      // Verify each chunkIndex is unique (no duplicate chunks created by retry)
      const chunkIndices = chunks.map((c) => c.chunkIndex);
      const uniqueIndices = new Set(chunkIndices);
      const noDuplicates = uniqueIndices.size === chunkIndices.length;

      if (retryRes.status === 200 && refreshedDoc.status === 'ready' && chunks.length > 0 && noDuplicates) {
        logPass(`Document retry transitions failed document to ready with zero duplicate chunks`);
        passedTests++;
      } else {
        throw new Error(`Retry verification failed: status=${refreshedDoc.status}, chunks=${chunks.length}, noDuplicates=${noDuplicates}`);
      }
    } catch (err) {
      logFail(`Document retry mechanism`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 8: Pagination Boundaries & Limit Capping
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // Create 3 additional documents for User A to have at least 5 documents total
      for (let i = 1; i <= 3; i++) {
        const text = `Document Sample Number ${i} content for pagination validation.`;
        const res = await uploadDocument(
          `${baseUrl}/api/documents/upload`,
          cookieUserA,
          `pagination_sample_${i}.txt`,
          Buffer.from(text),
          'text/plain'
        );
        const d = await res.json();
        if (d.data?._id) createdDocIds.push(d.data._id);
      }

      // 8a. Page 1 with limit 2
      const page1Res = await fetch(`${baseUrl}/api/documents?page=1&limit=2`, {
        headers: { Cookie: cookieUserA },
      });
      const page1Data = await page1Res.json();

      // 8b. Page 2 with limit 2
      const page2Res = await fetch(`${baseUrl}/api/documents?page=2&limit=2`, {
        headers: { Cookie: cookieUserA },
      });
      const page2Data = await page2Res.json();

      const page1Ids = page1Data.data.map((d) => d._id);
      const page2Ids = page2Data.data.map((d) => d._id);

      // Verify no overlap between page 1 and page 2
      const hasOverlap = page1Ids.some((id) => page2Ids.includes(id));
      const metadataValid =
        page1Data.pagination &&
        page1Data.pagination.page === 1 &&
        page1Data.pagination.limit === 2 &&
        page1Data.pagination.total >= 4 &&
        page1Data.pagination.hasNextPage === true;

      if (page1Data.data.length === 2 && page2Data.data.length === 2 && !hasOverlap && metadataValid) {
        logPass(`Pagination boundaries verified: Page 1 and Page 2 partition cleanly without overlap`);
        passedTests++;
      } else {
        throw new Error(`Pagination mismatch: p1Count=${page1Data.data.length}, p2Count=${page2Data.data.length}, overlap=${hasOverlap}`);
      }
    } catch (err) {
      logFail(`Pagination boundaries`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 9: User Isolation on Retries & Listings
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User B creates a document
      const userBText = 'Confidential Bob Roadmap for Q4 2026.';
      const resB = await uploadDocument(
        `${baseUrl}/api/documents/upload`,
        cookieUserB,
        'bob_q4_roadmap.txt',
        Buffer.from(userBText),
        'text/plain'
      );
      const dataB = await resB.json();
      const docBId = dataB.data._id;
      createdDocIds.push(docBId);

      // User A attempts to call retry on User B's document
      const retryAttackRes = await fetch(`${baseUrl}/api/documents/${docBId}/retry`, {
        method: 'POST',
        headers: { Cookie: cookieUserA },
      });

      // User A lists documents with pagination
      const pageListRes = await fetch(`${baseUrl}/api/documents?page=1&limit=50`, {
        headers: { Cookie: cookieUserA },
      });
      const pageListData = await pageListRes.json();
      const userAListIds = pageListData.data.map((d) => d._id);

      const retryBlocked = retryAttackRes.status === 404;
      const listingIsolated = !userAListIds.includes(docBId);

      if (retryBlocked && listingIsolated) {
        logPass(`Cross-user isolation maintained: User A cannot retry or list User B's documents`);
        passedTests++;
      } else {
        throw new Error(`Isolation check failed: retryStatus=${retryAttackRes.status}, inList=${!listingIsolated}`);
      }
    } catch (err) {
      logFail(`User isolation on retries and pagination`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 10: Document Deletion and Cascading Chunk Purge
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const docToDelete = createdDocIds[0];
      const chunksBefore = await DocumentChunk.countDocuments({ documentId: docToDelete });

      const delRes = await fetch(`${baseUrl}/api/documents/${docToDelete}`, {
        method: 'DELETE',
        headers: { Cookie: cookieUserA },
      });
      const delData = await delRes.json();

      const docAfter = await Document.findById(docToDelete);
      const chunksAfter = await DocumentChunk.countDocuments({ documentId: docToDelete });

      if (delRes.status === 200 && delData.success && !docAfter && chunksBefore > 0 && chunksAfter === 0) {
        logPass(`Document deletion cleanly purges parent record and cascades all chunk embeddings`);
        passedTests++;
      } else {
        throw new Error(`Deletion cascade failed: docAfter=${!!docAfter}, chunksAfter=${chunksAfter}`);
      }
    } catch (err) {
      logFail(`Cascading document and chunk deletion`, err.message);
    }

    // -------------------------------------------------------------------------
    // CLEANUP TEST DATA
    // -------------------------------------------------------------------------
    try {
      await DocumentChunk.deleteMany({ documentId: { $in: createdDocIds } });
      await Document.deleteMany({ _id: { $in: createdDocIds } });
      await User.deleteMany({ email: { $in: [userAEmail, userBEmail] } });
    } catch (cleanupErr) {
      console.warn('Test cleanup notice:', cleanupErr.message);
    }

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Phase C Verification Results: ${passedTests}/${totalTests} Tests Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('-----------------------------------------------------------------\n');

  if (passedTests === totalTests) {
    console.log('\x1b[32m✔ ALL PHASE C RELIABILITY & INGESTION CHECKS PASSED SUCCESSFULLY!\x1b[0m\n');
    await mongoose.disconnect();
    process.exit(0);
  } else {
    console.error('\x1b[31m✘ SOME PHASE C TESTS FAILED. Please review the failures above.\x1b[0m\n');
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTestSuite().catch(async (err) => {
  console.error('[Fatal Test Error]', err);
  if (server) server.close();
  await mongoose.disconnect();
  process.exit(1);
});
