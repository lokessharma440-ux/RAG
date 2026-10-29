/**
 * auditRoutes.js
 *
 * REST API routes for DevMind AI Codebase Auditor:
 * - Automated Codebase Analysis execution & status tracking
 * - Architecture, Security, Dependency, Quality Findings & Prioritised Recommendations
 * - Documentation Inventory & Inconsistency Detection
 * - Grounded Document Generation (README, ARCHITECTURE, PRD, API, etc.)
 * - Document Review, In-place Editing & Verification
 * - Safe Markdown & ZIP Bundle Downloads (Path-traversal protected)
 * - Safe GitHub Pull Request Publishing (Never touches default branch directly)
 */

import express from 'express';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import rateLimit from 'express-rate-limit';
import { authenticateUser } from '../middleware/authMiddleware.js';
import { Codebase } from '../models/Codebase.js';
import { RepositoryAnalysis } from '../models/RepositoryAnalysis.js';
import { GeneratedDocument } from '../models/GeneratedDocument.js';
import { GitHubPublication } from '../models/GitHubPublication.js';
import { runFullCodebaseAudit } from '../services/codebase/codebaseAuditService.js';
import { buildDocumentationInventory } from '../services/codebase/documentationInventoryService.js';
import { generateDoc, VALID_DOC_TYPES } from '../services/codebase/enhancedDocumentationService.js';
import { validateGitHubUrl } from '../services/codebase/githubService.js';

const router = express.Router();

// Enforce authentication across all audit routes
router.use(authenticateUser);

// Rate limiter for CPU/LLM intensive analysis triggering
const analyzeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 20, // 20 analyses per hour per user/IP
  message: {
    success: false,
    message: 'Analysis request limit reached. Please wait before running more repository audits.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── In-memory active analysis tracker ─────────────────────────────────────────
const activeAnalyses = new Map();

/**
 * Helper to verify repository ownership and existence.
 */
async function verifyRepositoryOwnership(repositoryId, userId) {
  if (!repositoryId || !repositoryId.match(/^[0-9a-fA-F]{24}$/)) {
    return null;
  }
  return Codebase.findOne({ _id: repositoryId, ownerUserId: userId });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REPOSITORY ANALYSIS WORKFLOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/codebases/:repositoryId/analyze
 * Initiates an evidence-backed codebase audit job.
 */
router.post('/:repositoryId/analyze', analyzeLimiter, async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({
        success: false,
        message: 'Repository not found or access denied.',
      });
    }

    if (codebase.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `Repository is currently in status "${codebase.status}". It must be fully indexed ('ready') before running an audit.`,
      });
    }

    const repoIdStr = codebase._id.toString();

    // Prevent duplicate simultaneous analysis runs on the same repository
    if (activeAnalyses.has(repoIdStr)) {
      return res.status(409).json({
        success: false,
        message: 'An audit is already running for this repository.',
        data: { analysisId: activeAnalyses.get(repoIdStr) },
      });
    }

    // Create analysis tracking record in MongoDB
    const analysis = await RepositoryAnalysis.create({
      ownerUserId: req.user._id,
      repositoryId: codebase._id,
      commitSha: codebase.indexedCommitSha || null,
      analysisVersion: '1.0',
      status: 'pending',
      summary: 'Analysis queued...',
      startedAt: new Date(),
    });

    const analysisId = analysis._id.toString();
    activeAnalyses.set(repoIdStr, analysisId);

    // Run audit asynchronously in background
    (async () => {
      try {
        await RepositoryAnalysis.findByIdAndUpdate(analysisId, {
          status: 'running',
          summary: 'Scanning architecture, security patterns, dependencies, and code quality...',
        });

        const auditResult = await runFullCodebaseAudit(codebase._id, req.user._id);

        // Generate high-level summary
        const findingCount = auditResult.findings.length;
        const criticalCount = auditResult.findings.filter((f) => f.severity === 'CRITICAL').length;
        const highCount = auditResult.findings.filter((f) => f.severity === 'HIGH').length;

        const summary = `Completed audit for ${codebase.name} (${auditResult.stack?.projectType || 'detected'} stack). Identified ${findingCount} finding(s) (${criticalCount} critical, ${highCount} high priority) and ${auditResult.recommendations.length} actionable recommendation(s).`;

        await RepositoryAnalysis.findByIdAndUpdate(analysisId, {
          status: 'completed',
          detectedStack: auditResult.stack,
          summary,
          categorySummaries: auditResult.categorySummaries,
          findings: auditResult.findings,
          recommendations: auditResult.recommendations,
          completedAt: new Date(),
          errorMessage: null,
        });
      } catch (err) {
        console.error(`[Codebase Audit Error] Repository ${codebase._id}:`, err);
        await RepositoryAnalysis.findByIdAndUpdate(analysisId, {
          status: 'failed',
          errorMessage: err.message || 'Audit execution encountered an unexpected error.',
          completedAt: new Date(),
        });
      } finally {
        activeAnalyses.delete(repoIdStr);
      }
    })().catch(() => {});

    return res.status(202).json({
      success: true,
      message: 'Codebase audit initiated successfully.',
      data: {
        analysisId: analysis._id,
        status: 'pending',
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to start codebase analysis.',
    });
  }
});

