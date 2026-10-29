import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authenticateUser } from '../middleware/authMiddleware.js';
import { Codebase } from '../models/Codebase.js';
import { RepositoryFile } from '../models/RepositoryFile.js';
import {
  validateGitHubUrl,
  fetchGitHubRepoMetadata,
  downloadGitHubArchive,
} from '../services/codebase/githubService.js';
import {
  validateAndExtractZip,
  ZIP_LIMITS,
} from '../services/codebase/zipExtractionService.js';
import {
  processAndIndexRepository,
  deleteCodebaseCascade,
} from '../services/codebase/codebaseIndexingService.js';
import { queryCodebase } from '../services/codebase/codebaseRetrievalService.js';
import {
  getRepositoryDependencyGraph,
  analyzeImpact,
} from '../services/codebase/dependencyService.js';
import { runSecurityAudit } from '../services/codebase/securityAnalysisService.js';
import { generateCodebaseDocumentation } from '../services/codebase/documentationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempUploadDir = path.resolve(__dirname, '../uploads/temp');

if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `upload_${uniqueSuffix}.zip`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: ZIP_LIMITS.MAX_ARCHIVE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip' || file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed') {
      cb(null, true);
    } else {
      cb(new Error('Only .zip archive files are supported.'));
    }
  },
});

const router = express.Router();

// Enforce authentication on all codebase intelligence routes
router.use(authenticateUser);

/**
 * POST /api/codebases/github
 * Import and index a public GitHub repository.
 */
router.post('/github', async (req, res) => {
  const { url } = req.body;
  const validation = validateGitHubUrl(url);

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: validation.error,
    });
  }

  const { owner, repo, branch, normalizedUrl } = validation;

  try {
    // 1. Fetch metadata
    const metadata = await fetchGitHubRepoMetadata(owner, repo);

    // 2. Create Codebase document in DB
    const codebase = await Codebase.create({
      ownerUserId: req.user._id,
      name: metadata.name || repo,
      description: metadata.description || `Imported from ${normalizedUrl}`,
      sourceType: 'github',
      sourceUrl: normalizedUrl,
      defaultBranch: branch || metadata.defaultBranch || 'main',
      indexedCommitSha: metadata.commitSha,
      status: 'fetching',
      progress: {
        stage: 'fetching',
        percentage: 5,
        message: 'Downloading repository archive from GitHub...',
      },
    });

    // 3. Kick off async ingestion job
    const runIngestion = async () => {
      const extractDir = path.resolve(tempUploadDir, `repo_${codebase._id}_${Date.now()}`);
      let archivePath = null;
      try {
        const downloadRes = await downloadGitHubArchive(owner, repo, codebase.defaultBranch, tempUploadDir);
        archivePath = downloadRes.archivePath;

        const { rootPrefix } = await validateAndExtractZip(archivePath, extractDir);
        await processAndIndexRepository(codebase._id, extractDir, rootPrefix, archivePath);
      } catch (err) {
        console.error(`[GitHub Ingestion Error] ${codebase._id}:`, err);
        await Codebase.findByIdAndUpdate(codebase._id, {
          status: 'failed',
          progress: { stage: 'failed', percentage: 0, message: err.message },
          errorMessage: err.message || 'GitHub import failed.',
        });
      }
    };

    // Run in background
    runIngestion().catch(() => {});

    return res.status(201).json({
      success: true,
      message: `Repository "${metadata.name}" import initiated.`,
      data: codebase,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to initiate GitHub import.',
    });
  }
});

/**
 * POST /api/codebases/upload
 * Upload and index a ZIP archive of a repository.
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'A ZIP archive file is required.',
    });
  }

  const rawName = req.body.name || req.file.originalname.replace(/\.zip$/i, '');
  const repoName = rawName.slice(0, 100).trim();
  const zipPath = req.file.path;
  const extractDir = path.resolve(tempUploadDir, `zip_${Date.now()}_${Math.round(Math.random() * 1e6)}`);

  try {
    // 1. Create Codebase document
    const codebase = await Codebase.create({
      ownerUserId: req.user._id,
      name: repoName || 'Uploaded Codebase',
      description: 'Imported from local ZIP archive',
      sourceType: 'zip',
      status: 'extracting',
      progress: {
        stage: 'extracting',
        percentage: 5,
        message: 'Extracting and validating archive structure...',
      },
    });

    // 2. Kick off async ingestion job
    const runIngestion = async () => {
      try {
        const { rootPrefix } = await validateAndExtractZip(zipPath, extractDir);
        await processAndIndexRepository(codebase._id, extractDir, rootPrefix, zipPath);
      } catch (err) {
        console.error(`[ZIP Ingestion Error] ${codebase._id}:`, err);
        await Codebase.findByIdAndUpdate(codebase._id, {
          status: 'failed',
          progress: { stage: 'failed', percentage: 0, message: err.message },
          errorMessage: err.message || 'ZIP extraction and indexing failed.',
        });
      }
    };

    runIngestion().catch(() => {});

    return res.status(201).json({
      success: true,
      message: `ZIP archive "${req.file.originalname}" upload received. Indexing started.`,
      data: codebase,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to process ZIP upload.',
    });
  }
});

/**
 * GET /api/codebases
 * List all repositories owned by the authenticated user.
 */
