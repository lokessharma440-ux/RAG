import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { enqueueHeavyJob } from '../../utils/heavyJobQueue.js';
import { logMemory } from '../../utils/memoryDiagnostics.js';
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
export async function processAndIndexRepository(codebaseId, tempExtractDir, rootPrefix = '', tempZipPath = null, options = {}) {
  return enqueueHeavyJob(async () => {
    const codebase = await Codebase.findById(codebaseId);
    if (!codebase) return;

    const ownerUserId = codebase.ownerUserId;
    logMemory('CodebaseIndexing:Start', { codebaseId });

    const t0 = performance.now();
    let fileDiscoveryMs = 0;
    let changeDetectionMs = 0;
    let parsingMs = 0;
    let embeddingMs = 0;
    let indexingMs = 0;

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
      fileDiscoveryMs = Math.round(performance.now() - t0);

      // 2. INCREMENTAL CHANGE DETECTION & PRUNING
      await updateCodebaseProgress(codebaseId, 'discovering_files', 25, 'discovering_files', 'Comparing file hashes against existing index...');

      const existingFiles = await RepositoryFile.find({ repositoryId: codebaseId, ownerUserId }).lean();
      const existingFileMap = new Map();
      for (const ef of existingFiles) {
        existingFileMap.set(ef.relativePath, ef);
      }

      const discoveredMap = new Map();
      for (const df of discoveredFiles) {
        discoveredMap.set(df.relativePath, df);
      }

      // Identify deleted files (previously indexed but no longer present)
      const deletedFileIds = [];
      const deletedRelativePaths = [];
      for (const ef of existingFiles) {
        if (!discoveredMap.has(ef.relativePath)) {
          deletedFileIds.push(ef._id);
          deletedRelativePaths.push(ef.relativePath);
        }
      }

      if (deletedFileIds.length > 0) {
        await Promise.all([
          RepositoryFile.deleteMany({ _id: { $in: deletedFileIds } }),
          CodeChunk.deleteMany({ fileId: { $in: deletedFileIds } }),
          CodeRelationship.deleteMany({
            repositoryId: codebaseId,
            sourcePath: { $in: deletedRelativePaths },
          }),
        ]);
        console.log(`[Incremental Indexing] Pruned ${deletedFileIds.length} deleted files from codebase ${codebaseId}`);
      }

      // Classify discovered files: unchanged vs modified vs new
      const filesToProcess = [];
      let unchangedFilesCount = 0;

      for (const file of discoveredFiles) {
        const existing = existingFileMap.get(file.relativePath);
        if (existing && existing.fileHash === file.contentHash) {
          unchangedFilesCount++;
        } else {
          filesToProcess.push({ file, existing });
        }
      }

      const modifiedFilesCount = filesToProcess.filter((f) => Boolean(f.existing)).length;
      const newFilesCount = filesToProcess.length - modifiedFilesCount;
      changeDetectionMs = Math.round(performance.now() - (t0 + fileDiscoveryMs));

      console.log(
        `[Incremental Indexing] Total: ${discoveredFiles.length} | Unchanged: ${unchangedFilesCount} | Modified: ${modifiedFilesCount} | New: ${newFilesCount} | Deleted: ${deletedFileIds.length}`
      );

      // Fast Path: If all files are completely unchanged, avoid 100% of parsing and embedding
      if (filesToProcess.length === 0 && deletedFileIds.length === 0 && existingFiles.length > 0) {
        const totalDurationMs = Math.round(performance.now() - t0);
        const totalChunksCount = await CodeChunk.countDocuments({ repositoryId: codebaseId, ownerUserId });
        await Codebase.findByIdAndUpdate(codebaseId, {
          status: 'ready',
          progress: {
            stage: 'ready',
            percentage: 100,
            message: `All ${discoveredFiles.length} files verified unchanged. Reused existing vector indexes.`,
          },
          stats: {
            totalFiles: discoveredFiles.length,
            indexedFiles: discoveredFiles.length,
            skippedFiles: 0,
            totalChunks: totalChunksCount,
            totalLines,
            languages: languagesArray,
            timings: {
              fileDiscoveryMs,
              changeDetectionMs,
              parsingMs: 0,
              embeddingMs: 0,
              indexingMs: 0,
              totalDurationMs,
            },
          },
          incrementalStats: {
            unchangedFiles: unchangedFilesCount,
            modifiedFiles: 0,
            newFiles: 0,
            deletedFiles: 0,
            reusedChunks: totalChunksCount,
            newChunksEmbedded: 0,
          },
          errorMessage: null,
        });

        console.log(`[DEVMIND_METRICS] Codebase ${codebaseId} zero-cost re-index in ${totalDurationMs}ms (Discovery: ${fileDiscoveryMs}ms | Diff: ${changeDetectionMs}ms)`);
        logMemory('CodebaseIndexing:IncrementalZeroCostDone', { codebaseId, files: discoveredFiles.length, totalDurationMs });
        return;
      }

      // 3. PARSING CHANGED & NEW FILES (35%)
      await updateCodebaseProgress(
        codebaseId,
        'parsing',
        35,
        'parsing',
        `Parsing ${filesToProcess.length} modified/new files (${unchangedFilesCount} unchanged reused)...`
      );

      const chunksToInsert = [];
      const relationshipsToInsert = [];
      const fileIdMap = new Map();

      // Preserve IDs of unchanged files
      for (const ef of existingFiles) {
        if (!deletedRelativePaths.includes(ef.relativePath) && !filesToProcess.some((p) => p.file.relativePath === ef.relativePath)) {
          fileIdMap.set(ef.relativePath, ef._id);
        }
      }

      // Batch delete old chunks and relationships for modified files in a single pass
      const modifiedFiles = filesToProcess.filter((p) => Boolean(p.existing));
      if (modifiedFiles.length > 0) {
        const modifiedFileIds = modifiedFiles.map((m) => m.existing._id);
        const modifiedFilePaths = modifiedFiles.map((m) => m.file.relativePath);
        await Promise.all([
          CodeChunk.deleteMany({ fileId: { $in: modifiedFileIds } }),
          CodeRelationship.deleteMany({
            repositoryId: codebaseId,
            sourcePath: { $in: modifiedFilePaths },
          }),
        ]);
      }

      const repositoryFileOps = [];

      for (const { file, existing } of filesToProcess) {
        const parsedChunks = parseCodeFileIntoChunks(file.content, file.relativePath, file.language);
        const rels = extractFileRelationships(file.relativePath, file.content, file.language, codebaseId, ownerUserId);
        relationshipsToInsert.push(...rels);

        let fileId;
        if (existing) {
          fileId = existing._id;
          repositoryFileOps.push({
            updateOne: {
              filter: { _id: existing._id },
              update: {
                $set: {
                  fileHash: file.contentHash,
                  fileSize: file.sizeBytes,
                  lineCount: file.lineCount,
                  content: file.content,
                  chunkCount: parsedChunks.length,
                  language: file.language,
                  extension: file.extension,
                },
              },
            },
          });
        } else {
          fileId = new mongoose.Types.ObjectId();
          repositoryFileOps.push({
            insertOne: {
              document: {
                _id: fileId,
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
              },
            },
          });
        }

        fileIdMap.set(file.relativePath, fileId);

        for (const chunk of parsedChunks) {
          chunksToInsert.push({
            ownerUserId,
            repositoryId: codebaseId,
            fileId,
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

      // Execute single bulkWrite for all modified/new RepositoryFiles
      if (repositoryFileOps.length > 0) {
        await RepositoryFile.bulkWrite(repositoryFileOps, { ordered: false });
      }

      parsingMs = Math.round(performance.now() - (t0 + fileDiscoveryMs + changeDetectionMs));

      // 4. EMBEDDING (60%)
      const chunksToEmbedCount = chunksToInsert.length;
      await updateCodebaseProgress(
        codebaseId,
        'embedding',
        60,
        'embedding',
        chunksToEmbedCount > 0
          ? `Computing embeddings for ${chunksToEmbedCount} new/modified chunks...`
          : 'No chunks require embedding (all reused from existing index)...'
      );

      const BATCH_SIZE = parseInt(process.env.CODEBASE_EMBEDDING_BATCH_SIZE, 10) || 2;
      let lastReportedPct = 60;

      for (let i = 0; i < chunksToEmbedCount; i += BATCH_SIZE) {
        const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
        const textsToEmbed = batch.map((c) => c.rawTextForEmbedding);
        const embeddings = await generateEmbeddings(textsToEmbed);

        for (let j = 0; j < batch.length; j++) {
          batch[j].embedding = embeddings[j];
          delete batch[j].rawTextForEmbedding;
        }

        await CodeChunk.insertMany(batch, { ordered: false });

        for (let j = 0; j < batch.length; j++) {
          chunksToInsert[i + j] = null;
        }

        const processedCount = Math.min(i + BATCH_SIZE, chunksToEmbedCount);
        const pct = Math.min(85, Math.round(60 + (processedCount / chunksToEmbedCount) * 25));

        if (pct >= lastReportedPct + 2 || processedCount === chunksToEmbedCount) {
          lastReportedPct = pct;
          await updateCodebaseProgress(
            codebaseId,
            'embedding',
            pct,
            'embedding',
            `Computing embeddings: ${processedCount} of ${chunksToEmbedCount} chunks`
          );
        }

        batch.length = 0;
        await new Promise((resolve) => setImmediate(resolve));
      }

      embeddingMs = Math.round(performance.now() - (t0 + fileDiscoveryMs + changeDetectionMs + parsingMs));

      // 5. INDEXING RELATIONSHIPS (85%)
      await updateCodebaseProgress(codebaseId, 'indexing', 85, 'indexing', 'Persisting updated vector indexes and dependencies...');

      if (relationshipsToInsert.length > 0) {
        await CodeRelationship.insertMany(relationshipsToInsert, { ordered: false });
        relationshipsToInsert.length = 0;
      }

      // Count total chunks in repository (both existing unchanged and newly added)
      const finalTotalChunks = await CodeChunk.countDocuments({ repositoryId: codebaseId, ownerUserId });

      indexingMs = Math.round(performance.now() - (t0 + fileDiscoveryMs + changeDetectionMs + parsingMs + embeddingMs));
      const totalDurationMs = Math.round(performance.now() - t0);

      // 6. READY (100%)
      await Codebase.findByIdAndUpdate(codebaseId, {
        status: 'ready',
        progress: {
          stage: 'ready',
          percentage: 100,
          message: `Repository indexed: ${unchangedFilesCount} unchanged, ${modifiedFilesCount} modified, ${newFilesCount} new, ${deletedFileIds.length} deleted.`,
        },
        stats: {
          totalFiles: discoveredFiles.length,
          indexedFiles: discoveredFiles.length,
          skippedFiles: 0,
          totalChunks: finalTotalChunks,
          totalLines,
          languages: languagesArray,
          timings: {
            fileDiscoveryMs,
            changeDetectionMs,
            parsingMs,
            embeddingMs,
            indexingMs,
            totalDurationMs,
          },
        },
        incrementalStats: {
          unchangedFiles: unchangedFilesCount,
          modifiedFiles: modifiedFilesCount,
          newFiles: newFilesCount,
          deletedFiles: deletedFileIds.length,
          reusedChunks: finalTotalChunks - chunksToEmbedCount,
          newChunksEmbedded: chunksToEmbedCount,
        },
        errorMessage: null,
      });

      console.log(
        `[DEVMIND_METRICS] Codebase ${codebaseId} Indexed in ${totalDurationMs}ms (Discovery: ${fileDiscoveryMs}ms | Diff: ${changeDetectionMs}ms | Parse: ${parsingMs}ms | Embed: ${embeddingMs}ms | Index: ${indexingMs}ms)`
      );
      logMemory('CodebaseIndexing:Done', { codebaseId, totalChunks: finalTotalChunks, timings: { totalDurationMs, embeddingMs } });
    } catch (err) {
      console.error(`[Indexing Error] Repository ${codebaseId} indexing failed:`, err);
      logMemory('CodebaseIndexing:Failed', { codebaseId, error: err.message });
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
      // Guaranteed cleanup of temporary directory and archive file without deleting parent temp directory
      if (tempExtractDir && !options.preserveTempDir) await cleanupDirectory(tempExtractDir);
      if (tempZipPath) {
        try {
          if (fs.existsSync(tempZipPath)) {
            const stat = await fs.promises.stat(tempZipPath);
            if (stat.isDirectory()) {
              await cleanupDirectory(tempZipPath);
            } else {
              await fs.promises.unlink(tempZipPath);
            }
          }
        } catch (cleanErr) {
          console.warn(`[Cleanup Warning] Could not remove ${tempZipPath}:`, cleanErr.message);
        }
      }
    }
  }, { type: 'codebase_indexing', codebaseId });
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
