/**
 * testFixPromptGenerator.js
 *
 * Automated verification suite for DevMind AI: AI Fix Prompt Generator.
 * Verifies all 16 prompt generation, formatting, security, and verification requirements.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Codebase } from '../models/Codebase.js';
import { RepositoryAnalysis } from '../models/RepositoryAnalysis.js';
import { RepositoryFile } from '../models/RepositoryFile.js';
import { AIFixPrompt } from '../models/AIFixPrompt.js';
import {
  generateAIFixPrompt,
  validateFixPrompt,
  redactSecrets,
  groupAndOrderFindings,
  AGENT_PROFILES,
} from '../services/codebase/aiFixPromptService.js';
import { compareAnalyses } from '../services/codebase/analysisComparisonService.js';

dotenv.config();

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✔ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${testName}`);
    failed++;
  }
}

async function runFixPromptTests() {
  console.log('\n=================================================================');
  console.log('   DEVMIND AI: AI FIX PROMPT GENERATOR TEST SUITE');
  console.log('=================================================================\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.\n');

  try {
    // ── Setup Test Tenants ──
    const tenantA = await User.create({
      email: `fix_tenant_a_${Date.now()}@example.com`,
      password: 'TestPassword123!',
      role: 'user',
    });

    const tenantB = await User.create({
      email: `fix_tenant_b_${Date.now()}@example.com`,
      password: 'TestPassword123!',
      role: 'user',
    });

    // Codebase for Tenant A
    const codebaseA = await Codebase.create({
      ownerUserId: tenantA._id,
      name: 'SampleBackend',
      description: 'API backend service',
      sourceType: 'github',
      sourceUrl: 'https://github.com/example/SampleBackend',
      defaultBranch: 'main',
      indexedCommitSha: 'a1b2c3d4e5f6',
      status: 'ready',
    });

    // Seed sample files
    await RepositoryFile.create([
      {
        ownerUserId: tenantA._id,
        repositoryId: codebaseA._id,
        relativePath: 'server.js',
        language: 'javascript',
        extension: 'js',
        fileSize: 1200,
        fileHash: 'hash1',
        lineCount: 45,
        content: `import express from 'express';\nconst app = express();\napp.use(cookieParser());\nres.cookie('token', token, { httpOnly: false }); // VULNERABLE\napp.listen(5000);`,
      },
      {
        ownerUserId: tenantA._id,
        repositoryId: codebaseA._id,
        relativePath: 'routes/users.js',
        language: 'javascript',
        extension: 'js',
        fileSize: 2200,
        fileHash: 'hash2',
        lineCount: 80,
        content: `router.delete('/:id', async (req, res) => {\n  await User.findByIdAndDelete(req.params.id); // NO OWNERSHIP CHECK\n});`,
      },
    ]);

    // Initial Analysis for Tenant A
    const analysisA1 = await RepositoryAnalysis.create({
      ownerUserId: tenantA._id,
      repositoryId: codebaseA._id,
      commitSha: 'a1b2c3d4e5f6',
      status: 'completed',
      detectedStack: {
        projectType: 'Node.js Express API',
        frameworks: ['express', 'mongoose'],
        languages: ['JavaScript'],
        packageManager: 'npm',
        hasTests: true,
        hasDocker: false,
        hasCICD: true,
      },
      findings: [
        {
          id: 'AUTH-001',
          category: 'authentication',
          title: 'Insecure cookie missing httpOnly attribute',
          description: 'Auth token cookie is readable by client JavaScript.',
          severity: 'HIGH',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: 'server.js',
          startLine: 4,
          endLine: 4,
          evidence: "res.cookie('token', token, { httpOnly: false });",
          impact: 'Exposes session tokens to XSS credential theft.',
          recommendation: 'Configure httpOnly: true and secure: true in production.',
          effort: 'low',
        },
        {
          id: 'AUTH-002',
          category: 'authentication',
          title: 'Missing resource ownership check on delete',
          description: 'Users can delete arbitrary records by supplying any ID.',
          severity: 'CRITICAL',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: 'routes/users.js',
          startLine: 2,
          endLine: 2,
          evidence: 'await User.findByIdAndDelete(req.params.id);',
          impact: 'IDOR vulnerability allowing unauthorized data destruction.',
          recommendation: 'Verify req.user.id matches target document owner before deletion.',
          effort: 'medium',
        },
        {
          id: 'DOCS-001',
          category: 'documentation',
          title: 'Missing ARCHITECTURE.md file',
          description: 'No architectural documentation found in repository root.',
          severity: 'LOW',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: 'ARCHITECTURE.md',
          evidence: '',
          impact: 'Reduces onboarding velocity.',
          recommendation: 'Generate comprehensive ARCHITECTURE.md with system diagram.',
          effort: 'low',
        },
      ],
      recommendations: [
        {
          id: 'REC-001',
          category: 'authentication',
          title: 'Enforce httpOnly session cookies and SameSite restrictions',
          problem: 'Insecure cookie settings allow script-based token exfiltration.',
          whyItMatters: 'Protects user authentication tokens from client-side scripts.',
          recommendedChange: 'Set httpOnly: true and sameSite: "lax".',
          effort: 'low',
          risk: 'low',
        },
      ],
      completedAt: new Date(),
    });

    // ── TEST GROUP 1: Single-Issue Prompt Generation ──
    console.log('--- TEST GROUP 1: Single-Issue Prompt Generation ---');
    const singlePrompt = await generateAIFixPrompt({
      repositoryId: codebaseA._id,
      ownerUserId: tenantA._id,
      mode: 'single_issue',
      targetAgent: 'generic',
      findingIds: ['AUTH-001'],
    });

    assert(Boolean(singlePrompt._id), 'Generates and persists single_issue prompt');
    assert(singlePrompt.selectedFindingIds.length === 1, 'Contains exactly 1 selected finding');
    assert(singlePrompt.selectedFindingIds[0] === 'AUTH-001', 'Matches requested finding ID');
    assert(singlePrompt.generatedPrompt.includes('AUTH-001'), 'Prompt text cites finding ID');
    assert(singlePrompt.generatedPrompt.includes('server.js'), 'Prompt text cites target filePath');
    assert(singlePrompt.generatedPrompt.includes('httpOnly: false'), 'Includes verified code evidence excerpt');
    assert(singlePrompt.promptTokensEst > 100, 'Estimates non-zero prompt token length');

    // ── TEST GROUP 2: Required 10-Section Structure Validation ──
    console.log('\n--- TEST GROUP 2: Required 10-Section Structure ---');
    const v = singlePrompt.validationReport;
    assert(v.isValid === true, 'Prompt validation passes quality threshold');
    assert(v.checks.hasRole === true, 'Section 1 (Role) is present');
    assert(v.checks.hasProjectContext === true, 'Section 2 (Project Context) is present');
    assert(v.checks.hasObjective === true, 'Section 3 (Objective) is present');
    assert(v.checks.hasFindings === true, 'Section 4 (Identified Issues) is present');
    assert(v.checks.hasInvestigation === true, 'Section 5 (Investigation Instructions) is present');
    assert(v.checks.hasImplementation === true, 'Section 6 (Implementation Requirements) is present');
    assert(v.checks.hasConstraints === true, 'Section 7 (Constraints) is present');
    assert(v.checks.hasTesting === true, 'Section 8 (Testing Requirements) is present');
    assert(v.checks.hasAcceptanceCriteria === true, 'Section 9 (Acceptance Criteria) is present');
    assert(v.checks.hasFinalReport === true, 'Section 10 (Final Report) is present');
    assert(singlePrompt.generatedPrompt.includes('Proceed to inspect the repository, implement the remediation, and run tests now.'), 'Ends with clear action directive to implement, not merely explain');

    // ── TEST GROUP 3: Multi-Issue Coordinated Prompt & Root-Cause Ordering ──
    console.log('\n--- TEST GROUP 3: Multi-Issue & Dependency Ordering ---');
    const multiPrompt = await generateAIFixPrompt({
      repositoryId: codebaseA._id,
      ownerUserId: tenantA._id,
      mode: 'related_issues',
      targetAgent: 'generic',
      findingIds: ['DOCS-001', 'AUTH-002', 'AUTH-001'], // Intentionally unordered
    });

    assert(multiPrompt.selectedFindingIds.length === 3, 'Contains all 3 requested finding IDs');
    // Authentication must come before documentation in execution order
    const authIdx = multiPrompt.generatedPrompt.indexOf('Security & Authentication');
    const docsIdx = multiPrompt.generatedPrompt.indexOf('Documentation & Guides');
    assert(authIdx !== -1 && docsIdx !== -1 && authIdx < docsIdx, 'Orders security/auth fixes before documentation');
    assert(multiPrompt.generatedPrompt.includes('(Blocking / Core)'), 'Flags blocking foundational issues');

    // ── TEST GROUP 4: Secret Redaction & Untrusted Content Sanitization ──
    console.log('\n--- TEST GROUP 4: Secret Redaction ---');
    const dirtyText = `Config: ghp_123456789012345678901234567890123456 and token="secret_api_key_abc123"`;
    const cleanText = redactSecrets(dirtyText);
    assert(!cleanText.includes('ghp_123456789012345678901234567890123456'), 'Redacts GitHub personal access tokens');
    assert(!cleanText.includes('secret_api_key_abc123'), 'Redacts sensitive token assignments');
    assert(cleanText.includes('[REDACTED_SECRET]'), 'Replaces secrets with safe placeholder');

    // ── TEST GROUP 5: Stale Analysis Warning ──
    console.log('\n--- TEST GROUP 5: Stale Analysis Protection ---');
    // Simulate codebase committing new SHA
    codebaseA.indexedCommitSha = 'f9e8d7c6b5a4_NEW_SHA';
    await codebaseA.save();

    const stalePrompt = await generateAIFixPrompt({
      repositoryId: codebaseA._id,
      ownerUserId: tenantA._id,
      mode: 'single_issue',
      targetAgent: 'generic',
      findingIds: ['AUTH-001'],
    });

    assert(stalePrompt.isStale === true, 'Detects commit divergence between analysis and current repo');
    assert(stalePrompt.generatedPrompt.includes('STALE ANALYSIS ALERT'), 'Embeds prominent stale analysis alert');
    assert(stalePrompt.generatedPrompt.includes('Do NOT assume static line numbers are exact'), 'Instructs agent not to rely blindly on old line numbers');

    // ── TEST GROUP 6: Target-Agent Formatting ──
    console.log('\n--- TEST GROUP 6: Agent-Specific Formatting Profiles ---');
    const antigravityPrompt = await generateAIFixPrompt({
      repositoryId: codebaseA._id,
      ownerUserId: tenantA._id,
      mode: 'single_issue',
      targetAgent: 'antigravity',
      findingIds: ['AUTH-001'],
    });
    assert(antigravityPrompt.generatedPrompt.includes('Google Antigravity Agentic Assistant'), 'Includes Antigravity target header');
    assert(antigravityPrompt.generatedPrompt.includes('standard sandbox mode'), 'Includes sandbox safety directives');

    const cursorPrompt = await generateAIFixPrompt({
      repositoryId: codebaseA._id,
      ownerUserId: tenantA._id,
      mode: 'single_issue',
      targetAgent: 'cursor',
      findingIds: ['AUTH-001'],
    });
    assert(cursorPrompt.generatedPrompt.includes('CURSOR COMPOSER FIX DIRECTIVE'), 'Includes Cursor Composer header');

    const claudePrompt = await generateAIFixPrompt({
      repositoryId: codebaseA._id,
      ownerUserId: tenantA._id,
      mode: 'single_issue',
      targetAgent: 'claude_code',
      findingIds: ['AUTH-001'],
    });
    assert(claudePrompt.generatedPrompt.includes('CLAUDE CODE EXECUTION INSTRUCTION'), 'Includes Claude Code CLI header');

    // ── TEST GROUP 7: Prompt Editing & Persistence ──
    console.log('\n--- TEST GROUP 7: Prompt Editing & State Tracking ---');
    singlePrompt.userEditedPrompt = `${singlePrompt.generatedPrompt}\n\n// Added custom edge-case test by developer`;
    singlePrompt.isUserEdited = true;
    singlePrompt.status = 'EXTERNAL_FIX_IN_PROGRESS';
    await singlePrompt.save();

    const reloaded = await AIFixPrompt.findById(singlePrompt._id);
    assert(reloaded.isUserEdited === true, 'Preserves isUserEdited flag');
    assert(reloaded.userEditedPrompt.includes('custom edge-case test'), 'Persists developer custom edits');
    assert(reloaded.status === 'EXTERNAL_FIX_IN_PROGRESS', 'Tracks progression to EXTERNAL_FIX_IN_PROGRESS');

    // ── TEST GROUP 8: Multi-Tenant Data Isolation ──
    console.log('\n--- TEST GROUP 8: Multi-Tenant Isolation ---');
    // Tenant B attempts to generate prompt for Tenant A repository
    let crossTenantBlocked = false;
    try {
      await generateAIFixPrompt({
        repositoryId: codebaseA._id,
        ownerUserId: tenantB._id, // Unauthorized user
        mode: 'single_issue',
        findingIds: ['AUTH-001'],
      });
    } catch (err) {
      crossTenantBlocked = true;
    }
    assert(crossTenantBlocked === true, 'Tenant B cannot generate fix prompts for Tenant A codebase');

    const tenantBPrompts = await AIFixPrompt.find({
      repositoryId: codebaseA._id,
      ownerUserId: tenantB._id,
    });
    assert(tenantBPrompts.length === 0, 'Tenant B query yields 0 prompts from Tenant A repo');

    // ── TEST GROUP 9: Post-Fix Analysis Comparison ──
    console.log('\n--- TEST GROUP 9: Post-Fix Verification & Analysis Comparison ---');
    // Simulate Run 2 after developer applied fixes:
    // AUTH-001 resolved, AUTH-002 still present, NEW-001 newly introduced
    const analysisA2 = await RepositoryAnalysis.create({
      ownerUserId: tenantA._id,
      repositoryId: codebaseA._id,
      commitSha: 'f9e8d7c6b5a4_NEW_SHA',
      status: 'completed',
      findings: [
        {
          id: 'AUTH-002', // Still present!
          category: 'authentication',
          title: 'Missing resource ownership check on delete',
          severity: 'CRITICAL',
          filePath: 'routes/users.js',
        },
        {
          id: 'PERF-001', // Newly introduced!
          category: 'performance',
          title: 'Unindexed query on user activity log',
          severity: 'LOW',
          filePath: 'models/Activity.js',
        },
      ],
      completedAt: new Date(Date.now() + 5000),
    });

    const comparison = await compareAnalyses({
      repositoryId: codebaseA._id,
      ownerUserId: tenantA._id,
      previousAnalysisId: analysisA1._id,
      currentAnalysisId: analysisA2._id,
    });

    assert(comparison.success === true, 'Analysis comparison executes successfully');
    assert(comparison.data.metrics.resolvedCount === 2, 'Detects 2 resolved findings (AUTH-001, DOCS-001)');
    assert(comparison.data.metrics.stillPresentCount === 1, 'Detects 1 still-present finding (AUTH-002)');
    assert(comparison.data.metrics.newFindingsCount === 1, 'Detects 1 newly introduced finding (PERF-001)');
    assert(comparison.data.resolvedFindings.some((f) => f.id === 'AUTH-001'), 'Identifies AUTH-001 as resolved');
    assert(comparison.data.stillPresentFindings.some((f) => f.id === 'AUTH-002'), 'Identifies AUTH-002 as still present');

    // Check that prompt status was updated
    const updatedSinglePrompt = await AIFixPrompt.findById(singlePrompt._id);
    assert(updatedSinglePrompt.status === 'FIX_VERIFIED', 'Marks fix prompt FIX_VERIFIED when all its findings are resolved');

    // ── Cleanup ──
    await AIFixPrompt.deleteMany({ repositoryId: codebaseA._id });
    await RepositoryAnalysis.deleteMany({ repositoryId: codebaseA._id });
    await RepositoryFile.deleteMany({ repositoryId: codebaseA._id });
    await Codebase.deleteMany({ _id: codebaseA._id });
    await User.deleteMany({ _id: { $in: [tenantA._id, tenantB._id] } });

    console.log('\n=================================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=================================================================\n');

    await mongoose.connection.close();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test suite failed with unexpected error:', err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

runFixPromptTests();