/**
 * GET /api/codebases/:repositoryId/analysis
 * Returns the most recent completed or running analysis.
 */
router.get('/:repositoryId/analysis', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found or access denied.' });
    }

    const latestAnalysis = await RepositoryAnalysis.findOne({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    }).sort({ createdAt: -1 });

    if (!latestAnalysis) {
      return res.json({
        success: true,
        data: null,
        message: 'No analysis has been run for this repository yet.',
      });
    }

    return res.json({
      success: true,
      data: latestAnalysis,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve analysis.',
    });
  }
});

/**
 * GET /api/codebases/:repositoryId/analysis/status
 * Returns lightweight polling status for active analysis.
 */
router.get('/:repositoryId/analysis/status', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const latest = await RepositoryAnalysis.findOne({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    })
      .select('status startedAt completedAt summary errorMessage')
      .sort({ createdAt: -1 });

    if (!latest) {
      return res.json({
        success: true,
        data: { status: 'idle', percentage: 0, message: 'No analysis requested yet.' },
      });
    }

    let percentage = 0;
    if (latest.status === 'pending') percentage = 15;
    else if (latest.status === 'running') percentage = 60;
    else if (latest.status === 'completed') percentage = 100;

    return res.json({
      success: true,
      data: {
        analysisId: latest._id,
        status: latest.status,
        percentage,
        message: latest.summary || latest.status,
        errorMessage: latest.errorMessage,
        startedAt: latest.startedAt,
        completedAt: latest.completedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to check status.' });
  }
});

/**
 * GET /api/codebases/:repositoryId/analysis/history
 * Returns historical audit runs for this repository.
 */
router.get('/:repositoryId/analysis/history', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const runs = await RepositoryAnalysis.find({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    })
      .select('commitSha status startedAt completedAt findings recommendations errorMessage createdAt')
      .sort({ createdAt: -1 })
      .limit(20);

    const formatted = runs.map((r) => ({
      _id: r._id,
      commitSha: r.commitSha,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      findingsCount: r.findings?.length || 0,
      recommendationsCount: r.recommendations?.length || 0,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
    }));

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load analysis history.' });
  }
});

/**
 * GET /api/codebases/:repositoryId/analysis/:analysisId
 * Retrieve a specific historical analysis run by ID.
 */
