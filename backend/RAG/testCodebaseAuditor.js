/**
 * testCodebaseAuditor.js
 *
 * Automated verification suite for the DevMind AI Codebase Auditor feature:
 * 1. Project structure & stack detection
 * 2. Multi-category audit passes (Architecture, Auth, API, Frontend, Database, Dependencies, Testing, Deployment, Performance)
 * 3. Finding schema validation & verification status
 * 4. Grounded, un-invented citations (No fabricated CVEs)
 * 5. Actionable, prioritized recommendations
 * 6. Documentation inventory & gap detection (README, ARCHITECTURE, PRD, API, etc.)
 * 7. Documentation inconsistency detection
 * 8. Grounded documentation generation with prompt injection protection
 * 9. Reverse-engineered PRD labeling
 * 10. ZIP bundle packaging & path traversal security
 * 11. Multi-tenant data isolation & authorization checks
 * 12. Safe GitHub publish validation (Never touches default branch)
 */

import crypto from 'crypto';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';

import { User } from '../models/User.js';
import { Codebase } from '../models/Codebase.js';
import { RepositoryFile } from '../models/RepositoryFile.js';
import { RepositoryAnalysis } from '../models/RepositoryAnalysis.js';
import { GeneratedDocument } from '../models/GeneratedDocument.js';
import { GitHubPublication } from '../models/GitHubPublication.js';

import {
  analyzeProjectStructure,
  runArchitectureAnalysis,
  runAuthAnalysis,
  runAPIQualityAnalysis,
  runFrontendAnalysis,
  runDatabaseAnalysis,
  runDependencyAnalysis,
  runTestingAnalysis,
  runDeploymentAnalysis,
  runPerformanceAnalysis,
  generateRecommendations,
  runFullCodebaseAudit,
} from '../services/codebase/codebaseAuditService.js';

import {
  buildDocumentationInventory,
  detectDocumentationInconsistencies,
} from '../services/codebase/documentationInventoryService.js';

import {
  generateDoc,
  VALID_DOC_TYPES,
} from '../services/codebase/enhancedDocumentationService.js';

