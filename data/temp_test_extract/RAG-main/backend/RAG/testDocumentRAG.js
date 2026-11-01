import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractTextFromBuffer,
  processAndSaveDocument,
  getAllDocuments,
  deleteDocument,
  queryDocumentRAG,
} from '../services/documentService.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

// A minimal valid 1-page PDF containing extractable text
const createSamplePdfBuffer = () =>
  Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n' +
      '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n' +
      '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj\n' +
      '4 0 obj <</Length 120>> stream\n' +
      'BT /F1 16 Tf 50 700 Td (Artificial Intelligence powers modern Retrieval-Augmented Generation workflows.) Tj ET\n' +
      'endstream endobj\n' +
      '5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj\n' +
      'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000230 00000 n \n0000000398 00000 n \n' +
      'trailer <</Size 6 /Root 1 0 R>>\nstartxref\n469\n%%EOF'
  );

async function runTests() {
  console.log('====================================================');
  console.log('   Running Full Document RAG Backend System Tests   ');
  console.log('====================================================\n');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✓ Connected to MongoDB.\n');

  let testDocId = null;

  try {
    // Test 1: TXT Ingestion & Extraction
    console.log('Test 1: Ingesting TXT document...');
    const txtContent =
      'Retrieval-Augmented Generation (RAG) is a technique that combines information retrieval with large language models. ' +
      'The process begins by converting documents into vector embeddings. ' +
      'When a user queries the system, the query is embedded into the same vector space to find relevant excerpts using cosine similarity.';
    const txtFile = {
      originalname: 'test_rag_guide.txt',
      buffer: Buffer.from(txtContent, 'utf-8'),
      size: Buffer.byteLength(txtContent),
      mimetype: 'text/plain',
    };

    const savedTxtDoc = await processAndSaveDocument(txtFile);
    testDocId = savedTxtDoc._id.toString();
    console.log(`✓ TXT Document saved. ID: ${testDocId}, Status: ${savedTxtDoc.status}, Chunks: ${savedTxtDoc.chunkCount}`);

    // Verify chunks exist in DocumentChunk collection
    const chunkCount = await DocumentChunk.countDocuments({ documentId: savedTxtDoc._id });
    console.log(`✓ DocumentChunk count in MongoDB: ${chunkCount}`);
    if (chunkCount === 0) throw new Error('Expected chunks to be saved in MongoDB.');

    // Test 2: PDF Ingestion & Text Extraction
    console.log('\nTest 2: Ingesting sample PDF document...');
    const pdfBuffer = createSamplePdfBuffer();
    const pdfFile = {
      originalname: 'test_ai_overview.pdf',
      buffer: pdfBuffer,
      size: pdfBuffer.length,
      mimetype: 'application/pdf',
    };

    const savedPdfDoc = await processAndSaveDocument(pdfFile);
    console.log(`✓ PDF Document saved. ID: ${savedPdfDoc._id}, Chunks: ${savedPdfDoc.chunkCount}, Pages: ${savedPdfDoc.pageCount}`);

    // Test 3: List Documents
    console.log('\nTest 3: Listing stored documents...');
    const docs = await getAllDocuments();
    console.log(`✓ Retrieved ${docs.length} total documents from MongoDB.`);

    // Test 4: Query RAG with Document Scoping
    console.log('\nTest 4: Executing Scoped Question Query...');
    const scopedResult = await queryDocumentRAG(
      'What technique combines information retrieval with language models?',
      [testDocId],
      2
    );
    console.log('\n[Scoped Query Answer]:', scopedResult.answer);
    console.log(`[Retrieved Sources]: ${scopedResult.sources.length} sources`);
    scopedResult.sources.forEach((s, idx) => {
      console.log(`  Source ${idx + 1}: [${s.originalName}] score=${s.score.toFixed(4)}`);
    });

    // Test 5: Error Handling
    console.log('\nTest 5: Testing validation & error handling...');
    try {
      await extractTextFromBuffer(Buffer.from(''), 'txt');
      throw new Error('Should have rejected empty file');
    } catch (err) {
      console.log('✓ Rejected empty file as expected:', err.message);
    }

    try {
      await processAndSaveDocument({ originalname: 'image.png', buffer: Buffer.from('abc') });
      throw new Error('Should have rejected unsupported file type');
    } catch (err) {
      console.log('✓ Rejected invalid file extension as expected:', err.message);
    }

    // Test 6: Document & Chunk Deletion
    console.log('\nTest 6: Deleting test documents and cascade chunks...');
    await deleteDocument(testDocId);
    await deleteDocument(savedPdfDoc._id.toString());
    const remainingChunks = await DocumentChunk.countDocuments({
      documentId: { $in: [testDocId, savedPdfDoc._id] },
    });
    console.log(`✓ Remaining associated chunks after deletion: ${remainingChunks} (expected 0)`);
    if (remainingChunks !== 0) throw new Error('Orphaned chunks detected after deletion.');

    console.log('\n====================================================');
    console.log('✓ All Document RAG Backend Tests Passed Successfully!');
    console.log('====================================================');
  } finally {
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