router.get('/:repositoryId/analysis/:analysisId', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const analysis = await RepositoryAnalysis.findOne({
      _id: req.params.analysisId,
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    });

    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis run not found.' });
    }

    return res.json({
      success: true,
      data: analysis,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load analysis.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. FINDINGS & RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/codebases/:repositoryId/findings
 * Filterable and paginated findings from the latest audit run.
 */
router.get('/:repositoryId/findings', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const latest = await RepositoryAnalysis.findOne({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
      status: 'completed',
    }).sort({ createdAt: -1 });

    if (!latest) {
      return res.json({ success: true, count: 0, total: 0, data: [] });
    }

    let findings = latest.findings || [];

    // Filter by severity
    if (req.query.severity && req.query.severity !== 'ALL') {
      findings = findings.filter((f) => f.severity === req.query.severity.toUpperCase());
    }

    // Filter by category
    if (req.query.category && req.query.category !== 'ALL') {
      findings = findings.filter((f) => f.category === req.query.category);
    }

    // Filter by verificationStatus
    if (req.query.verificationStatus && req.query.verificationStatus !== 'ALL') {
      findings = findings.filter((f) => f.verificationStatus === req.query.verificationStatus);
    }

    // Free text search in title or file path
    if (req.query.search) {
      const term = req.query.search.toLowerCase();
      findings = findings.filter(
        (f) =>
          (f.title && f.title.toLowerCase().includes(term)) ||
          (f.filePath && f.filePath.toLowerCase().includes(term)) ||
          (f.description && f.description.toLowerCase().includes(term))
      );
    }

    const total = findings.length;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const startIndex = (page - 1) * limit;
    const paginated = findings.slice(startIndex, startIndex + limit);

    return res.json({
      success: true,
      total,
      page,
      limit,
      count: paginated.length,
      data: paginated,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve findings.' });
  }
});

/**
 * GET /api/codebases/:repositoryId/recommendations
 * Actionable recommendations from the latest audit run.
 */
router.get('/:repositoryId/recommendations', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const latest = await RepositoryAnalysis.findOne({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
      status: 'completed',
    }).sort({ createdAt: -1 });

    if (!latest) {
      return res.json({ success: true, count: 0, data: [] });
    }

    let recs = latest.recommendations || [];

    if (req.query.category && req.query.category !== 'ALL') {
      recs = recs.filter((r) => r.category === req.query.category);
    }

    if (req.query.effort && req.query.effort !== 'ALL') {
      recs = recs.filter((r) => r.effort === req.query.effort.toLowerCase());
    }

    recs.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

    return res.json({
      success: true,
      count: recs.length,
      data: recs,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load recommendations.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DOCUMENTATION INVENTORY & GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/codebases/:repositoryId/documentation/inventory
 * Scans actual repository files to inventory present, incomplete, and missing docs.
 */
router.get('/:repositoryId/documentation/inventory', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const inventory = await buildDocumentationInventory(codebase._id, req.user._id);

    return res.json({
      success: true,
      count: inventory.length,
      data: inventory,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to scan documentation inventory.',
    });
  }
});

/**
 * Document path mapping by type.
 */
const DOC_FILENAME_MAP = {
  readme: 'README.md',
  architecture: 'ARCHITECTURE.md',
  prd: 'PRD.md',
  api: 'API.md',
  database: 'DATABASE_SCHEMA.md',
  security: 'SECURITY.md',
  contributing: 'CONTRIBUTING.md',
  testing: 'TESTING.md',
  deployment: 'DEPLOYMENT.md',
  environment: 'ENVIRONMENT_VARIABLES.md',
};

/**
 * POST /api/codebases/:repositoryId/documentation/generate
 * Generates an evidence-grounded documentation file using LLM abstraction.
 */
router.post('/:repositoryId/documentation/generate', async (req, res) => {
  const { documentType } = req.body;

  if (!documentType || !VALID_DOC_TYPES.includes(documentType.toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: `Invalid documentType. Must be one of: ${VALID_DOC_TYPES.join(', ')}`,
    });
  }

  const normalizedType = documentType.toLowerCase();

  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    // Retrieve detected stack if available from previous analysis
    const latestAnalysis = await RepositoryAnalysis.findOne({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    }).sort({ createdAt: -1 });

    const stack = latestAnalysis?.detectedStack || {};

    // Generate grounded documentation via LLM
    const result = await generateDoc(codebase._id, req.user._id, normalizedType, stack);

    const docPath = DOC_FILENAME_MAP[normalizedType] || `${normalizedType.toUpperCase()}.md`;
    const contentHash = crypto.createHash('sha256').update(result.content, 'utf8').digest('hex');

    // Persist or update GeneratedDocument record
    const doc = await GeneratedDocument.findOneAndUpdate(
      {
        ownerUserId: req.user._id,
        repositoryId: codebase._id,
        documentType: normalizedType,
      },
      {
        sourceCommitSha: codebase.indexedCommitSha || null,
        documentPath: docPath,
        documentType: normalizedType,
        generatedContent: result.content,
        originalContentHash: contentHash,
        validationWarnings: result.validationWarnings || [],
        userEdited: false,
        publicationStatus: 'draft',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      success: true,
      message: `Generated "${docPath}" successfully.`,
      data: {
        documentId: doc._id,
        documentPath: doc.documentPath,
        documentType: doc.documentType,
        content: doc.generatedContent,
        references: result.references || [],
        validationWarnings: doc.validationWarnings,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    console.error(`[Doc Generation Error] ${documentType}:`, err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to generate documentation.',
    });
  }
});

/**
 * GET /api/codebases/:repositoryId/documentation/generated
 * Lists all generated documents for the repository.
 */
router.get('/:repositoryId/documentation/generated', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const docs = await GeneratedDocument.find({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    }).sort({ updatedAt: -1 });

    return res.json({
      success: true,
      count: docs.length,
      data: docs,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load generated documents.' });
  }
});

/**
 * GET /api/codebases/:repositoryId/documentation/generated/:documentId
 * Retrieve a single generated document.
 */
router.get('/:repositoryId/documentation/generated/:documentId', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const doc = await GeneratedDocument.findOne({
      _id: req.params.documentId,
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve document.' });
  }
});

/**
 * PATCH /api/codebases/:repositoryId/documentation/generated/:documentId
 * Updates the content of a generated document (in-place user edits).
 */
router.patch('/:repositoryId/documentation/generated/:documentId', async (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ success: false, message: 'Field "content" must be a string.' });
  }

  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const doc = await GeneratedDocument.findOneAndUpdate(
      {
        _id: req.params.documentId,
        repositoryId: codebase._id,
        ownerUserId: req.user._id,
      },
      {
        generatedContent: content,
        userEdited: true,
      },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    return res.json({
      success: true,
      message: 'Document content updated successfully.',
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to save document edits.' });
  }
});

/**
 * GET /api/codebases/:repositoryId/documentation/generated/:documentId/download
 * Download single markdown file.
 */
router.get('/:repositoryId/documentation/generated/:documentId/download', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const doc = await GeneratedDocument.findOne({
      _id: req.params.documentId,
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    });

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    // Sanitize filename to prevent header injection or directory traversal
    const safeFilename = (doc.documentPath || 'DOCUMENT.md')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return res.send(doc.generatedContent || '');
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Download failed.' });
  }
});

