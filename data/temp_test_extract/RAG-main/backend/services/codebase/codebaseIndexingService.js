import path from 'path';
import { Codebase } from '../../models/Codebase.js';
import { RepositoryFile } from '../../models/RepositoryFile.js';
import { CodeChunk } from '../../models/CodeChunk.js';
import { CodeRelationship } from '../../models/CodeRelationship.js';
import { discoverRepositoryFiles } from './fileDiscoveryService.js';
import { parseCodeFileIntoChunks } from './codeParserService.js';
import { extractFileRelationships } from './dependencyService.js';
import { generateEmbeddings } from '../../RAG/embeddingGenerator.js';
import { cleanupDirectory } from './zipExtractionService.js';

/**
 * Updates codebase progress and status in MongoDB.
 *
 * @param {string} codebaseId
 * @param {string} status
 * @param {number} percentage
 * @param {string} stage
 * @param {string} message
 */
export async function updateCodebaseProgress(codebaseId, status, percentage, stage, message) {
  try {
    await Codebase.findByIdAndUpdate(codebaseId, {
      status,
      progress: {
        stage,
        percentage,
        message,
      },
    });
  } catch (err) {
    console.warn(`[Codebase Progress Warning] Could not update ${codebaseId}:`, err.message);
  }
}

/**
 * Ingests, parses, embeds, and indexes a repository from an extracted local directory.
 * Guarantees temporary directory cleanup in finally block.
 *
 * @param {string} codebaseId
 * @param {string} tempExtractDir
 * @param {string} [rootPrefix='']
 * @param {string|null} [tempZipPath=null]
 */
