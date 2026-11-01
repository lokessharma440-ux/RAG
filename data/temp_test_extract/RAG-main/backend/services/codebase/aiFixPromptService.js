import { Codebase } from '../../models/Codebase.js';
import { RepositoryAnalysis } from '../../models/RepositoryAnalysis.js';
import { RepositoryFile } from '../../models/RepositoryFile.js';
import { AIFixPrompt } from '../../models/AIFixPrompt.js';

// ── Regex for Secret Redaction ───────────────────────────────────────────────
const SECRET_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{82}/g,
  /AIza[0-9A-Za-z-_]{35}/g,
  /sk-[a-zA-Z0-9]{48}/g,
  /(?:jwt_secret|secret|password|private_key|api_key|token)\s*[:=]\s*['"][^'"]+['"]/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,
  /bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,
];

export function redactSecrets(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED_SECRET]');
  }
  return cleaned;
}

// ── Category Dependency & Execution Hierarchy ────────────────────────────────
export const CATEGORY_HIERARCHY = {
  authentication:   { rank: 1, label: 'Security & Authentication', blocking: true },
  database:         { rank: 2, label: 'Database & Data Access',    blocking: true },
  apiQuality:       { rank: 3, label: 'API & Backend Reliability', blocking: false },
  architecture:     { rank: 4, label: 'Architecture & Modularity', blocking: false },
  dependencies:     { rank: 5, label: 'Dependencies & Config',     blocking: false },
  frontendQuality:  { rank: 6, label: 'Frontend Reliability',      blocking: false },
  testing:          { rank: 7, label: 'Testing & Quality Checks',  blocking: false },
  documentation:    { rank: 8, label: 'Documentation & Guides',    blocking: false },
  deployment:       { rank: 9, label: 'Deployment & CI/CD',        blocking: false },
  performance:      { rank: 10, label: 'Performance Optimization', blocking: false },
};

// ── Agent Formatting Profiles ────────────────────────────────────────────────
export const AGENT_PROFILES = {
  generic: {
    name: 'Generic AI Coding Agent',
    description: 'Portable standard Markdown suitable for any agentic AI system or CLI',
    prefix: '',
    suffix: '',
  },
  antigravity: {
    name: 'Google Antigravity',
    description: 'Optimized for Google Antigravity with task steps, sandbox awareness, and verification phases',
    prefix: '> Target Environment: Google Antigravity Agentic Assistant\n> Working Mode: Sandbox Safe / Step-by-Step Verification\n\n',
    suffix: '\n\n---\n### Antigravity Execution Directives:\n- Execute commands in standard sandbox mode first.\n- Maintain architectural documentation integrity in `docs/`.\n- Provide human-readable summaries at the completion of each sub-task.\n',
  },
  cursor: {
    name: 'Cursor Composer',
    description: 'Optimized for Cursor Composer with @file references and unified diff instructions',
    prefix: '/* CURSOR COMPOSER FIX DIRECTIVE */\n// Target files must be referenced with @path annotations.\n// Focus on minimal, targeted edits without deleting comments.\n\n',
    suffix: '\n\n---\n### Cursor Composer Note:\n- Use precise search-and-replace blocks for multi-file edits.\n- Run terminal commands via the integrated Cursor terminal to verify changes.\n',
  },
  claude_code: {
    name: 'Claude Code',
    description: 'Optimized for Claude Code CLI with command execution, CLAUDE.md conventions, and git safety',
    prefix: '# CLAUDE CODE EXECUTION INSTRUCTION\n# Adhere to repository conventions and respect project guidelines.\n\n',
    suffix: '\n\n---\n### Claude Code Execution Directives:\n- Run tests using the detected package manager script.\n- Use git status to verify touched files before presenting the final report.\n- Never perform force pushes or destructive branch overrides.\n',
  },
  gemini_cli: {
    name: 'Gemini CLI',
    description: 'Optimized for Gemini developer tooling with structured task execution',
    prefix: '<!-- GEMINI CLI AGENT TASK -->\n<!-- Execute with grounded repository context -->\n\n',
    suffix: '\n\n---\n### Gemini CLI Verification Directives:\n- Verify tool outputs before asserting completion.\n- Distinguish static observations from runtime test validations.\n',
  },
  custom: {
    name: 'Custom Target',
    description: 'Standard prompt with customizable directives',
    prefix: '',
    suffix: '',
  },
};