/**
 * POST /api/codebases/:repositoryId/documentation/download-bundle
 * Creates and downloads a ZIP archive containing all selected or generated documents.
 * Guarantees path traversal prevention and clean archive manifests.
 */
router.post('/:repositoryId/documentation/download-bundle', async (req, res) => {
  const { documentIds } = req.body;

  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const query = {
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    };

    if (Array.isArray(documentIds) && documentIds.length > 0) {
      query._id = { $in: documentIds };
    }

    const docs = await GeneratedDocument.find(query);

    if (docs.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No generated documents found to include in ZIP bundle.',
      });
    }

    const zip = new AdmZip();
    const manifestEntries = [];

    for (const doc of docs) {
      // Path traversal security check
      const rawPath = doc.documentPath || `${doc.documentType}.md`;
      const cleanRelativePath = rawPath
        .replace(/\\/g, '/')
        .replace(/\.\./g, '')
        .replace(/^\/+/, '');

      zip.addFile(cleanRelativePath, Buffer.from(doc.generatedContent || '', 'utf8'));

      manifestEntries.push({
        path: cleanRelativePath,
        documentType: doc.documentType,
        sourceCommitSha: doc.sourceCommitSha,
        userEdited: doc.userEdited,
        updatedAt: doc.updatedAt,
      });
    }

    // Add manifest
    const manifestContent = JSON.stringify(
      {
        generator: 'DevMind AI — AI Codebase Auditor',
        repository: codebase.name,
        sourceUrl: codebase.sourceUrl,
        commitSha: codebase.indexedCommitSha,
        bundleTimestamp: new Date().toISOString(),
        files: manifestEntries,
      },
      null,
      2
    );
    zip.addFile('MANIFEST.json', Buffer.from(manifestContent, 'utf8'));

    const zipBuffer = zip.toBuffer();
    const safeRepoName = codebase.name.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="devmind_docs_${safeRepoName}_${Date.now()}.zip"`
    );
    res.setHeader('Content-Length', zipBuffer.length);
    return res.send(zipBuffer);
  } catch (err) {
    console.error('[Download Bundle Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to create ZIP bundle.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GITHUB INTEGRATION: SAFE PULL REQUEST PUBLISHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/codebases/:repositoryId/github/pull-request
 * Safely creates a branch and opens a Pull Request on GitHub.
 *
 * SAFETY RULES:
 * 1. NEVER pushes directly to the default branch.
 * 2. Uses dedicated branch: devmind/docs-update-YYYY-MM-DD-<rand>.
 * 3. Token is transient — NEVER stored in database or logged.
 * 4. Only publishes approved generated documentation files.
 */
router.post('/:repositoryId/github/pull-request', async (req, res) => {
  const { documentIds, targetBranch, prTitle, prBody, githubToken } = req.body;

  if (!githubToken || typeof githubToken !== 'string' || !githubToken.trim()) {
    return res.status(400).json({
      success: false,
      message:
        'A GitHub Personal Access Token (PAT) with repo scope is required to publish pull requests. Token is used transiently and never stored. Alternatively, use the Download button to export documents locally.',
    });
  }

  const token = githubToken.trim();

  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    if (!codebase.sourceUrl) {
      return res.status(400).json({
        success: false,
        message: 'This codebase was not imported from GitHub. Pull requests can only be published to GitHub repositories.',
      });
    }

    const validation = validateGitHubUrl(codebase.sourceUrl);
    if (!validation.valid || !validation.owner || !validation.repo) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract valid GitHub repository owner and name from source URL.',
      });
    }

    const { owner, repo } = validation;
    const baseBranch = (targetBranch || codebase.defaultBranch || 'main').trim();

    // Fetch documents to publish
    const query = {
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    };
    if (Array.isArray(documentIds) && documentIds.length > 0) {
      query._id = { $in: documentIds };
    }

    const docsToPublish = await GeneratedDocument.find(query);
    if (docsToPublish.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No generated documents found to publish.',
      });
    }

    // Step 1: Verify token and repository access via GitHub API
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'DevMind-AI-Codebase-Auditor/1.0',
      },
    });

    if (repoRes.status === 401 || repoRes.status === 403) {
      return res.status(403).json({
        success: false,
        message: 'GitHub authentication failed. Please verify your Personal Access Token has "repo" scope.',
      });
    }

    if (repoRes.status === 404) {
      return res.status(404).json({
        success: false,
        message: `GitHub repository ${owner}/${repo} was not found or the provided token does not have access.`,
      });
    }

    // Step 2: Get target branch head commit SHA
    const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'DevMind-AI-Codebase-Auditor/1.0',
      },
    });

    if (!branchRes.ok) {
      return res.status(400).json({
        success: false,
        message: `Base branch "${baseBranch}" was not found in ${owner}/${repo}. Please verify branch exists.`,
      });
    }

    const branchData = await branchRes.json();
    const baseCommitSha = branchData.object.sha;

    // Step 3: Create dedicated safe feature branch
    const dateStr = new Date().toISOString().split('T')[0];
    const randStr = crypto.randomBytes(3).toString('hex');
    const newBranchName = `devmind/docs-update-${dateStr}-${randStr}`;

    const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'DevMind-AI-Codebase-Auditor/1.0',
      },
      body: JSON.stringify({
        ref: `refs/heads/${newBranchName}`,
        sha: baseCommitSha,
      }),
    });

    if (!createRefRes.ok) {
      const refErr = await createRefRes.json().catch(() => ({}));
      return res.status(500).json({
        success: false,
        message: `Failed to create publishing branch on GitHub: ${refErr.message || createRefRes.statusText}`,
      });
    }

    // Record publication in pending state
    const publication = await GitHubPublication.create({
      ownerUserId: req.user._id,
      repositoryId: codebase._id,
      sourceCommitSha: baseCommitSha,
      targetBranch: baseBranch,
      generatedBranch: newBranchName,
      publicationStatus: 'pushing_files',
      publishedFiles: docsToPublish.map((d) => d.documentPath),
    });

    // Step 4: Commit and push each generated file to the new branch
    for (const doc of docsToPublish) {
      const filePath = (doc.documentPath || `${doc.documentType}.md`).replace(/^\/+/, '');
      const fileContentBase64 = Buffer.from(doc.generatedContent || '', 'utf8').toString('base64');

      // Check if file already exists on target branch to provide existing sha if updating
      let existingFileSha = null;
      try {
        const existingRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${newBranchName}`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'DevMind-AI-Codebase-Auditor/1.0',
            },
          }
        );
        if (existingRes.ok) {
          const exData = await existingRes.json();
          existingFileSha = exData.sha;
        }
      } catch {
        // file doesn't exist yet
      }

      const putBody = {
        message: `docs: update ${filePath} from DevMind AI Codebase Auditor`,
        content: fileContentBase64,
        branch: newBranchName,
      };
      if (existingFileSha) putBody.sha = existingFileSha;

      const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'DevMind-AI-Codebase-Auditor/1.0',
        },
        body: JSON.stringify(putBody),
      });

      if (!putRes.ok) {
        console.warn(`[GitHub Push Warning] Could not commit ${filePath}:`, putRes.status);
      }
    }

    // Step 5: Open Pull Request
    const defaultTitle = prTitle || 'docs: add AI-generated documentation from DevMind AI';
    const defaultBody =
      prBody ||
      `## DevMind AI — Automated Codebase Documentation

This Pull Request introduces comprehensive, evidence-grounded documentation generated by DevMind AI's Codebase Auditor.

### Included Documents:
${docsToPublish.map((d) => `- \`${d.documentPath}\` (${d.documentType})`).join('\n')}