export async function processAndIndexRepository(codebaseId, tempExtractDir, rootPrefix = '', tempZipPath = null) {
  const codebase = await Codebase.findById(codebaseId);
  if (!codebase) return;

  const ownerUserId = codebase.ownerUserId;

  try {
    // 1. DISCOVERING_FILES (15%)
    await updateCodebaseProgress(codebaseId, 'discovering_files', 15, 'discovering_files', 'Discovering and filtering source code files...');
    const discoveredFiles = await discoverRepositoryFiles(tempExtractDir, rootPrefix);

    if (discoveredFiles.length === 0) {
      throw new Error('No supported, indexable source-code files were found in this repository.');
    }

    // Compute language statistics
    const languageMap = {};
    let totalLines = 0;
    for (const f of discoveredFiles) {
      totalLines += f.lineCount;
      if (!languageMap[f.language]) {
        languageMap[f.language] = { name: f.language, count: 0, bytes: 0 };
      }
      languageMap[f.language].count++;
      languageMap[f.language].bytes += f.sizeBytes;
    }
    const languagesArray = Object.values(languageMap).sort((a, b) => b.bytes - a.bytes);

    // 2. PARSING (35%)
    await updateCodebaseProgress(codebaseId, 'parsing', 35, 'parsing', `Parsing code structure and extracting symbols across ${discoveredFiles.length} files...`);

    const fileDocsToInsert = [];
    const chunksToInsert = [];
    const relationshipsToInsert = [];

    for (const file of discoveredFiles) {
      // Chunk code file with line numbers
      const parsedChunks = parseCodeFileIntoChunks(file.content, file.relativePath, file.language);

      // Extract cross-file relationships
      const rels = extractFileRelationships(file.relativePath, file.content, file.language, codebaseId, ownerUserId);
      relationshipsToInsert.push(...rels);

      fileDocsToInsert.push({
        ownerUserId,
        repositoryId: codebaseId,
        relativePath: file.relativePath,
        language: file.language,
        extension: file.extension,
        fileSize: file.sizeBytes,
        fileHash: file.contentHash,
        lineCount: file.lineCount,
        content: file.content,
        chunkCount: parsedChunks.length,
      });

      for (const chunk of parsedChunks) {
        chunksToInsert.push({
          ownerUserId,
          repositoryId: codebaseId,
          relativePath: file.relativePath,
          language: file.language,
          chunkType: chunk.chunkType,
          symbolName: chunk.symbolName,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          contentHash: chunk.contentHash,
          rawTextForEmbedding: `${file.relativePath} ${chunk.symbolName || ''}\n${chunk.content}`,
        });
      }
    }

    // Persist RepositoryFiles first
    const savedFiles = await RepositoryFile.insertMany(fileDocsToInsert, { ordered: false });
    const fileIdMap = new Map();
    for (const sf of savedFiles) {
      fileIdMap.set(sf.relativePath, sf._id);
    }

    // 3. EMBEDDING (60%)
    await updateCodebaseProgress(codebaseId, 'embedding', 60, 'embedding', `Computing 384-d local vector embeddings for ${chunksToInsert.length} code chunks...`);

    // Batch embedding generation in chunks of 16 to keep memory smooth
    const BATCH_SIZE = 16;
    for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
      const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
      const textsToEmbed = batch.map((c) => c.rawTextForEmbedding);
      const embeddings = await generateEmbeddings(textsToEmbed);

      for (let j = 0; j < batch.length; j++) {
        batch[j].embedding = embeddings[j];
        batch[j].fileId = fileIdMap.get(batch[j].relativePath) || savedFiles[0]._id;
        delete batch[j].rawTextForEmbedding;
      }

      const pct = Math.min(85, Math.round(60 + (i / chunksToInsert.length) * 25));
      await updateCodebaseProgress(codebaseId, 'embedding', pct, 'embedding', `Indexed ${Math.min(i + BATCH_SIZE, chunksToInsert.length)} of ${chunksToInsert.length} code chunks...`);
    }

    // 4. INDEXING (85%)
    await updateCodebaseProgress(codebaseId, 'indexing', 85, 'indexing', 'Persisting vector indexes and cross-file relationships...');

    if (chunksToInsert.length > 0) {
      await CodeChunk.insertMany(chunksToInsert, { ordered: false });
    }

    if (relationshipsToInsert.length > 0) {
      await CodeRelationship.insertMany(relationshipsToInsert, { ordered: false });
    }

    // 5. READY (100%)
    await Codebase.findByIdAndUpdate(codebaseId, {
      status: 'ready',
      progress: {
        stage: 'ready',
        percentage: 100,
        message: 'Repository successfully indexed and ready for intelligence queries.',
      },
      stats: {
        totalFiles: discoveredFiles.length,
        indexedFiles: discoveredFiles.length,
        skippedFiles: 0,
        totalChunks: chunksToInsert.length,
        totalLines,
        languages: languagesArray,
      },
      errorMessage: null,
    });
  } catch (err) {
    console.error(`[Indexing Error] Repository ${codebaseId} indexing failed:`, err);
    await Codebase.findByIdAndUpdate(codebaseId, {
      status: 'failed',
      progress: {
        stage: 'failed',
        percentage: 0,
        message: err.message || 'Indexing failed.',
      },
      errorMessage: err.message || 'Repository indexing failed.',
    });
  } finally {
    // Guaranteed cleanup of temporary directory and archive
    if (tempExtractDir) await cleanupDirectory(tempExtractDir);
    if (tempZipPath) await cleanupDirectory(path.dirname(tempZipPath));
  }
}

/**
 * Deletes a codebase and all its associated files, chunks, and relationships from MongoDB.
 *
 * @param {string} codebaseId
 * @param {string} ownerUserId
 * @returns {Promise<boolean>}
 */
export async function deleteCodebaseCascade(codebaseId, ownerUserId) {
  const codebase = await Codebase.findOne({ _id: codebaseId, ownerUserId });
  if (!codebase) return false;

  await Promise.all([
    Codebase.deleteOne({ _id: codebaseId, ownerUserId }),
    RepositoryFile.deleteMany({ repositoryId: codebaseId, ownerUserId }),
    CodeChunk.deleteMany({ repositoryId: codebaseId, ownerUserId }),
    CodeRelationship.deleteMany({ repositoryId: codebaseId, ownerUserId }),
  ]);

  return true;
}