/**
 * Groups and sorts findings by architectural hierarchy and root cause.
 */
export function groupAndOrderFindings(findings = []) {
  const groups = {};

  for (const finding of findings) {
    const cat = finding.category || 'architecture';
    if (!groups[cat]) {
      const meta = CATEGORY_HIERARCHY[cat] || { rank: 99, label: cat, blocking: false };
      groups[cat] = {
        category: cat,
        label: meta.label,
        rank: meta.rank,
        blocking: meta.blocking,
        findings: [],
      };
    }
    groups[cat].findings.push(finding);
  }

  // Sort groups by rank
  return Object.values(groups).sort((a, b) => a.rank - b.rank);
}

/**
 * Deterministic prompt quality validator.
 */
export function validateFixPrompt(promptText, selectedFindings = [], isStale = false) {
  const warnings = [];
  const sectionsPresent = [];

  const checks = {
    hasRole: /#+\s*1\.\s*Role/i.test(promptText),
    hasProjectContext: /#+\s*2\.\s*Project Context/i.test(promptText),
    hasObjective: /#+\s*3\.\s*Objective/i.test(promptText),
    hasFindings: /#+\s*4\.\s*Identified Issues/i.test(promptText),
    hasInvestigation: /#+\s*5\.\s*Investigation Instructions/i.test(promptText),
    hasImplementation: /#+\s*6\.\s*Implementation Requirements/i.test(promptText),
    hasConstraints: /#+\s*7\.\s*Constraints/i.test(promptText),
    hasTesting: /#+\s*8\.\s*Testing Requirements/i.test(promptText),
    hasAcceptanceCriteria: /#+\s*9\.\s*Acceptance Criteria/i.test(promptText),
    hasFinalReport: /#+\s*10\.\s*Final Report/i.test(promptText),
    noSecretsDetected: true,
    staleChecked: true,
  };

  for (const [key, passed] of Object.entries(checks)) {
    if (passed && key.startsWith('has')) {
      sectionsPresent.push(key.replace('has', ''));
    }
  }

  // Check for secret leakage
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(promptText)) {
      checks.noSecretsDetected = false;
      warnings.push('Potentially sensitive secret pattern detected in generated prompt.');
      break;
    }
  }

  // Check finding paths
  for (const f of selectedFindings) {
    if (f.filePath && !promptText.includes(f.filePath)) {
      warnings.push(`File path '${f.filePath}' for finding ${f.id} was not explicitly cited.`);
    }
  }

  if (isStale) {
    warnings.push('Stale Analysis: Current commit differs from analysis snapshot. Agent instructed to verify live code.');
  }

  let score = 100;
  for (const [key, val] of Object.entries(checks)) {
    if (!val) score -= 10;
  }
  if (warnings.length > 0) {
    score -= warnings.length * 5;
  }
  score = Math.max(10, Math.min(100, score));

  return {
    isValid: score >= 60 && checks.noSecretsDetected && checks.hasObjective && checks.hasFindings,
    score,
    warnings,
    sectionsPresent,
    checks,
  };
}

/**
 * Core Prompt Construction Service.
 * Generates the standardized 10-section prompt.
 */
