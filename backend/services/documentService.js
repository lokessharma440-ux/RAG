import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { PDFParse } from 'pdf-parse';
import { splitIntoChunks } from '../RAG/documentProcessor.js';
import { generateEmbeddings } from '../RAG/embeddingGenerator.js';
import { cosineSimilarity } from '../RAG/vectorStore.js';
import { generateAnswer } from '../RAG/geminiGenerator.js';
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
  return extractTextFromBuffer(buffer, ext);
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
    .limit(limit);

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

  // Delete document record
  await Document.deleteOne(query);

  return true;
}

/**
 * Detects named entities, listed programmes, centres, or categories in query and overview text.
 * E.g. "Digital Foundations", "Code Pathways", "Career Launch", "Devgarh Central", etc.
 *
 * @param {string} text
 * @returns {Array<string>}
 */
export function extractCandidateEntities(text) {
  if (!text) return [];
  const entities = [];

  // 1. Em-dash / hyphen / colon lists: "programmes—Digital Foundations, Code Pathways, and Career Launch"
  const listMatches = text.match(/(?:programmes|centres|courses|categories|departments|phases|modules|items)[—–\-:\s]+([A-Za-z0-9,\s&]+?)(?:\.|\n|—|–|$)/gi) || [];
  for (const m of listMatches) {
    const colonSplit = m.split(/[—–\-:]/);
    if (colonSplit.length > 1) {
      const items = colonSplit[1].split(/,| and | or /i);
      for (const item of items) {
        const trimmed = item.trim().replace(/^[-*•\s]+/, '');
        if (trimmed.length >= 3 && /^[A-Z]/.test(trimmed)) {
          entities.push(trimmed);
        }
      }
    }
  }

  // 2. Capitalized multi-word proper phrases (e.g. "Digital Foundations", "Code Pathways")
  const properPhrases = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) || [];
  const ignorePhrases = new Set([
    'Northstar Community', 'Community Learning', 'Learning Hub', 'Reporting Period',
    'Operations Report', 'Document Version', 'All Rights', 'Executive Director'
  ]);
  for (const phrase of properPhrases) {
    if (!ignorePhrases.has(phrase)) {
      entities.push(phrase);
    }
  }

  return [...new Set(entities)];
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

  // 2. Fetch candidate chunks from database (strictly bounded by chunkFilter)
  const storedChunks = await DocumentChunk.find(chunkFilter).select(
    'documentId chunkIndex text embedding originalName'
  );

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
      documentId: chunk.documentId.toString(),
      originalName: chunk.originalName,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      score: hybridScore,
      vectorScore,
    };
  });

  // 6. Sort by descending score
  scoredChunks.sort((a, b) => b.score - a.score);

  // Stage 1: Candidate Pool Selection (broad candidate retrieval)
  const candidatePoolSize = Math.max(topK * 3, 12);
  let candidatePool = scoredChunks.filter((c) => c.score >= 0.1).slice(0, candidatePoolSize);

  if (candidatePool.length === 0 && scoredChunks.length > 0) {
    candidatePool = scoredChunks.slice(0, Math.min(topK, scoredChunks.length));
  }

  // Stage 2: Multi-Entity Evidence Collection
  // If the query or top overview chunks reference multiple entities or members of a set,
  // ensure each referenced entity has dedicated chunk evidence in the candidates.
  const topOverviewText = candidatePool.slice(0, 3).map((c) => c.text).join('\n');
  const detectedEntities = extractCandidateEntities(question + '\n' + topOverviewText);

  const selectedChunks = [];
  const selectedIndices = new Set();

  // Always include the strongest overall candidate match (e.g. overview/summary)
  if (candidatePool.length > 0) {
    selectedChunks.push(candidatePool[0]);
    selectedIndices.add(`${candidatePool[0].documentId}_${candidatePool[0].chunkIndex}`);
  }

  // Helper to detect if a line looks like an explicit entity heading or bullet definition
  const isEntityHeading = (text, entity) => {
    const lines = text.split('\n');
    const entityLower = entity.toLowerCase();
    for (const line of lines) {
      const l = line.trim();
      if (l.length < 80 && l.toLowerCase().includes(entityLower)) {
        if (/^([A-Z0-9]\.|\#+|\-|\*)\s+/i.test(l) || l.toLowerCase() === entityLower || l.toLowerCase().startsWith(entityLower + ':')) {
          return true;
        }
      }
    }
    return false;
  };

  for (const entity of detectedEntities) {
    const entityLower = entity.toLowerCase();
    const matching = scoredChunks.filter((c) => c.text.toLowerCase().includes(entityLower));
    if (matching.length === 0) continue;

    const rankedForEntity = matching.map((c) => {
      let score = c.score;
      const isHeading = isEntityHeading(c.text, entity);
      if (isHeading) score += 0.5;

      const hasNumbers = /\b\d+\b/.test(c.text);
      const hasEnrol = /(?:enrol|enrolment|enrolments)/i.test(c.text);
      const hasComplete = /(?:complet|completer|completers|completion)/i.test(c.text);
      if (hasNumbers && hasEnrol && hasComplete) score += 0.8;
      else if (hasNumbers && (hasEnrol || hasComplete)) score += 0.2;

      const otherEntities = detectedEntities.filter((e) => e.toLowerCase() !== entityLower);
      const mentionsAllOthers = otherEntities.length > 0 && otherEntities.every((e) => c.text.toLowerCase().includes(e.toLowerCase()));
      if (mentionsAllOthers && !isHeading) score -= 0.4; // Summary list penalty

      return { ...c, entityScore: score };
    }).sort((a, b) => b.entityScore - a.entityScore);

    if (rankedForEntity.length > 0) {
      const best = rankedForEntity[0];
      const key = `${best.documentId}_${best.chunkIndex}`;
      if (!selectedIndices.has(key)) {
        selectedChunks.push(best);
        selectedIndices.add(key);
      }
    }
  }

  // Stage 3: Context Selection & Logical Ordering
  // Fill remaining slots up to targetK with highest scoring candidates
  const targetK = Math.max(topK, 5);
  for (const cand of candidatePool) {
    if (selectedChunks.length >= targetK) break;
    const key = `${cand.documentId}_${cand.chunkIndex}`;
    if (!selectedIndices.has(key)) {
      selectedChunks.push(cand);
      selectedIndices.add(key);
    }
  }

  // Preserve document narrative flow by sorting by documentId and chunkIndex
  selectedChunks.sort((a, b) => {
    if (a.documentId !== b.documentId) return a.documentId.localeCompare(b.documentId);
    return (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0);
  });

  return {
    sources: selectedChunks,
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
  const retrieval = await retrieveRelevantChunks(question, documentIds, topK, userId);

  if (retrieval.emptyScopeMessage) {
    return {
      answer: retrieval.emptyScopeMessage,
      sources: [],
    };
  }

  // Generate grounded answer using configured LLM Provider
  const answer = await generateAnswer(question, retrieval.sources, options);

  return {
    answer,
    sources: retrieval.sources,
  };
}
