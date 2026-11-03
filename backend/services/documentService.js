import crypto from 'crypto';
import { verifyAnswerEvidence } from '../RAG/evidenceVerifier.js';
import { createMetricsTracker } from '../utils/ragObservability.js';
import { enqueueHeavyJob } from '../utils/heavyJobQueue.js';
import { logMemory } from '../utils/memoryDiagnostics.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { PDFParse } from 'pdf-parse';
import { splitIntoChunks } from '../RAG/documentProcessor.js';
import { generateEmbeddings } from '../RAG/embeddingGenerator.js';
import { cosineSimilarity } from '../RAG/vectorStore.js';
import { generateAnswer } from '../RAG/geminiGenerator.js';
import { rewriteQuery } from '../RAG/queryRewriter.js';
import {
  lookupSemanticCache,
  storeSemanticCache,
  invalidateDocumentCache,
} from './semanticCacheService.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { supportsTransactions } from '../config/db.js';

/**
 * Safely removes a temporary file from disk.
 *
 * @param {string} filePath
 */
export async function cleanupTempFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[Temp File Cleanup Warning] Could not remove ${filePath}:`, err.message);
    }
  }
}

/**
 * Startup utility: Purges any stale orphaned temporary upload files
 * older than maxAgeMs from the temp upload directory.
 *
 * @param {string} tempDir
 * @param {number} [maxAgeMs=3600000] Default: 1 hour
 */
export async function purgeStaleTempFiles(tempDir, maxAgeMs = 3600000) {
  try {
    if (!fs.existsSync(tempDir)) return;
    const files = await fs.promises.readdir(tempDir);
    const now = Date.now();

    for (const file of files) {
      const fullPath = path.join(tempDir, file);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(fullPath);
          console.log(`[Temp Cleanup] Purged stale upload file: ${file}`);
        }
      } catch {
        // Ignore single file stat/unlink errors
      }
    }
  } catch (err) {
    console.warn('[Temp Cleanup Warning] Error purging stale files:', err.message);
  }
}

/**
 * Extracts raw text from an uploaded file buffer.
 *
 * @param {Buffer} buffer - File buffer.
 * @param {string} fileType - 'pdf' or 'txt'.
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
export async function extractTextFromBuffer(buffer, fileType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }

  const normalizedType = fileType.toLowerCase().replace('.', '');

  if (normalizedType === 'txt') {
    let text = buffer.toString('utf-8').trim();
    // Normalize newlines and clean irregular tabs
    text = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ');
    if (!text) {
      throw new Error('The text file is empty or contains only whitespace.');
    }
    return { text, pageCount: 1 };
  }

  if (normalizedType === 'pdf') {
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      let extractedText = result.text ? result.text.trim() : '';

      // Strip pdf-parse synthetic page separators e.g. "-- 1 of 1 --" to test for actual content
      const textWithoutSeparators = extractedText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').trim();

      if (!textWithoutSeparators) {
        throw new Error(
          'No extractable text found in this PDF. Note: Scanned or image-only PDFs require OCR, which is not currently supported.'
        );
      }

      // High-accuracy cleaning for PDF text extraction:
      // 1. Unify hyphenated words split across line breaks
      extractedText = extractedText.replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2');
      // 2. Normalize carriage returns and collapse repeated empty lines
      extractedText = extractedText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');

      return {
        text: extractedText,
        pageCount: result.total || 1,
      };
    } catch (err) {
      if (err.message.includes('No extractable text')) {
        throw err;
      }
      throw new Error(`Failed to parse PDF document: ${err.message || 'Invalid or corrupted PDF format.'}`);
    }
  }

  throw new Error(`Unsupported file type: .${normalizedType}. Only .pdf and .txt are supported.`);
}

/**
 * Reads file content from Multer file object (supports both disk path and memory buffer).
 *
 * @param {Object} file - Multer file object.
 * @param {string} ext - Extension ('pdf' | 'txt').
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
async function extractTextFromFile(file, ext) {
  let buffer;
  if (file.path) {
    buffer = await fs.promises.readFile(file.path);
  } else if (file.buffer) {
    buffer = file.buffer;
  } else {
    throw new Error('No readable file content found on disk or buffer.');
  }
  const result = await extractTextFromBuffer(buffer, ext);
  buffer = null; // Release buffer from memory immediately
  return result;
}

/**
 * Creates the initial Document record in MongoDB with 'processing' status.
 * Returns immediately so the client HTTP upload finishes in < 1 second.
 *
 * @param {Object} file - Multer file object
 * @param {string|mongoose.Types.ObjectId|null} [userId=null]
 * @returns {Promise<Object>} Created Document record
 */
export async function createInitialDocumentRecord(file, userId = null) {
  if (!file || (!file.path && !file.buffer)) {
    throw new Error('No file data provided.');
  }

  const originalName = file.originalname;
  const ext = originalName.split('.').pop().toLowerCase();

  if (ext !== 'pdf' && ext !== 'txt') {
    if (file.path) await cleanupTempFile(file.path);
    throw new Error(`Invalid file extension ".${ext}". Only .pdf and .txt files are supported.`);
  }

  const parsedUserId = userId ? new mongoose.Types.ObjectId(userId) : null;

  const docRecord = await Document.create({
    userId: parsedUserId,
    originalName,
    fileType: ext,
    fileSize: file.size,
    status: 'processing',
  });

  return docRecord;
}

/**
 * Background worker: Parses document text, chunks it, generates batched
 * 384-dimensional MiniLM embeddings, and stores chunks in MongoDB.
 * Always cleans up the temporary disk file upon completion or failure.
 *
 * @param {string} docId - MongoDB Document ID
 * @param {string} filePath - Path to temporary file on disk
 * @param {string} originalName - Original filename
 * @param {string|mongoose.Types.ObjectId|null} [userId=null]
 */
export async function processDocumentBackground(docId, filePath, originalName, userId = null) {
  return enqueueHeavyJob(async () => {
    logMemory('DocumentIngestion:Start', { docId, file: originalName });
    const docRecord = await Document.findById(docId);
    if (!docRecord) {
      if (filePath) await cleanupTempFile(filePath);
      return;
    }

    const ext = originalName.split('.').pop().toLowerCase();
    const parsedUserId = userId ? new mongoose.Types.ObjectId(userId) : null;

    try {
    // 1. Extract text from disk
    const { text, pageCount } = await extractTextFromFile({ path: filePath }, ext);
    docRecord.extractedText = text;

    const contentHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    docRecord.contentHash = contentHash;

    // Check for smart deduplication within user's permitted scope
    if (parsedUserId) {
      const existingDoc = await Document.findOne({
        userId: parsedUserId,
        contentHash,
        status: 'ready',
        _id: { $ne: docRecord._id },
      });

      if (existingDoc) {
        const existingChunks = await DocumentChunk.find({ documentId: existingDoc._id }).lean();
        if (existingChunks.length > 0) {
          const clonedChunks = existingChunks.map((c) => ({
            userId: parsedUserId,
            documentId: docRecord._id,
            chunkIndex: c.chunkIndex,
            text: c.text,
            embedding: c.embedding,
            originalName,
            pageNumber: c.pageNumber || 1,
          }));

          await DocumentChunk.deleteMany({ documentId: docRecord._id });
          await DocumentChunk.insertMany(clonedChunks);
          docRecord.status = 'ready';
          docRecord.characterCount = existingDoc.characterCount || text.length;
          docRecord.chunkCount = clonedChunks.length;
          docRecord.pageCount = existingDoc.pageCount || pageCount;
          docRecord.isDuplicate = true;
          docRecord.duplicateOfDocId = existingDoc._id;
          docRecord.errorMessage = null;
          await docRecord.save();
          logMemory('DocumentIngestion:DuplicateReused', { docId, duplicateOf: existingDoc._id, chunks: clonedChunks.length });
          return;
        }
      }
    }

    // 2. Divide text into chunks using structure-aware documentProcessor
    const defaultChunkSize = parseInt(process.env.RAG_CHUNK_SIZE, 10) || 1000;
    const defaultOverlap = parseInt(process.env.RAG_CHUNK_OVERLAP, 10) || 200;
    const chunkTexts = splitIntoChunks(text, defaultChunkSize, defaultOverlap);
    if (!chunkTexts || chunkTexts.length === 0) {
      throw new Error('Could not divide document into any usable text chunks.');
    }

    // 3. Generate local embeddings using batched embeddingGenerator
    const embeddings = await generateEmbeddings(chunkTexts);
    if (embeddings.length !== chunkTexts.length) {
      throw new Error('Mismatch between chunk count and generated embeddings count.');
    }

    // 4. Clean up any preexisting chunks (idempotent write guarantee)
    await DocumentChunk.deleteMany({ documentId: docRecord._id });

    // 5. Prepare chunk documents for batch insertion with userId ownership
    const chunkDocs = chunkTexts.map((chunkText, index) => ({
      userId: parsedUserId,
      documentId: docRecord._id,
      chunkIndex: index,
      text: chunkText,
      embedding: embeddings[index],
      originalName,
      pageNumber: Math.min(pageCount, Math.floor((index / chunkTexts.length) * pageCount) + 1),
    }));

    // 6. Atomically insert chunks and transition status to 'ready'
    if (supportsTransactions()) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await DocumentChunk.insertMany(chunkDocs, { session });
          docRecord.status = 'ready';
          docRecord.characterCount = text.length;
          docRecord.chunkCount = chunkTexts.length;
          docRecord.pageCount = pageCount;
          docRecord.errorMessage = null;
          await docRecord.save({ session });
        });
      } finally {
        await session.endSession();
      }
    } else {
      await DocumentChunk.insertMany(chunkDocs);
      docRecord.status = 'ready';
      docRecord.characterCount = text.length;
      docRecord.chunkCount = chunkTexts.length;
      docRecord.pageCount = pageCount;
      docRecord.errorMessage = null;
      await docRecord.save();
    }
    logMemory('DocumentIngestion:Done', { docId, chunks: chunkTexts.length });
  } catch (error) {
    console.error(`[Background Document Processing Failed] ${docId}:`, error);
    logMemory('DocumentIngestion:Failed', { docId, error: error.message });
    try {
      await DocumentChunk.deleteMany({ documentId: docRecord._id });
      docRecord.status = 'failed';
      docRecord.errorMessage = error.message || 'Failed to process document.';
      await docRecord.save();
    } catch (cleanupErr) {
      console.error('[Document Cleanup Error]', cleanupErr);
    }
  } finally {
    if (filePath) {
      await cleanupTempFile(filePath);
    }
  }
  }, { type: 'document_ingestion', docId });
}

/**
 * Ingests an uploaded document with rigorous lifecycle state management:
 * 1. Creates initial Document record with status: 'queued'.
 * 2. Transitions status to 'processing'.
 * 3. Extracts text and caches extractedText for reliable retries.
 * 4. Splits text into overlapping chunks using documentProcessor.
 * 5. Generates 384-dimensional local embeddings.
 * 6. Deletes any pre-existing chunks for idempotency.
 * 7. Persists DocumentChunk records (using transactions if available, otherwise atomic compensation).
 * 8. Transitions status to 'ready' ONLY after all chunks are verified and stored.
 * 9. On any failure: cleans up chunks, transitions to 'failed', records sanitized error, and cleans temp files.
 *
 * @param {Object} file - Multer file object ({ originalname, path, buffer, size, mimetype }).
 * @param {string|mongoose.Types.ObjectId|null} [userId=null] - Authenticated owner ID.
 * @returns {Promise<Object>} Created document metadata.
 */
export async function processAndSaveDocument(file, userId = null) {
  if (!file || (!file.path && !file.buffer)) {
    throw new Error('No file data provided.');
  }

  const originalName = file.originalname;
  const ext = originalName.split('.').pop().toLowerCase();

  if (ext !== 'pdf' && ext !== 'txt') {
    if (file.path) await cleanupTempFile(file.path);
    throw new Error(`Invalid file extension ".${ext}". Only .pdf and .txt files are supported.`);
  }

  const parsedUserId = userId ? new mongoose.Types.ObjectId(userId) : null;

  // 1. Create initial Document record in MongoDB with status: 'queued'
  const docRecord = await Document.create({
    userId: parsedUserId,
    originalName,
    fileType: ext,
    fileSize: file.size,
    status: 'queued',
  });

  try {
    // 2. Transition state to 'processing'
    docRecord.status = 'processing';
    await docRecord.save();

    // 3. Extract text from disk or buffer
    const { text, pageCount } = await extractTextFromFile(file, ext);
    docRecord.extractedText = text;

    const contentHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    docRecord.contentHash = contentHash;

    // Check for smart deduplication within user's permitted scope
    if (parsedUserId) {
      const existingDoc = await Document.findOne({
        userId: parsedUserId,
        contentHash,
        status: 'ready',
        _id: { $ne: docRecord._id },
      });

      if (existingDoc) {
        const existingChunks = await DocumentChunk.find({ documentId: existingDoc._id }).lean();
        if (existingChunks.length > 0) {
          const clonedChunks = existingChunks.map((c) => ({
            userId: parsedUserId,
            documentId: docRecord._id,
            chunkIndex: c.chunkIndex,
            text: c.text,
            embedding: c.embedding,
            originalName,
            pageNumber: c.pageNumber || 1,
          }));

          await DocumentChunk.deleteMany({ documentId: docRecord._id });
          await DocumentChunk.insertMany(clonedChunks);
          docRecord.status = 'ready';
          docRecord.characterCount = existingDoc.characterCount || text.length;
          docRecord.chunkCount = clonedChunks.length;
          docRecord.pageCount = existingDoc.pageCount || pageCount;
          docRecord.isDuplicate = true;
          docRecord.duplicateOfDocId = existingDoc._id;
          docRecord.errorMessage = null;
          await docRecord.save();
          logMemory('DocumentIngestion:DuplicateReused', { docId: docRecord._id, duplicateOf: existingDoc._id, chunks: clonedChunks.length });
          return docRecord;
        }
      }
    }

    // 4. Divide text into chunks using structure-aware documentProcessor
    const defaultChunkSize = parseInt(process.env.RAG_CHUNK_SIZE, 10) || 1000;
    const defaultOverlap = parseInt(process.env.RAG_CHUNK_OVERLAP, 10) || 200;
    const chunkTexts = splitIntoChunks(text, defaultChunkSize, defaultOverlap);
    if (!chunkTexts || chunkTexts.length === 0) {
      throw new Error('Could not divide document into any usable text chunks.');
    }

    // 5. Generate local embeddings using existing embeddingGenerator
    const embeddings = await generateEmbeddings(chunkTexts);
    if (embeddings.length !== chunkTexts.length) {
      throw new Error('Mismatch between chunk count and generated embeddings count.');
    }

    // 6. Clean up any preexisting chunks (idempotent write guarantee)
    await DocumentChunk.deleteMany({ documentId: docRecord._id });

    // 7. Prepare chunk documents for batch insertion with userId ownership
    const chunkDocs = chunkTexts.map((chunkText, index) => ({
      userId: parsedUserId,
      documentId: docRecord._id,
      chunkIndex: index,
      text: chunkText,
      embedding: embeddings[index],
      originalName,
      pageNumber: Math.min(pageCount, Math.floor((index / chunkTexts.length) * pageCount) + 1),
    }));

    // 8. Atomically insert chunks and transition status to 'ready'
    if (supportsTransactions()) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await DocumentChunk.insertMany(chunkDocs, { session });
          docRecord.status = 'ready';
          docRecord.characterCount = text.length;
          docRecord.chunkCount = chunkTexts.length;
          docRecord.pageCount = pageCount;
          docRecord.errorMessage = null;
          await docRecord.save({ session });
        });
      } finally {
        await session.endSession();
      }
    } else {
      // Safe fallback for standalone MongoDB deployments:
      await DocumentChunk.insertMany(chunkDocs);
      docRecord.status = 'ready';
      docRecord.characterCount = text.length;
      docRecord.chunkCount = chunkTexts.length;
      docRecord.pageCount = pageCount;
      docRecord.errorMessage = null;
      await docRecord.save();
    }

    return docRecord;
  } catch (error) {
    // Failure handling: ensure NO partially written chunks remain in the database
    try {
      await DocumentChunk.deleteMany({ documentId: docRecord._id });
      docRecord.status = 'failed';
      docRecord.errorMessage = error.message;
      await docRecord.save();
    } catch (cleanupErr) {
      console.error('[Document Cleanup Error]', cleanupErr);
    }

    throw error;
  } finally {
    // 9. Always clean up temporary upload file from disk on both success and failure
    if (file.path) {
      await cleanupTempFile(file.path);
    }
  }
}

/**
 * Retries processing for a failed document belonging to the authenticated user.
 * Re-runs chunking and embedding without duplicate chunk creation.
 *
 * @param {string} id - Document ID.
 * @param {string|mongoose.Types.ObjectId|null} [userId=null]
 * @returns {Promise<Object>}
 */
export async function retryDocumentProcessing(id, userId = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid document ID format.');
  }

  const query = { _id: id };
  if (userId) {
    query.userId = new mongoose.Types.ObjectId(userId);
  } else {
    query.userId = null;
  }

  // Fetch document including cached extractedText
  const doc = await Document.findOne(query).select('+extractedText');
  if (!doc) {
    throw new Error('Document not found or access denied.');
  }

  if (doc.status === 'ready') {
    throw new Error('Document is already in ready status. Retry is not needed.');
  }

  if (!doc.extractedText) {
    throw new Error('Source text is not cached for this document. Please re-upload the file.');
  }

  try {
    // Set to processing
    doc.status = 'processing';
    doc.errorMessage = null;
    await doc.save();

    // 1. Clean up any existing chunks (prevent duplicate chunks)
    await DocumentChunk.deleteMany({ documentId: doc._id });

    // 2. Chunk text using structure-aware processor
    const defaultChunkSize = parseInt(process.env.RAG_CHUNK_SIZE, 10) || 1000;
    const defaultOverlap = parseInt(process.env.RAG_CHUNK_OVERLAP, 10) || 200;
    const chunkTexts = splitIntoChunks(doc.extractedText, defaultChunkSize, defaultOverlap);
    if (!chunkTexts || chunkTexts.length === 0) {
      throw new Error('Could not divide document into usable text chunks.');
    }

    // 3. Generate embeddings
    const embeddings = await generateEmbeddings(chunkTexts);
    if (embeddings.length !== chunkTexts.length) {
      throw new Error('Mismatch between chunk count and generated embeddings count.');
    }

    // 4. Batch insert chunks
    const chunkDocs = chunkTexts.map((chunkText, index) => ({
      userId: doc.userId,
      documentId: doc._id,
      chunkIndex: index,
      text: chunkText,
      embedding: embeddings[index],
      originalName: doc.originalName,
      pageNumber: Math.min(doc.pageCount, Math.floor((index / chunkTexts.length) * doc.pageCount) + 1),
    }));

    await DocumentChunk.insertMany(chunkDocs);

    // 5. Update status to ready
    doc.status = 'ready';
    doc.chunkCount = chunkTexts.length;
    doc.characterCount = doc.extractedText.length;
    doc.errorMessage = null;
    await doc.save();

    // Invalidate any semantic cache entries tied to this retried/re-indexed document
    if (doc.userId) {
      await invalidateDocumentCache(doc.userId, doc._id);
    }

    return doc;
  } catch (error) {
    await DocumentChunk.deleteMany({ documentId: doc._id });
    doc.status = 'failed';
    doc.errorMessage = error.message;
    await doc.save();
    throw error;
  }
}

/**
 * Safely and idempotently re-indexes an existing document using structure-aware chunking.
 *
 * @param {string} id - Document ID.
 * @param {string|mongoose.Types.ObjectId|null} [userId=null]
 * @returns {Promise<Object>}
 */
export async function reindexDocument(id, userId = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid document ID format.');
  }

  const query = { _id: id };
  if (userId) {
    query.userId = new mongoose.Types.ObjectId(userId);
  }

  const doc = await Document.findOne(query).select('+extractedText');
  if (!doc) {
    throw new Error('Document not found or access denied.');
  }

  if (!doc.extractedText) {
    throw new Error('Document does not contain cached extractedText. Re-upload is required.');
  }

  const defaultChunkSize = parseInt(process.env.RAG_CHUNK_SIZE, 10) || 1000;
  const defaultOverlap = parseInt(process.env.RAG_CHUNK_OVERLAP, 10) || 200;

  const chunkTexts = splitIntoChunks(doc.extractedText, defaultChunkSize, defaultOverlap);
  if (!chunkTexts || chunkTexts.length === 0) {
    throw new Error('Could not divide document into usable text chunks.');
  }

  const embeddings = await generateEmbeddings(chunkTexts);

  // Atomically replace chunks
  await DocumentChunk.deleteMany({ documentId: doc._id });

  const chunkDocs = chunkTexts.map((chunkText, index) => ({
    userId: doc.userId,
    documentId: doc._id,
    chunkIndex: index,
    text: chunkText,
    embedding: embeddings[index],
    originalName: doc.originalName,
    pageNumber: Math.min(doc.pageCount || 1, Math.floor((index / chunkTexts.length) * (doc.pageCount || 1)) + 1),
  }));

  await DocumentChunk.insertMany(chunkDocs);

  doc.status = 'ready';
  doc.chunkCount = chunkTexts.length;
  doc.characterCount = doc.extractedText.length;
  doc.errorMessage = null;
  await doc.save();

  // Invalidate any semantic cache entries tied to this modified/re-indexed document
  if (doc.userId) {
    await invalidateDocumentCache(doc.userId, doc._id);
  }

  return doc;
}

/**
 * Retrieves documents belonging to the authenticated user with optional pagination and status filtering.
 *
 * @param {string|mongoose.Types.ObjectId|null} [userId=null]
 * @param {Object} [options=null] - { page, limit, status }
 * @returns {Promise<Array>} Array of documents, with .pagination attached when pagination options provided.
 */
export async function getAllDocuments(userId = null, options = null) {
  const query = userId ? { userId: new mongoose.Types.ObjectId(userId) } : { userId: null };

  if (options && options.status) {
    query.status = options.status;
  }

  if (!options) {
    // Legacy unpaginated mode for backward compatibility
    return Document.find(query).sort({ createdAt: -1 });
  }

  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(options.limit, 10) || 10)); // Bounded between 1 and 50

  const total = await Document.countDocuments(query);
  const totalPages = Math.ceil(total / limit) || 1;

  const docs = await Document.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  // Attach pagination metadata directly to the array
  docs.pagination = {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };

  return docs;
}

/**
 * Retrieves a single document by ID, scoped to the authenticated user.
 *
 * @param {string} id
 * @param {string|mongoose.Types.ObjectId|null} [userId=null]
 * @returns {Promise<Object|null>}
 */
export async function getDocumentById(id, userId = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }
  const query = { _id: id };
  if (userId) {
    query.userId = new mongoose.Types.ObjectId(userId);
  } else {
    query.userId = null;
  }
  return Document.findOne(query);
}

/**
 * Deletes a document and all its associated chunks from MongoDB,
 * ensuring the requesting user is the verified owner.
 *
 * @param {string} id
 * @param {string|mongoose.Types.ObjectId|null} [userId=null]
 * @returns {Promise<boolean>}
 */
export async function deleteDocument(id, userId = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return false;
  }

  const query = { _id: id };
  if (userId) {
    query.userId = new mongoose.Types.ObjectId(userId);
  } else {
    query.userId = null;
  }

  const doc = await Document.findOne(query);
  if (!doc) {
    return false;
  }

  // Delete all associated chunks matching documentId and userId
  const chunkQuery = { documentId: doc._id };
  if (userId) {
    chunkQuery.userId = new mongoose.Types.ObjectId(userId);
  }
  await DocumentChunk.deleteMany(chunkQuery);

  // Invalidate any semantic cache entries tied to this document
  if (userId) {
    await invalidateDocumentCache(userId, doc._id);
  }

  // Delete document record
  await Document.deleteOne(query);

  return true;
}

/**
 * Retrieves relevant chunks using hybrid dense vector search and lexical keyword matching.
 * Scopes search strictly to ready documents owned by the specified user.
 *
 * @param {string} question - Query text.
 * @param {Array<string>} [documentIds=[]] - Optional target document IDs.
 * @param {number} [topK=4] - Max number of top chunks.
 * @param {string|mongoose.Types.ObjectId|null} [userId=null] - Authenticated user ID.
 * @returns {Promise<{ sources: Array<Object>, emptyScopeMessage?: string }>}
 */
export async function retrieveRelevantChunks(question, documentIds = [], topK = 4, userId = null) {
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('A valid question string must be provided.');
  }

  const parsedUserId = userId ? new mongoose.Types.ObjectId(userId) : null;

  // 1. Build filter for permitted document scope strictly isolated to this user
  let chunkFilter = {};

  if (parsedUserId) {
    chunkFilter.userId = parsedUserId;

    if (Array.isArray(documentIds) && documentIds.length > 0) {
      // Validate that the requested document IDs actually belong to this user and are READY
      const validIds = documentIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
      const userDocs = await Document.find({
        _id: { $in: validIds },
        userId: parsedUserId,
        status: 'ready',
      }).select('_id');

      if (userDocs.length === 0) {
        return {
          sources: [],
          emptyScopeMessage: 'No accessible ready documents found matching the requested scope.',
        };
      }
      chunkFilter.documentId = { $in: userDocs.map((d) => d._id) };
    } else {
      // Search across all ready documents owned by this user
      const readyDocs = await Document.find({ userId: parsedUserId, status: 'ready' }).select('_id');
      if (readyDocs.length === 0) {
        return {
          sources: [],
          emptyScopeMessage: 'No uploaded documents are currently ready for querying in your account. Please upload a document first.',
        };
      }
      chunkFilter.documentId = { $in: readyDocs.map((d) => d._id) };
    }
  } else {
    // Unassigned legacy/fallback scope
    chunkFilter.userId = null;
    if (Array.isArray(documentIds) && documentIds.length > 0) {
      const validIds = documentIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
      chunkFilter.documentId = { $in: validIds };
    } else {
      const readyDocs = await Document.find({ userId: null, status: 'ready' }).select('_id');
      if (readyDocs.length === 0) {
        return {
          sources: [],
          emptyScopeMessage: 'No uploaded documents are currently ready for querying. Please upload a document first.',
        };
      }
      chunkFilter.documentId = { $in: readyDocs.map((d) => d._id) };
    }
  }

  logMemory('DocumentRAG:RetrieveStart', { filterKeys: Object.keys(chunkFilter).join(',') });
  // 2. Fetch candidate chunks from database (strictly bounded by chunkFilter, plain lean objects)
  const storedChunks = await DocumentChunk.find(chunkFilter)
    .select('_id documentId chunkIndex text embedding originalName pageNumber')
    .lean();
  logMemory('DocumentRAG:RetrieveDone', { count: storedChunks.length });

  if (storedChunks.length === 0) {
    return {
      sources: [],
      emptyScopeMessage: 'No document chunks were found in the selected document scope.',
    };
  }

  // 3. Generate embedding for user question
  const questionEmbeddings = await generateEmbeddings([question.trim()]);
  const questionEmbedding = questionEmbeddings[0];

  // 4. Extract meaningful search terms for lexical boost
  const stopWords = new Set([
    'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'for', 'of', 'to', 'from',
    'with', 'about', 'as', 'by', 'that', 'this', 'it', 'are', 'was', 'were', 'be', 'been',
    'what', 'how', 'why', 'when', 'where', 'who', 'does', 'do', 'did', 'can', 'could', 'should',
    'would', 'will', 'my', 'your', 'their', 'our', 'give', 'me', 'tell', 'show'
  ]);
  const queryTerms = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // 5. Calculate Hybrid Score (Cosine Similarity + Exact Keyword Match Boost)
  const scoredChunks = storedChunks.map((chunk) => {
    const vectorScore = cosineSimilarity(questionEmbedding, chunk.embedding);

    let keywordBoost = 0;
    if (queryTerms.length > 0) {
      const chunkLower = chunk.text.toLowerCase();
      let matchedTerms = 0;
      for (const term of queryTerms) {
        if (chunkLower.includes(term)) {
          matchedTerms++;
        }
      }
      keywordBoost = (matchedTerms / queryTerms.length) * 0.15;
    }

    const hybridScore = vectorScore + keywordBoost;

    return {
      chunkId: chunk._id ? chunk._id.toString() : undefined,
      documentId: chunk.documentId.toString(),
      originalName: chunk.originalName,
      documentName: chunk.originalName,
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber || 1,
      text: chunk.text,
      score: hybridScore,
      vectorScore,
      citation: `${chunk.originalName}${chunk.pageNumber ? ` (Page ${chunk.pageNumber})` : ''}`,
    };
  });

  // 6. Sort by descending hybrid score (cosine similarity + keyword boost)
  scoredChunks.sort((a, b) => b.score - a.score);

  // Select top K most relevant chunks
  const topSources = scoredChunks.slice(0, topK);

  return {
    sources: topSources,
  };
}

/**
 * Queries stored documents using vector similarity and generates an answer via LLM.
 * Strictly scopes retrieval to documents owned by the specified user and in 'ready' status.
 *
 * @param {string} question - User question.
 * @param {Array<string>} [documentIds=[]] - Optional list of document IDs to restrict search scope.
 * @param {number} [topK=4] - Number of top chunks to retrieve.
 * @param {string|mongoose.Types.ObjectId|null} [userId=null] - Authenticated user ID.
 * @param {Object} [options={}] - Optional settings passed to the LLM provider.
 * @returns {Promise<{ answer: string, sources: Array<{ documentId: string, originalName: string, chunkIndex: number, text: string, score: number }> }>}
 */
export async function queryDocumentRAG(question, documentIds = [], topK = 4, userId = null, options = {}) {
  const tracker = createMetricsTracker(options.requestId, userId);
  const stopRewriteTimer = tracker.startStage('queryRewriting');

  // Phase 2 & 3: Query Rewriting Integration
  const conversationHistory = options.conversationHistory || [];
  const rewriteResult = await rewriteQuery(question, conversationHistory, options);
  const retrievalQuery = rewriteResult.rewrittenQuery || question;
  stopRewriteTimer();

  // Compute question embedding once for both Semantic Cache lookup and potential chunk retrieval
  const stopEmbedTimer = tracker.startStage('embeddingGeneration');
  const [queryEmbedding] = await generateEmbeddings([retrievalQuery.trim()]);
  stopEmbedTimer();

  // Semantic Cache Lookup: Check if a semantically equivalent answer exists for this exact user & scope
  const stopCacheTimer = tracker.startStage('cacheLookup');
  if (userId) {
    const cacheResult = await lookupSemanticCache({
      userId,
      query: retrievalQuery,
      queryEmbedding,
      documentIds,
      options,
    });
    stopCacheTimer();

    if (cacheResult.hit) {
      tracker.setMetric('cacheStatus', 'HIT');
      tracker.finalizeAndLog({ cached: true });
      return {
        answer: cacheResult.answer,
        sources: cacheResult.sources,
        citations: cacheResult.sources,
        rewrittenQuery: retrievalQuery,
        wasRewritten: rewriteResult.wasRewritten,
        cached: true,
        cacheSimilarity: cacheResult.similarity,
        isSufficient: true,
        evidenceScore: 1.0,
      };
    }
  } else {
    stopCacheTimer();
  }

  const stopRetrieveTimer = tracker.startStage('retrieval');
  const retrieval = await retrieveRelevantChunks(retrievalQuery, documentIds, topK, userId);
  stopRetrieveTimer();

  tracker.setMetric('retrievedChunksCount', retrieval.sources?.length || 0);

  if (retrieval.emptyScopeMessage) {
    tracker.finalizeAndLog({ emptyScope: true });
    return {
      answer: retrieval.emptyScopeMessage,
      sources: [],
      citations: [],
      rewrittenQuery: retrievalQuery,
      wasRewritten: rewriteResult.wasRewritten,
      cached: false,
      isSufficient: false,
      evidenceScore: 0,
    };
  }

  // Generate grounded answer using configured LLM Provider
  const stopGenTimer = tracker.startStage('generation');
  const answer = await generateAnswer(question, retrieval.sources, options);
  stopGenTimer();

  // Evidence and Citation Verification
  const stopEvidenceTimer = tracker.startStage('evidenceVerification');
  const verified = verifyAnswerEvidence({
    answer,
    retrievedChunks: retrieval.sources,
    userId,
    validDocumentIds: documentIds,
  });
  stopEvidenceTimer();

  tracker.setMetric('evidenceScore', verified.evidenceScore);

  // Store successful grounded answer in Semantic Cache
  if (userId && answer) {
    storeSemanticCache({
      userId,
      query: retrievalQuery,
      queryEmbedding,
      answer,
      sources: verified.citations && verified.citations.length > 0 ? verified.citations : retrieval.sources,
      documentIds,
      options,
    }).catch(() => {});
  }

  tracker.finalizeAndLog();

  return {
    answer,
    sources: retrieval.sources,
    citations: verified.citations,
    evidenceScore: verified.evidenceScore,
    isSufficient: verified.isSufficient,
    rewrittenQuery: retrievalQuery,
    wasRewritten: rewriteResult.wasRewritten,
    cached: false,
  };
}