export async function generateAIFixPrompt({
  repositoryId,
  ownerUserId,
  mode = 'single_issue',
  targetAgent = 'generic',
  findingIds = [],
  customInstructions = '',
  options = {},
}) {
  // 1. Fetch Codebase
  const codebase = await Codebase.findOne({ _id: repositoryId, ownerUserId });
  if (!codebase) {
    throw new Error('Repository not found or access denied.');
  }

  // 2. Fetch Latest Analysis (prefer completed)
  let analysis = await RepositoryAnalysis.findOne({ repositoryId, ownerUserId, status: 'completed' })
    .sort({ createdAt: -1 });

  if (!analysis) {
    analysis = await RepositoryAnalysis.findOne({ repositoryId, ownerUserId })
      .sort({ createdAt: -1 });
  }

  if (!analysis) {
    throw new Error('No analysis record found for this repository. Run a codebase audit first.');
  }

  // 3. Match Findings
  const allFindings = analysis.findings || [];
  let selectedFindings = [];

  if (mode === 'single_issue') {
    if (findingIds.length > 0) {
      const found = allFindings.find((f) => f.id === findingIds[0]);
      if (found) {
        selectedFindings = [found];
      }
    }
    // Fallback if ID wasn't provided or wasn't found in current analysis
    if (!selectedFindings.length) {
      if (allFindings.length > 0) {
        selectedFindings = [allFindings[0]];
      } else {
        throw new Error('No findings available in repository analysis to generate a fix prompt.');
      }
    }
  } else if (mode === 'security') {
    selectedFindings = allFindings.filter((f) =>
      ['authentication', 'database'].includes(f.category) ||
      ['CRITICAL', 'HIGH'].includes(f.severity) ||
      findingIds.includes(f.id)
    );
    if (!selectedFindings.length) {
      selectedFindings = allFindings.slice(0, 5);
    }
  } else if (mode === 'documentation') {
    selectedFindings = allFindings.filter((f) =>
      f.category === 'documentation' || findingIds.includes(f.id)
    );
    if (!selectedFindings.length) {
      selectedFindings = allFindings.filter((f) => f.category === 'documentation');
    }
    if (!selectedFindings.length) {
      selectedFindings = allFindings.slice(0, 5);
    }
  } else if (mode === 'full_project') {
    // Select actionable findings (Critical, High, Medium) or user-specified
    selectedFindings = findingIds.length
      ? allFindings.filter((f) => findingIds.includes(f.id))
      : allFindings.filter((f) => ['CRITICAL', 'HIGH', 'MEDIUM'].includes(f.severity));
    if (!selectedFindings.length) {
      selectedFindings = allFindings.slice(0, 10);
    }
  } else {
    // related_issues or test_generation
    selectedFindings = findingIds.length
      ? allFindings.filter((f) => findingIds.includes(f.id))
      : allFindings.slice(0, 5);
    if (!selectedFindings.length) {
      selectedFindings = allFindings.slice(0, 5);
    }
  }

  if (!selectedFindings.length) {
    throw new Error('No findings found in the repository analysis to construct a fix prompt.');
  }

  // 4. Stale Analysis Check
  const currentCommit = codebase.indexedCommitSha || null;
  const analyzedCommit = analysis.commitSha || null;
  const isStale = Boolean(currentCommit && analyzedCommit && currentCommit !== analyzedCommit);

  // 5. Relevant Source Excerpts Extraction
  const relevantFiles = [...new Set(selectedFindings.map((f) => f.filePath).filter(Boolean))];
  const fileContentsMap = {};

  if (relevantFiles.length > 0) {
    const fileDocs = await RepositoryFile.find({
      repositoryId,
      ownerUserId,
      relativePath: { $in: relevantFiles },
    }).select('relativePath content language lineCount');

    for (const doc of fileDocs) {
      fileContentsMap[doc.relativePath] = doc;
    }
  }

  // 6. Project & Stack Context
  const stack = analysis.detectedStack || {};
  const repoName = codebase.name || 'Repository';
  const projectType = stack.projectType || 'Software Project';
  const frameworks = (stack.frameworks || []).join(', ') || 'Standard Libraries';
  const languages = (stack.languages || []).join(', ') || 'Polyglot';
  const testFramework = stack.hasTests ? 'Configured in package manifest' : 'No dedicated test framework detected';

  // 7. Group & Order Findings
  const groupedFindings = groupAndOrderFindings(selectedFindings);

  // ── Construct 10 Sections ──────────────────────────────────────────────────
  const agentProfile = AGENT_PROFILES[targetAgent] || AGENT_PROFILES.generic;
  const lines = [];

  // Agent Prefix
  if (agentProfile.prefix) {
    lines.push(agentProfile.prefix);
  }

  // Header Title
  const modeTitleMap = {
    single_issue: `Fix ${selectedFindings[0].title}`,
    related_issues: `Coordinated Fix for ${selectedFindings.length} Related Issues`,
    full_project: `Comprehensive Multi-Phase Codebase Improvement`,
    documentation: `Documentation Remediation & Architecture Alignment`,
    security: `Security Hardening & Vulnerability Remediation`,
    test_generation: `Test Suite Expansion & Regression Coverage`,
  };

  const promptTitle = modeTitleMap[mode] || `Codebase Fix Directive`;
  lines.push(`# ${promptTitle}`);
  lines.push(`**Repository:** ${repoName} | **Analyzed Commit:** ${analyzedCommit ? `#${analyzedCommit.slice(0, 7)}` : 'HEAD'} | **Target:** ${agentProfile.name}\n`);

  if (isStale) {
    lines.push(`> [!WARNING]`);
    lines.push(`> **STALE ANALYSIS ALERT**: The codebase has advanced since this audit run.`);
    lines.push(`> Analyzed Commit: \`${analyzedCommit}\` | Current Repository Commit: \`${currentCommit}\`.`);
    lines.push(`> Do NOT assume static line numbers are exact. Always inspect live source code first.\n`);
  }

  // ── SECTION 1: ROLE ──
  lines.push(`## 1. Role`);
  lines.push(
    `You are an expert Senior Staff Software Engineer and Security Architect specialized in ${languages} and ${frameworks}. ` +
    `Your assignment is to inspect, diagnose, fix, and verify the specific codebase issues detailed below in the \`${repoName}\` repository. ` +
    `You take pride in minimal, non-breaking modifications, maintaining existing patterns, and backing every change with deterministic tests.`
  );
  lines.push('');

  // ── SECTION 2: PROJECT CONTEXT ──
  lines.push(`## 2. Project Context`);
  lines.push(`- **Repository Name:** \`${repoName}\``);
  lines.push(`- **Architecture / Project Type:** ${projectType}`);
  lines.push(`- **Primary Languages:** ${languages}`);
  lines.push(`- **Frameworks & Core Dependencies:** ${frameworks}`);
  lines.push(`- **Package Manager:** ${stack.packageManager || 'npm / yarn'}`);
  lines.push(`- **Testing Suite:** ${testFramework} (${stack.hasTests ? 'Tests Present' : 'Tests Missing or Minimal'})`);
  lines.push(`- **Docker / Containerization:** ${stack.hasDocker ? 'Dockerized' : 'None detected'}`);
  lines.push(`- **CI/CD Pipeline:** ${stack.hasCICD ? 'Active' : 'None detected'}`);
  lines.push(`- **Analyzed Commit SHA:** \`${analyzedCommit || 'Unknown'}\``);
  lines.push('');

  // ── SECTION 3: OBJECTIVE ──
  lines.push(`## 3. Objective`);
  if (mode === 'single_issue') {
    const f = selectedFindings[0];
    lines.push(
      `Safely resolve the ${f.severity} issue: **"${f.title}"** located in \`${f.filePath || 'codebase'}\`. ` +
      `Ensure the underlying root cause is eliminated, edge cases are guarded, and regression coverage is added without disturbing surrounding logic.`
    );
  } else if (mode === 'security') {
    lines.push(
      `Harden the application against security vulnerabilities by remedying ${selectedFindings.length} identified security and authentication flaws. ` +
      `Enforce strict principle-of-least-privilege, robust authorization guards, safe token/cookie configurations, and input validation without disrupting legitimate user flows.`
    );
  } else if (mode === 'test_generation') {
    lines.push(
      `Develop robust automated tests covering positive, negative, and boundary scenarios for ${selectedFindings.length} identified areas of concern. ` +
      `All new tests must seamlessly integrate with the existing test runner and prove that existing and modified behaviors execute correctly.`
    );
  } else {
    lines.push(
      `Execute an orderly, coordinated fix for ${selectedFindings.length} identified codebase issues across ${groupedFindings.length} functional areas. ` +
      `Prevent cascading side-effects by implementing foundational fixes before modifying high-level dependent modules.`
    );
  }
  lines.push('');

  // ── SECTION 4: IDENTIFIED ISSUES ──
  lines.push(`## 4. Identified Issues`);
  let issueCounter = 1;

  for (const group of groupedFindings) {
    lines.push(`### Phase ${group.rank}: ${group.label} ${group.blocking ? '(Blocking / Core)' : '(Independent)'}`);

    for (const f of group.findings) {
      lines.push(`#### [Issue ${issueCounter++}] ${f.title} (${f.id})`);
      lines.push(`- **Severity:** \`${f.severity}\` | **Confidence:** \`${f.confidence || 'MEDIUM'}\``);
      lines.push(`- **Verification Status:** \`${f.verificationStatus || 'NEEDS_MANUAL_REVIEW'}\``);
      lines.push(`- **Location:** \`${f.filePath || 'Unknown File'}\`${f.startLine ? ` (Lines ${f.startLine}-${f.endLine || f.startLine})` : ''}`);
      lines.push(`- **Impact:** ${f.impact || 'Potential functional or security degradation.'}`);
      lines.push(`- **Current Behavior:** ${f.description || f.title}`);
      lines.push(`- **Expected Behavior:** Eliminate the risk by conforming to standard ${f.category} best practices.`);
      lines.push(`- **Recommended Remediation:** ${f.recommendation || 'Inspect referenced file and patch the logic flaw.'}`);

      if (f.evidence) {
        lines.push(`- **Verified Code Evidence:**`);
        lines.push('```' + (fileContentsMap[f.filePath]?.language || '') + '\n' + redactSecrets(f.evidence.trim()) + '\n```');
      } else if (fileContentsMap[f.filePath]) {
        lines.push(`- **Source Context Note:** Inspect \`${f.filePath}\` in live repository.`);
      } else {
        lines.push(`- **Notice:** Source excerpt unconfirmed; agent must independently verify current code state.`);
      }
      lines.push('');
    }
  }

  // ── SECTION 5: INVESTIGATION INSTRUCTIONS ──
  lines.push(`## 5. Investigation Instructions`);
  lines.push(`Before altering any code, perform the following verification sequence:`);
  lines.push(`1. **Locate Target Files**: Inspect the current repository files listed in Section 4. Do not blindly overwrite code based on stale line numbers.`);
  lines.push(`2. **Confirm Reproduction**: Verify that the reported condition is actually present in the live codebase.`);
  lines.push(`3. **Trace Dependencies**: Identify callers and consumers of the affected methods or routes to ensure that signature or behavior changes do not break downstream modules.`);
  lines.push(`4. **Review Existing Tests**: Locate and run existing test files before making changes to establish a clean baseline.`);
  lines.push(`5. **Check for Inconsistencies**: If a reported finding is no longer reproducible because recent commits already resolved it, document that fact and move to the next item.`);
  lines.push('');

  // ── SECTION 6: IMPLEMENTATION REQUIREMENTS ──
  lines.push(`## 6. Implementation Requirements`);
  lines.push(`- **Minimal Scope**: Apply the smallest sufficient diff that completely resolves each issue without gratuitous refactoring.`);
  lines.push(`- **Architectural Harmony**: Follow the established conventions of the project (naming styles, module export formats, error wrapping patterns).`);
  lines.push(`- **Error Handling**: Gracefully handle edge cases, null/undefined payloads, and upstream rejections with clear, non-leaking error responses.`);
  lines.push(`- **State Preservation**: Ensure multi-tenant isolation, user scoping, and session invariants remain completely intact.`);
  if (customInstructions.trim()) {
    lines.push(`- **Developer Directive:** ${customInstructions.trim()}`);
  }
  lines.push('');

  // ── SECTION 7: CONSTRAINTS ──
  lines.push(`## 7. Constraints`);
  lines.push(`- **DO NOT** delete or disable existing tests to make your changes pass.`);
  lines.push(`- **DO NOT** introduce external paid dependencies or large new runtime libraries unless strictly necessary.`);
  lines.push(`- **DO NOT** expose secrets, environment variables, or sensitive user data in client-accessible responses or logs.`);
  lines.push(`- **DO NOT** perform destructive git actions (e.g. \`git reset --hard\`, force pushes, or branch deletions).`);
  lines.push(`- **DO NOT** rewrite unrelated modules or alter public API contracts unless explicitly required by a finding.`);
  lines.push('');

  // ── SECTION 8: TESTING REQUIREMENTS ──
  lines.push(`## 8. Testing Requirements`);
  lines.push(`1. **Baseline Check**: Run the existing test suite (e.g., \`npm test\` or equivalent) prior to editing.`);
  lines.push(`2. **Unit / Integration Tests**: Add deterministic test cases covering:`);
  lines.push(`   - Positive happy-path test verifying expected operation.`);
  lines.push(`   - Negative test validating rejection of invalid inputs or unauthorized attempts.`);
  lines.push(`   - Boundary / edge-case testing.`);
  lines.push(`3. **Regression Validation**: Ensure all prior tests continue to pass with 0 regressions.`);
  lines.push(`4. **Build Verification**: Run the project build script (e.g. \`npm run build\` or compiler) to ensure zero compilation or bundling errors.`);
  lines.push('');

  // ── SECTION 9: ACCEPTANCE CRITERIA ──
  lines.push(`## 9. Acceptance Criteria`);
  lines.push(`The fix is considered complete only when all the following conditions are met:`);
  for (let i = 0; i < selectedFindings.length; i++) {
    const f = selectedFindings[i];
    lines.push(`- [ ] Issue ${i + 1} (${f.id}): ${f.title} is resolved in \`${f.filePath || 'target file'}\`.`);
  }
  lines.push(`- [ ] No regression introduced into existing features.`);
  lines.push(`- [ ] Dedicated automated test cases added and passing.`);
  lines.push(`- [ ] Production build succeeds with 0 errors.`);
  lines.push('');

  // ── SECTION 10: FINAL REPORT ──
  lines.push(`## 10. Final Report`);
  lines.push(`Upon completion, provide a concise summary containing:`);
  lines.push(`1. **Files Inspected & Modified**: List of exact relative file paths changed.`);
  lines.push(`2. **Root Cause Diagnosis**: Brief confirmation of what was causing each issue.`);
  lines.push(`3. **Remediation Implemented**: Bulleted summary of the code modifications.`);
  lines.push(`4. **Tests Added & Executed**: Test commands run and actual exit codes/outputs.`);
  lines.push(`5. **Build Status**: Confirmation that build passed without errors.`);
  lines.push(`6. **Remaining Observations**: Any residual recommendations for manual human review.`);
  lines.push(`\n**Action**: Proceed to inspect the repository, implement the remediation, and run tests now.`);

  // Agent Suffix
  if (agentProfile.suffix) {
    lines.push(agentProfile.suffix);
  }

  const generatedPrompt = redactSecrets(lines.join('\n'));

  // 8. Quality Validation
  const validationReport = validateFixPrompt(generatedPrompt, selectedFindings, isStale);

  // 9. Estimate Token Count (~4 chars per token approximation)
  const promptTokensEst = Math.ceil(generatedPrompt.length / 4);

  // 10. Context Summary
  const contextSummary = {
    repositoryName: repoName,
    projectType,
    filesReferenced: relevantFiles,
    totalIssuesCount: selectedFindings.length,
    criticalCount: selectedFindings.filter((f) => f.severity === 'CRITICAL').length,
    highCount: selectedFindings.filter((f) => f.severity === 'HIGH').length,
    categories: [...new Set(selectedFindings.map((f) => f.category))],
  };

  // 11. Persist Record
  const fixPromptDoc = await AIFixPrompt.create({
    ownerUserId,
    repositoryId,
    analysisId: analysis._id,
    title: promptTitle,
    mode,
    targetAgent,
    selectedFindingIds: selectedFindings.map((f) => f.id),
    analyzedCommitSha: analyzedCommit,
    currentCommitSha: currentCommit,
    isStale,
    generatedPrompt,
    promptTokensEst,
    contextSummary,
    validationReport,
    status: 'GENERATED',
  });

  return fixPromptDoc;
}

