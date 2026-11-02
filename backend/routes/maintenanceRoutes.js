import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../models/User.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { Codebase } from '../models/Codebase.js';
import { RepositoryFile } from '../models/RepositoryFile.js';
import { CodeChunk } from '../models/CodeChunk.js';
import { CodeRelationship } from '../models/CodeRelationship.js';
import { RepositoryAnalysis } from '../models/RepositoryAnalysis.js';
import { AIFixPrompt } from '../models/AIFixPrompt.js';
import { GeneratedDocument } from '../models/GeneratedDocument.js';
import { GitHubPublication } from '../models/GitHubPublication.js';
import { Project } from '../models/Project.js';
import { SemanticCacheEntry } from '../models/SemanticCacheEntry.js';
import { purgeStaleTempFiles } from '../services/documentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempUploadDir = path.resolve(__dirname, '../uploads/temp');

const router = express.Router();

/**
 * POST /api/maintenance/reset-database
 * Wipes all data across all collections in the database.
 * Used for full clean re-tests as requested by administrator.
 */
router.post('/reset-database', async (req, res) => {
  try {
    const [
      users,
      documents,
      documentChunks,
      codebases,
      repositoryFiles,
      codeChunks,
      codeRelationships,
      repositoryAnalyses,
      aiFixPrompts,
      generatedDocuments,
      githubPublications,
      projects,
      semanticCache,
    ] = await Promise.all([
      User.deleteMany({}),
      Document.deleteMany({}),
      DocumentChunk.deleteMany({}),
      Codebase.deleteMany({}),
      RepositoryFile.deleteMany({}),
      CodeChunk.deleteMany({}),
      CodeRelationship.deleteMany({}),
      RepositoryAnalysis.deleteMany({}),
      AIFixPrompt.deleteMany({}),
      GeneratedDocument.deleteMany({}),
      GitHubPublication.deleteMany({}),
      Project.deleteMany({}),
      SemanticCacheEntry.deleteMany({}),
    ]);

    await purgeStaleTempFiles(tempUploadDir, 0);

    return res.json({
      success: true,
      message: 'All collections and stored data in the database have been completely wiped.',
      purged: {
        users: users.deletedCount,
        documents: documents.deletedCount,
        documentChunks: documentChunks.deletedCount,
        codebases: codebases.deletedCount,
        repositoryFiles: repositoryFiles.deletedCount,
        codeChunks: codeChunks.deletedCount,
        codeRelationships: codeRelationships.deletedCount,
        repositoryAnalyses: repositoryAnalyses.deletedCount,
        aiFixPrompts: aiFixPrompts.deletedCount,
        generatedDocuments: generatedDocuments.deletedCount,
        githubPublications: githubPublications.deletedCount,
        projects: projects.deletedCount,
        semanticCache: semanticCache.deletedCount,
      },
    });
  } catch (err) {
    console.error('[Maintenance Error] Database reset failed:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to reset database: ${err.message}`,
    });
  }
});

export default router;