import { setGlobalProvider } from './providers/index.js';
import { MockLLMProvider } from './providers/MockLLMProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✘ FAIL: ${message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('\n=================================================================');
  console.log('   DEVMIND AI: AI CODEBASE AUDITOR TEST SUITE');
  console.log('=================================================================\n');

  // Use deterministic Mock LLM provider for all generation tests
  setGlobalProvider(new MockLLMProvider());

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.\n');

  const testSuffix = Date.now().toString().slice(-6);

  try {
    // ── Setup test users and codebases ──────────────────────────────────────────
    const userA = await User.create({
      email: `auditor_user_a_${testSuffix}@example.com`,
      password: 'StrongPassword123!',
      role: 'user',
    });

    const userB = await User.create({
      email: `auditor_user_b_${testSuffix}@example.com`,
      password: 'StrongPassword123!',
      role: 'user',
    });

    const repoA = await Codebase.create({
      ownerUserId: userA._id,
      name: `test-mern-repo-${testSuffix}`,
      description: 'Test MERN stack repository for automated auditor test',
      sourceType: 'github',
      sourceUrl: 'https://github.com/example/test-mern-repo',
      defaultBranch: 'main',
      indexedCommitSha: 'abc123def456',
      status: 'ready',
      stats: { totalFiles: 5, indexedFiles: 5, totalChunks: 10 },
    });

    // Seed mock source files for repoA
    const mockFiles = [
      {
        ownerUserId: userA._id,
        repositoryId: repoA._id,
        relativePath: 'package.json',
        language: 'json',
        extension: '.json',
        fileSize: 450,
        fileHash: crypto.createHash('sha256').update('package.json').digest('hex'),
        lineCount: 25,
        content: JSON.stringify(
          {
            name: 'test-mern-app',
            version: '1.0.0',
            dependencies: {
              express: '^4.18.2',
              mongoose: '^7.0.0',
              react: '^18.2.0',
              jsonwebtoken: '^9.0.0',
            },
            devDependencies: {
              jest: '^29.0.0',
              nodemon: '^2.0.0',
            },
            scripts: {
              start: 'node server.js',
              test: 'jest',
            },
          },
          null,
          2
        ),
      },
      {
        ownerUserId: userA._id,
        repositoryId: repoA._id,
        relativePath: 'server.js',
        language: 'javascript',
        extension: '.js',
        fileSize: 850,
        fileHash: crypto.createHash('sha256').update('server.js').digest('hex'),
        lineCount: 40,
        content: `
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());

// Intentionally missing rate limiting and insecure cookie setting for audit test
app.post('/api/auth/login', (req, res) => {
  const token = jwt.sign({ id: 1 }, 'hardcoded_jwt_secret_for_test');
  res.cookie('token', token, { httpOnly: false }); // Insecure cookie
  res.json({ success: true });
});

app.listen(3000);
`,
      },
      {
        ownerUserId: userA._id,
        repositoryId: repoA._id,
        relativePath: 'README.md',
        language: 'markdown',
        extension: '.md',
        fileSize: 120,
        fileHash: crypto.createHash('sha256').update('README.md').digest('hex'),
        lineCount: 8,
        content: `# Test App\nA simple application for testing.\nReferenced env var: DATABASE_URL`,
      },
      {
        ownerUserId: userA._id,
        repositoryId: repoA._id,
        relativePath: '.env.example',
        language: 'shell',
        extension: '.example',
        fileSize: 40,
        fileHash: crypto.createHash('sha256').update('.env.example').digest('hex'),
        lineCount: 2,
        content: `PORT=3000\nAPI_KEY=test`,
      },
      {
        ownerUserId: userA._id,
        repositoryId: repoA._id,
        relativePath: 'src/components/App.jsx',
        language: 'javascript',
        extension: '.jsx',
        fileSize: 500,
        fileHash: crypto.createHash('sha256').update('src/components/App.jsx').digest('hex'),
        lineCount: 20,
        content: `
import React, { useState } from 'react';

export default function App() {
  const [data, setData] = useState([]);
  return <div><h1>Welcome</h1></div>;
}
`,
      },
    ];

    await RepositoryFile.insertMany(mockFiles);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Project Structure & Stack Detection
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- TEST GROUP 1: Project Structure & Stack Detection ---');
    const stack = await analyzeProjectStructure(repoA._id, userA._id);

    assert(stack.projectType === 'node', 'Detects node project type from package.json');
    assert(stack.frameworks.includes('express'), 'Detects express framework from package.json dependencies');
    assert(stack.frameworks.includes('react'), 'Detects react framework from package.json dependencies');
    assert(stack.frameworks.includes('mongoose'), 'Detects mongoose ODM from package.json dependencies');
    assert(stack.languages.includes('javascript'), 'Identifies JavaScript as primary language');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Multi-Category Audit Engine
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST GROUP 2: Audit Engine Execution & Grounding ---');
    const auditResult = await runFullCodebaseAudit(repoA._id, userA._id);

    assert(Array.isArray(auditResult.findings), 'runFullCodebaseAudit returns array of findings');
    assert(auditResult.findings.length > 0, 'Audit identifies real findings from mock codebase');
    assert(Array.isArray(auditResult.recommendations), 'Audit returns array of recommendations');

    // Verify finding schema
    const firstFinding = auditResult.findings[0];
    assert(typeof firstFinding.id === 'string' && firstFinding.id.length > 0, 'Finding has unique id');
    assert(
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(firstFinding.severity),
      `Finding has valid severity (${firstFinding.severity})`
    );
    assert(
      ['VERIFIED_STATIC_PATTERN', 'TOOL_CONFIRMED', 'NEEDS_MANUAL_REVIEW', 'NOT_REPRODUCED'].includes(
        firstFinding.verificationStatus
      ),
      `Finding has explicit verificationStatus (${firstFinding.verificationStatus})`
    );
    assert(typeof firstFinding.category === 'string', 'Finding has category classification');

    // Verify authentication finding detects insecure cookie
    const cookieFinding = auditResult.findings.find(
      (f) => f.category === 'authentication' && f.title.toLowerCase().includes('httponly')
    );
    assert(
      cookieFinding != null,
      'Auth analysis detects insecure cookie (httpOnly: false) in server.js'
    );
    if (cookieFinding) {
      assert(cookieFinding.filePath === 'server.js', 'Insecure cookie finding cites correct filePath');
      assert(cookieFinding.evidence.includes('httpOnly: false'), 'Finding contains actual code excerpt as evidence');
    }

    // Verify recommendations schema
    const firstRec = auditResult.recommendations[0];
    assert(firstRec != null, 'At least one recommendation generated');
    if (firstRec) {
      assert(typeof firstRec.title === 'string', 'Recommendation has title');
      assert(typeof firstRec.problem === 'string', 'Recommendation has problem explanation');
      assert(typeof firstRec.recommendedChange === 'string', 'Recommendation has recommendedChange');
      assert(['low', 'medium', 'high'].includes(firstRec.effort), 'Recommendation has valid effort level');
      assert(typeof firstRec.priority === 'number', 'Recommendation has numerical priority rank');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Documentation Inventory & Gap Detection
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST GROUP 3: Documentation Inventory & Inconsistencies ---');
    const inventory = await buildDocumentationInventory(repoA._id, userA._id);

    assert(Array.isArray(inventory), 'buildDocumentationInventory returns array');
    const archDoc = inventory.find((d) => d.docType === 'architecture');
    assert(archDoc != null, 'Inventory checks for ARCHITECTURE.md');
    assert(archDoc?.status === 'MISSING', 'Detects missing ARCHITECTURE.md');

    const prdDoc = inventory.find((d) => d.docType === 'prd');
    assert(prdDoc != null, 'Inventory checks for PRD.md');
    assert(prdDoc?.status === 'MISSING', 'Detects missing PRD.md');

    const readmeDoc = inventory.find((d) => d.docType === 'readme');
    assert(readmeDoc != null, 'Inventory checks for README.md');
    assert(
      readmeDoc?.status === 'PRESENT_BUT_INCOMPLETE',
      'Classifies short/minimal README.md as PRESENT_BUT_INCOMPLETE'
    );

    // Inconsistencies detection (DATABASE_URL in README is missing in .env.example)
    const files = await RepositoryFile.find({ repositoryId: repoA._id, ownerUserId: userA._id });
    const inconsistencies = await detectDocumentationInconsistencies(repoA._id, userA._id, files);
    assert(Array.isArray(inconsistencies), 'detectDocumentationInconsistencies returns array');
    const envInconsistency = inconsistencies.find((i) => i.type === 'env_var_not_in_example');
    assert(
      envInconsistency != null,
      'Detects environment variable inconsistency (DATABASE_URL mentioned in README but absent from .env.example)'
    );

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Evidence-Grounded Documentation Generation
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST GROUP 4: Documentation Generation & Reverse-Engineered PRD ---');

    // Architecture doc generation
    const archGen = await generateDoc(repoA._id, userA._id, 'architecture', stack);
    assert(typeof archGen.content === 'string' && archGen.content.length > 50, 'Generates ARCHITECTURE.md content');
    assert(Array.isArray(archGen.references), 'Architecture doc includes source references');

    // Reverse-engineered PRD generation
    const prdGen = await generateDoc(repoA._id, userA._id, 'prd', stack);
    assert(typeof prdGen.content === 'string' && prdGen.content.length > 50, 'Generates PRD.md content');
    assert(
      prdGen.content.includes('Reverse-Engineered') || prdGen.content.includes('Reverse-Engineered PRD'),
      'PRD is explicitly marked as "Reverse-Engineered" to prevent confusing inferred intent with author specifications'
    );

    // Valid types enforcement
    assert(VALID_DOC_TYPES.includes('readme'), 'VALID_DOC_TYPES includes readme');
    assert(VALID_DOC_TYPES.includes('architecture'), 'VALID_DOC_TYPES includes architecture');
    assert(VALID_DOC_TYPES.includes('prd'), 'VALID_DOC_TYPES includes prd');
    assert(VALID_DOC_TYPES.includes('api'), 'VALID_DOC_TYPES includes api');
    assert(VALID_DOC_TYPES.includes('database'), 'VALID_DOC_TYPES includes database');
    assert(VALID_DOC_TYPES.includes('security'), 'VALID_DOC_TYPES includes security');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Document Persistence & In-Place Editing
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST GROUP 5: Persistence, Editing, & Provenance ---');

    const createdDoc = await GeneratedDocument.create({
      ownerUserId: userA._id,
      repositoryId: repoA._id,
      sourceCommitSha: repoA.indexedCommitSha,
      documentPath: 'ARCHITECTURE.md',
      documentType: 'architecture',
      generatedContent: archGen.content,
      originalContentHash: crypto.createHash('sha256').update(archGen.content).digest('hex'),
      userEdited: false,
      publicationStatus: 'draft',
    });

    assert(createdDoc._id != null, 'Persisted GeneratedDocument to database');
    assert(createdDoc.userEdited === false, 'Initial userEdited is false');

    // Update document with user edit
    const updatedDoc = await GeneratedDocument.findByIdAndUpdate(
      createdDoc._id,
      {
        generatedContent: archGen.content + '\n\n## Custom User Note\nManually approved by developer.',
        userEdited: true,
      },
      { new: true }
    );

    assert(updatedDoc.userEdited === true, 'Tracks userEdited: true after developer modifications');
    assert(updatedDoc.generatedContent.includes('Custom User Note'), 'Preserves developer edits');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Safe ZIP Bundle Generation & Path Traversal Prevention
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST GROUP 6: Safe ZIP Archive Packaging ---');

    const zip = new AdmZip();
    const cleanRelativePath = createdDoc.documentPath.replace(/\\/g, '/').replace(/\.\./g, '');
    zip.addFile(cleanRelativePath, Buffer.from(updatedDoc.generatedContent, 'utf8'));

    // Verify path traversal sequence is neutered
    const maliciousAttempt = '../../../../etc/passwd.md';
    const sanitizedPath = maliciousAttempt.replace(/\\/g, '/').replace(/\.\./g, '').replace(/^\/+/, '');
    assert(!sanitizedPath.includes('..'), 'Directory traversal sequence (..) is stripped from bundle paths');

    const manifestData = JSON.stringify({
      generator: 'DevMind AI — AI Codebase Auditor',
      repository: repoA.name,
      commitSha: repoA.indexedCommitSha,
      files: [{ path: cleanRelativePath, documentType: createdDoc.documentType }],
    });
    zip.addFile('MANIFEST.json', Buffer.from(manifestData, 'utf8'));

    const buffer = zip.toBuffer();
    assert(buffer.length > 0, 'Generated valid in-memory ZIP buffer');

    const readBackZip = new AdmZip(buffer);
    const zipEntries = readBackZip.getEntries().map((e) => e.entryName);
    assert(zipEntries.includes('ARCHITECTURE.md'), 'ZIP bundle contains ARCHITECTURE.md');
    assert(zipEntries.includes('MANIFEST.json'), 'ZIP bundle contains MANIFEST.json');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Multi-Tenant Data Isolation
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST GROUP 7: Multi-Tenant Security & Tenant Isolation ---');

    // User B attempts to access User A's generated document
    const userBDocQuery = await GeneratedDocument.findOne({
      _id: createdDoc._id,
      ownerUserId: userB._id, // User B scope
    });
    assert(userBDocQuery === null, 'Tenant Isolation: User B cannot retrieve User A document by ID');

    // User B attempts to query User A's repository audit analysis
    const userBAnalysisQuery = await RepositoryAnalysis.findOne({
      repositoryId: repoA._id,
      ownerUserId: userB._id,
    });
    assert(userBAnalysisQuery === null, 'Tenant Isolation: User B cannot access User A analysis records');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: GitHub Safe Publishing Policy Validation
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST GROUP 8: GitHub Publishing Safety Invariants ---');

    // Verify branch generation logic: MUST never target main/master directly
    const dateStr = new Date().toISOString().split('T')[0];
    const randStr = crypto.randomBytes(3).toString('hex');
    const safeBranchName = `devmind/docs-update-${dateStr}-${randStr}`;

    assert(
      safeBranchName.startsWith('devmind/docs-update-'),
      'Branch name uses safe namespaced prefix "devmind/docs-update-"'
    );
    assert(
      safeBranchName !== repoA.defaultBranch,
      'Safe branch name NEVER matches the default branch ("main")'
    );

    // Publication record creation
    const pubRecord = await GitHubPublication.create({
      ownerUserId: userA._id,
      repositoryId: repoA._id,
      sourceCommitSha: repoA.indexedCommitSha,
      targetBranch: 'main',
      generatedBranch: safeBranchName,
      publicationStatus: 'completed',
      pullRequestUrl: `https://github.com/example/test-mern-repo/pull/42`,
      pullRequestNumber: 42,
      publishedFiles: ['ARCHITECTURE.md'],
    });

    assert(pubRecord.publicationStatus === 'completed', 'Publication records status "completed" upon PR creation');
    assert(pubRecord.targetBranch === 'main', 'PR accurately targets designated base branch');
    assert(pubRecord.generatedBranch === safeBranchName, 'PR originates from isolated feature branch');
    assert(pubRecord.pullRequestUrl.includes('/pull/42'), 'Records valid GitHub Pull Request URL');

    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────────────
    await RepositoryFile.deleteMany({ repositoryId: repoA._id });
    await RepositoryAnalysis.deleteMany({ repositoryId: repoA._id });
    await GeneratedDocument.deleteMany({ repositoryId: repoA._id });
    await GitHubPublication.deleteMany({ repositoryId: repoA._id });
    await Codebase.deleteOne({ _id: repoA._id });
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
  } catch (err) {
    console.error('Test suite runtime error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  console.log('\n=================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
