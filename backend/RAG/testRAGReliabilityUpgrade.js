import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB, closeDB } from '../config/db.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { Codebase } from '../models/Codebase.js';
import { RepositoryFile } from '../models/RepositoryFile.js';
import { CodeChunk } from '../models/CodeChunk.js';
import { CodeRelationship } from '../models/CodeRelationship.js';
import { User } from '../models/User.js';
import {
  processAndSaveDocument,
  deleteDocument,
  retryDocumentProcessing,
  retrieveRelevantChunks,
  queryDocumentRAG,
} from '../services/documentService.js';
import { processAndIndexRepository } from '../services/codebase/codebaseIndexingService.js';
import { verifyAnswerEvidence } from './evidenceVerifier.js';
import { createMetricsTracker } from '../utils/ragObservability.js';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function runTests() {
  console.log('====================================================');
  console.log('   DEVMIND AI — RAG RELIABILITY & PERFORMANCE TESTS  ');
  console.log('====================================================\n');

  await connectDB();

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      testPassed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      testFailed++;
    }
  }

  // Generate unique test users
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();

  try {
    // -------------------------------------------------------------------------
    // TEST SUITE 1: Evidence & Citation Verification
    // -------------------------------------------------------------------------
    console.log('[Suite 1: Citation & Evidence Verification]');

    const mockChunks = [
      {
        _id: new mongoose.Types.ObjectId(),
        chunkId: 'c1',
        documentId: 'doc-alpha',
        originalName: 'Financial_Report_2026.pdf',
        pageNumber: 3,
        chunkIndex: 0,
        text: 'DevMind AI revenue grew by 142% year-over-year in Q3 2026, reaching 4.8 million dollars in annual recurring revenue.',
        score: 0.92,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        chunkId: 'c2',
        documentId: 'doc-alpha',
        originalName: 'Financial_Report_2026.pdf',
        pageNumber: 4,
        chunkIndex: 1,
        text: 'The engineering team optimized ONNX embedding inference to keep RAM strictly below 400MB on Render Free tier.',
        score: 0.88,
      },
    ];

    // Case 1A: Well-supported answer
    const supportedAnswer = 'DevMind AI achieved 142% year-over-year revenue growth in Q3 2026, reaching 4.8 million ARR.';
    const verificationSupported = verifyAnswerEvidence({
      answer: supportedAnswer,
      retrievedChunks: mockChunks,
      validDocumentIds: ['doc-alpha'],
    });

    assert(verificationSupported.isSufficient === true, 'Supported answer marked isSufficient=true');
    assert(verificationSupported.evidenceScore >= 0.7, `Evidence score reflects strong support (${verificationSupported.evidenceScore})`);
    assert(verificationSupported.citations.length > 0, 'Citations populated for grounded answer');
    assert(verificationSupported.citations[0].pageNumber === 3, 'Citation includes verified page number 3');
    assert(verificationSupported.citations[0].documentId === 'doc-alpha', 'Citation references correct authorized document ID');

    // Case 1B: Insufficient context answer
    const insufficientAnswer = 'The provided documents do not contain enough information to answer this question.';
    const verificationInsufficient = verifyAnswerEvidence({
      answer: insufficientAnswer,
      retrievedChunks: mockChunks,
      validDocumentIds: ['doc-alpha'],
    });

    assert(verificationInsufficient.isSufficient === false, 'Declared insufficient answer correctly marked isSufficient=false');
    assert(verificationInsufficient.citations.length === 0, 'No bogus citations attached to insufficient information response');

    // Case 1C: Cross-document authorization check
    const unauthorizedChunks = [
      {
        _id: new mongoose.Types.ObjectId(),
        chunkId: 'cx',
        documentId: 'doc-secret-userB',
        originalName: 'Confidential_UserB.pdf',
        pageNumber: 1,
        text: 'Confidential trade secrets belonging to User B.',
      },
    ];
    const verificationUnauthorized = verifyAnswerEvidence({
      answer: 'Confidential trade secrets belonging to User B.',
      retrievedChunks: unauthorizedChunks,
      validDocumentIds: ['doc-userA-only'],
    });

    assert(verificationUnauthorized.citations.length === 0, 'Unauthorized cross-user documents rejected by evidence verifier');

    // -------------------------------------------------------------------------
    // TEST SUITE 2: RAG Observability & Metrics Logging
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2: RAG Observability & Transparency]');

    const tracker = createMetricsTracker('req-test-obs-1', String(userA));
    const stopEmbed = tracker.startStage('embeddingGeneration');
    await new Promise((r) => setTimeout(r, 15));
    stopEmbed();

    const stopGen = tracker.startStage('generation');
    await new Promise((r) => setTimeout(r, 20));
    stopGen();

    tracker.setMetric('retrievedChunksCount', 4);
    tracker.setMetric('evidenceScore', 0.85);
    const finalRecord = tracker.finalizeAndLog();

    assert(finalRecord.requestId === 'req-test-obs-1', 'Tracker captures specific requestId');
    assert(finalRecord.embeddingGenerationMs >= 10, 'Stage timings measured accurately');
    assert(finalRecord.memoryMB && finalRecord.memoryMB.heapUsed, 'Memory metrics recorded without leaking sensitive data');
    assert(finalRecord.retrievedChunksCount === 4, 'Chunk metrics recorded');

    // -------------------------------------------------------------------------
    // TEST SUITE 3: Document Deduplication & Multi-Tenant Isolation
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3: Smart Document Deduplication & Multi-Tenant Isolation]');

    const sampleDocContent = 'DevMind AI RAG Architecture Blueprint.\nSection 1: Local ONNX embedding inference with 384 dimensions.\nSection 2: Hybrid BM25 keyword and dense cosine similarity retrieval.\nSection 3: Fine-grained evidence verification and citation validation.';

    // User A uploads Document 1
    const doc1 = await processAndSaveDocument(
      {
        originalname: 'DevMind_Blueprint.txt',
        buffer: Buffer.from(sampleDocContent, 'utf-8'),
        size: sampleDocContent.length,
      },
      userA
    );

    assert(doc1.status === 'ready', 'First document processed and saved to ready status');
    assert(doc1.contentHash !== null && doc1.contentHash !== undefined, 'Content hash computed and stored');
    assert(doc1.isDuplicate === false, 'First document marked isDuplicate=false');

    // User A uploads Document 2 (Identical Content, Different Filename)
    const doc2 = await processAndSaveDocument(
      {
        originalname: 'DevMind_Blueprint_Copy.txt',
        buffer: Buffer.from(sampleDocContent, 'utf-8'),
        size: sampleDocContent.length,
      },
      userA
    );

    assert(doc2.status === 'ready', 'Duplicate document instantly transitioned to ready status');
    assert(doc2.isDuplicate === true, 'Duplicate document marked isDuplicate=true');
    assert(String(doc2.duplicateOfDocId) === String(doc1._id), 'Duplicate references original document ID');
    assert(doc2.chunkCount === doc1.chunkCount, 'Duplicate has identical chunk count without re-running ONNX embeddings');

    // Verify independent deletion: Deleting Document 1 must NOT delete Document 2 chunks
    await deleteDocument(doc1._id, userA);
    const remainingDoc2Chunks = await DocumentChunk.find({ documentId: doc2._id });
    assert(remainingDoc2Chunks.length === doc2.chunkCount, 'Deleting original document preserves duplicate chunks independently');

    // Multi-tenant check: User B uploads identical content
    const docUserB = await processAndSaveDocument(
      {
        originalname: 'UserB_File.txt',
        buffer: Buffer.from(sampleDocContent, 'utf-8'),
        size: sampleDocContent.length,
      },
      userB
    );

    assert(docUserB.isDuplicate === false, 'User B upload of identical content is NOT marked duplicate of User A (strict isolation)');
    assert(docUserB.duplicateOfDocId === null, 'No cross-user document reference assigned');

    // Cleanup documents
    await deleteDocument(doc2._id, userA);
    await deleteDocument(docUserB._id, userB);

    // -------------------------------------------------------------------------
    // TEST SUITE 4: Incremental Repository Indexing
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4: Incremental Repository Indexing]');

    // Create a mock codebase record
    const codebase = await Codebase.create({
      ownerUserId: userA,
      name: 'test-incremental-repo',
      sourceType: 'zip',
      status: 'queued',
    });

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'devmind-inc-test-'));

    try {
      // 1. Initial State: 3 files (a.js, b.js, c.js)
      await fs.promises.writeFile(path.join(tempDir, 'fileA.js'), 'export function funcA() { return "alpha"; }', 'utf8');
      await fs.promises.writeFile(path.join(tempDir, 'fileB.js'), 'export function funcB() { return "bravo"; }', 'utf8');
      await fs.promises.writeFile(path.join(tempDir, 'fileC.js'), 'export function funcC() { return "charlie"; }', 'utf8');

      // Initial Indexing
      await processAndIndexRepository(codebase._id, tempDir, "", null, { preserveTempDir: true });

      const afterInitCodebase = await Codebase.findById(codebase._id);
      assert(afterInitCodebase.status === 'ready', 'Initial repository indexing succeeded');
      assert(afterInitCodebase.stats.totalFiles === 3, 'Initial index recorded 3 files');
      const initialChunkCount = afterInitCodebase.stats.totalChunks;
      assert(initialChunkCount > 0, `Initial chunk count > 0 (${initialChunkCount})`);

      // 2. Second Indexing: Zero changes (Fast Path)
      await processAndIndexRepository(codebase._id, tempDir, "", null, { preserveTempDir: true });
      const afterUnchangedCodebase = await Codebase.findById(codebase._id);
      assert(afterUnchangedCodebase.incrementalStats.unchangedFiles === 3, 'Second import detected 3 unchanged files');
      assert(afterUnchangedCodebase.incrementalStats.newChunksEmbedded === 0, 'Zero embeddings generated for unchanged repository re-import');
      assert(afterUnchangedCodebase.stats.totalChunks === initialChunkCount, 'Reused all existing chunks');

      // 3. Third Indexing: 1 modified (fileA), 1 deleted (fileB), 1 added (fileD), 1 unchanged (fileC)
      await fs.promises.writeFile(path.join(tempDir, 'fileA.js'), 'export function funcA() { return "alpha-v2-updated"; }', 'utf8');
      await fs.promises.unlink(path.join(tempDir, 'fileB.js'));
      await fs.promises.writeFile(path.join(tempDir, 'fileD.js'), 'export function funcD() { return "delta-new"; }', 'utf8');

      await processAndIndexRepository(codebase._id, tempDir, "", null, { preserveTempDir: true });
      const afterModifiedCodebase = await Codebase.findById(codebase._id);

      assert(afterModifiedCodebase.incrementalStats.unchangedFiles === 1, 'Incremental index detected 1 unchanged file (fileC)');
      assert(afterModifiedCodebase.incrementalStats.modifiedFiles === 1, 'Incremental index detected 1 modified file (fileA)');
      assert(afterModifiedCodebase.incrementalStats.newFiles === 1, 'Incremental index detected 1 new file (fileD)');
      assert(afterModifiedCodebase.incrementalStats.deletedFiles === 1, 'Incremental index detected 1 deleted file (fileB)');

      // Verify fileB was purged
      const deletedFileRecord = await RepositoryFile.findOne({ repositoryId: codebase._id, relativePath: 'fileB.js' });
      assert(deletedFileRecord === null, 'Deleted file completely removed from RepositoryFile collection');

      const deletedFileChunks = await CodeChunk.find({ repositoryId: codebase._id, relativePath: 'fileB.js' });
      assert(deletedFileChunks.length === 0, 'Deleted file chunks completely purged from CodeChunk collection');

      // Verify fileA was updated with new content
      const updatedFileA = await RepositoryFile.findOne({ repositoryId: codebase._id, relativePath: 'fileA.js' });
      assert(updatedFileA.content.includes('alpha-v2-updated'), 'Modified file content and hash updated in database');

      // Verify fileD was added
      const addedFileD = await RepositoryFile.findOne({ repositoryId: codebase._id, relativePath: 'fileD.js' });
      assert(addedFileD !== null, 'New file added to RepositoryFile collection');

    } finally {
      // Clean up mock directory and database records
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {}
      await Promise.all([
        Codebase.deleteOne({ _id: codebase._id }),
        RepositoryFile.deleteMany({ repositoryId: codebase._id }),
        CodeChunk.deleteMany({ repositoryId: codebase._id }),
        CodeRelationship.deleteMany({ repositoryId: codebase._id }),
      ]);
    }

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${testPassed} Passed | ${testFailed} Failed`);
    console.log('====================================================\n');

    if (testFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('[Test Execution Error]', err);
    process.exit(1);
  } finally {
    await closeDB();
  }
}

runTests();