- **Base Branch:** \`${baseBranch}\`
- **Audited Commit SHA:** \`${baseCommitSha.slice(0, 8)}\`
- **Generated Branch:** \`${newBranchName}\`

*Generated with DevMind AI Codebase Auditor. Please review before merging.*`;

    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'DevMind-AI-Codebase-Auditor/1.0',
      },
      body: JSON.stringify({
        title: defaultTitle,
        head: newBranchName,
        base: baseBranch,
        body: defaultBody,
      }),
    });

    if (!prRes.ok) {
      const prErr = await prRes.json().catch(() => ({}));
      await GitHubPublication.findByIdAndUpdate(publication._id, {
        publicationStatus: 'failed',
        errorMessage: prErr.message || 'Failed to open Pull Request on GitHub.',
      });

      return res.status(500).json({
        success: false,
        message: `Branch was created (${newBranchName}), but opening the PR failed: ${prErr.message || prRes.statusText}`,
      });
    }

    const prResult = await prRes.json();

    // Mark publication and documents as published
    await GitHubPublication.findByIdAndUpdate(publication._id, {
      publicationStatus: 'completed',
      pullRequestUrl: prResult.html_url,
      pullRequestNumber: prResult.number,
    });

    await GeneratedDocument.updateMany(
      { _id: { $in: docsToPublish.map((d) => d._id) } },
      { publicationStatus: 'published' }
    );

    return res.status(201).json({
      success: true,
      message: `Pull Request successfully created at ${prResult.html_url}`,
      data: {
        pullRequestUrl: prResult.html_url,
        pullRequestNumber: prResult.number,
        generatedBranch: newBranchName,
        targetBranch: baseBranch,
        publishedCount: docsToPublish.length,
      },
    });
  } catch (err) {
    console.error('[PR Creation Error]:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Unexpected error creating GitHub pull request.',
    });
  }
});

/**
 * GET /api/codebases/:repositoryId/github/publications
 * Retrieves publication history for the repository.
 */
router.get('/:repositoryId/github/publications', async (req, res) => {
  try {
    const codebase = await verifyRepositoryOwnership(req.params.repositoryId, req.user._id);
    if (!codebase) {
      return res.status(404).json({ success: false, message: 'Repository not found.' });
    }

    const publications = await GitHubPublication.find({
      repositoryId: codebase._id,
      ownerUserId: req.user._id,
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: publications.length,
      data: publications,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve publication records.' });
  }
});

export default router;