router.get('/', async (req, res) => {
  try {
    const codebases = await Codebase.find({ ownerUserId: req.user._id }).sort({ createdAt: -1 });
    return res.json({
      success: true,
      count: codebases.length,
      data: codebases,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve codebases.',
    });
  }
});

/**
 * GET /api/codebases/:id
 * Retrieve single repository metadata and progress.
 */
router.get('/:id', async (req, res) => {
  try {
    const codebase = await Codebase.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!codebase) {
      return res.status(404).json({
        success: false,
        message: 'Repository not found or access denied.',
      });
    }
    return res.json({
      success: true,
      data: codebase,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve repository.',
    });
  }
});

/**
 * GET /api/codebases/:id/status
 * Real-time status and progress polling.
 */
router.get('/:id/status', async (req, res) => {
  try {
    const codebase = await Codebase.findOne({ _id: req.params.id, ownerUserId: req.user._id }).select('status progress stats errorMessage');
    if (!codebase) {
      return res.status(404).json({
        success: false,
        message: 'Repository not found.',
      });
    }
    return res.json({
      success: true,
      data: codebase,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to check status.',
    });
  }
});

/**
 * DELETE /api/codebases/:id
 * Cascade-delete repository and all associated files, chunks, and relationships.
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteCodebaseCascade(req.params.id, req.user._id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Repository not found or access denied.',
      });
    }
    return res.json({
      success: true,
      message: 'Repository and all associated vector indexes deleted successfully.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete repository.',
    });
  }
});

/**
 * GET /api/codebases/:id/files
 * Fetch list of indexed files with language filters and pagination.
 */
router.get('/:id/files', async (req, res) => {
  try {
    const { language, search } = req.query;
    const query = { repositoryId: req.params.id, ownerUserId: req.user._id };

    if (language) {
      query.language = language.toLowerCase();
    }
    if (search) {
      query.relativePath = { $regex: search, $options: 'i' };
    }

    const files = await RepositoryFile.find(query)
      .select('relativePath language extension fileSize lineCount chunkCount')
      .sort({ relativePath: 1 })
      .limit(200);

    return res.json({
      success: true,
      count: files.length,
      data: files,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve repository files.',
    });
  }
});

/**
 * GET /api/codebases/:id/files/content
 * Retrieve raw source text for the code viewer.
 */
router.get('/:id/files/content', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ success: false, message: 'File path query parameter is required.' });
    }

    const file = await RepositoryFile.findOne({
      repositoryId: req.params.id,
      ownerUserId: req.user._id,
      relativePath: filePath,
    }).select('relativePath language lineCount content chunkCount');

    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found in this repository.' });
    }

    return res.json({
      success: true,
      data: file,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load file content.',
    });
  }
});

/**
 * POST /api/codebases/:id/chat
 * Ask questions grounded strictly in the repository code.
 */
router.post('/:id/chat', async (req, res) => {
  const rawQuestion = req.body.question || req.body.message || req.body.query || req.body.prompt;
  const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : '';

  if (!question) {
    return res.status(400).json({
      success: false,
      message: 'A valid question string is required in the request body.',
    });
  }

  try {
    const result = await queryCodebase(question, req.params.id, req.user._id, {
      topK: typeof req.body.topK === 'number' ? req.body.topK : 5,
    });

    return res.json({
      success: true,
      data: {
        question,
        answer: result.answer,
        reply: result.answer,
        sources: result.sources,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Error processing codebase query.',
    });
  }
});

/**
 * GET /api/codebases/:id/dependencies
 * Get relationship graph.
 */
router.get('/:id/dependencies', async (req, res) => {
  try {
    const graph = await getRepositoryDependencyGraph(req.params.id, req.user._id);
    return res.json({
      success: true,
      data: graph,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load dependency graph.',
    });
  }
});

/**
 * GET /api/codebases/:id/impact
 * Run downstream impact analysis for a file or symbol.
 */
router.get('/:id/impact', async (req, res) => {
  const target = req.query.target;
  if (!target) {
    return res.status(400).json({
      success: false,
      message: 'Target query parameter (file path or symbol name) is required.',
    });
  }

  try {
    const report = await analyzeImpact(req.params.id, req.user._id, target);
    return res.json({
      success: true,
      data: report,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Impact analysis failed.',
    });
  }
});

/**
 * POST /api/codebases/:id/security-analysis
 * Execute static security audit on repository files.
 */
router.post('/:id/security-analysis', async (req, res) => {
  try {
    const findings = await runSecurityAudit(req.params.id, req.user._id);
    return res.json({
      success: true,
      count: findings.length,
      data: findings,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Security audit failed.',
    });
  }
});

/**
 * POST /api/codebases/:id/documentation
 * Generate grounded Markdown documentation.
 */
router.post('/:id/documentation', async (req, res) => {
  const { docType } = req.body;
  try {
    const result = await generateCodebaseDocumentation(req.params.id, req.user._id, docType || 'overview');
    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to generate documentation.',
    });
  }
});

export default router;
