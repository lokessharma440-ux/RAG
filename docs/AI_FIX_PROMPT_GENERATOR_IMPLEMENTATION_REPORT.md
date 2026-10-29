# AI Fix Prompt Generator - Implementation Report

**Product:** DevMind AI  
**Feature Name:** AI Fix Prompt Generator  
**Integration Scope:** Codebase Audit Dashboard, Audit Engine, Documentation Generator, and Post-Fix Verification  
**Status:** Completed & Production Ready  
**Date:** October 29, 2026  

---

## 1. Executive Summary & Objective

DevMind AI has been enhanced with the **AI Fix Prompt Generator**, an enterprise-grade prompt synthesis and workflow orchestration system. While DevMind AI's Codebase Auditor analyzes repositories, detects architecture/security/quality findings, and detects missing documentation, developers need an actionable, seamless bridge to resolve identified issues using their preferred external AI coding agents.

The **AI Fix Prompt Generator** transforms raw findings, code evidence, and repository metadata into highly structured, context-rich, project-specific prompt specifications tailored for external AI coding tools such as **Google Antigravity**, **Cursor Composer**, **Claude Code CLI**, and **Gemini CLI**.

### Core Invariants Maintained:
- **Zero Hallucination / Grounded Citations:** Prompts contain real code evidence, real relative file paths, and accurate repository metadata. No fabricated files or imaginary metrics are generated.
- **Strict Execution Boundary:** DevMind AI generates and persists fix prompts; it **never** automatically executes prompts against user repositories or mutates user code directly without human intervention.
- **Multi-Tenant Isolation:** All prompts and comparison snapshots are strictly scoped to the authenticated user (`ownerUserId`).
- **Comprehensive Secret Redaction:** All sensitive credentials (GitHub tokens, OpenAI/Google API keys, passwords, bearer tokens) are sanitized with cryptographic placeholders before prompt rendering.
- **Cosmic UI Aesthetic:** Full visual parity with DevMind AI's cosmic theme (deep space background, cyan/purple glowing borders, monospace code badges, glassmorphic floating bars).

---

## 2. Architecture & System Design

```
+-----------------------------------------------------------------------------------------+
|                                    USER INTERFACE                                       |
|  - Audit Dashboard Overview Banner: Quick Batch Prompts                                 |
|  - Findings Tab: Multi-Select Checkboxes, Bulk Action Bar, Quick "⚡ Fix Prompt" Button  |
|  - Finding Detail Panel: "Generate AI Fix Prompt" Action                                |
|  - Fix Prompts Tab: Grid of Saved Prompts, Status Badges, One-Click Copy & Download     |
|  - Fix Prompt Studio Modal: Agent Switcher, Mode Selector, Split Preview & Markdown     |
|  - Post-Fix Comparison Modal: Diff Inspection (Resolved vs Still Present vs New)        |
+-----------------------------------------------------------------------------------------+
                                           |  REST API (HTTP-only JWT cookies)
                                           v
+-----------------------------------------------------------------------------------------+
|                                   BACKEND SERVICES                                      |
|  1. auditRoutes.js: REST API routing & multi-tenant authentication middleware           |
|  2. aiFixPromptService.js:                                                              |
|     - Secret Sanitizer (Regex scrubbing of credentials & tokens)                        |
|     - Category Dependency Ordering (Security -> DB -> API -> Arch -> Tests -> Docs)     |
|     - Agent Formatter (Antigravity, Cursor, Claude Code, Gemini CLI, Generic)           |
|     - 10-Section Prompt Builder & Token Estimation                                      |
|     - Prompt Quality Validator                                                          |
|  3. analysisComparisonService.js:                                                       |
|     - Audit Snapshot Diffing (N-1 vs N)                                                 |
|     - Finding Reconciliation & Fix Rate Computation                                     |
|     - Automatic FixPrompt Status Lifecycle Transitions                                  |
+-----------------------------------------------------------------------------------------+
                                           |  Mongoose ODM
                                           v
+-----------------------------------------------------------------------------------------+
|                                   DATABASE (MongoDB)                                    |
|  - Codebase: Repository metadata, default branch, indexed commit SHA                    |
|  - CodebaseAnalysis: Verified findings, recommendations, category breakdown             |
|  - AIFixPrompt: Generated prompt text, user edits, target agent, validation report      |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Database Schema (`AIFixPrompt`)

File: [backend/models/AIFixPrompt.js](file:///c:/Users/Lokesh%20Sharma/Desktop/Developers/backend/models/AIFixPrompt.js)

```javascript
const aiFixPromptSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Codebase', required: true, index: true },
  analysisId: { type: mongoose.Schema.Types.ObjectId, ref: 'CodebaseAnalysis', required: true },
  title: { type: String, required: true },
  mode: {
    type: String,
    enum: ['single_issue', 'related_issues', 'full_project', 'documentation', 'security', 'test_generation'],
    default: 'single_issue'
  },
  targetAgent: {
    type: String,
    enum: ['generic', 'antigravity', 'cursor', 'claude_code', 'gemini_cli', 'custom'],
    default: 'generic'
  },
  selectedFindingIds: [{ type: String }],
  analyzedCommitSha: { type: String },
  currentCommitSha: { type: String },
  isStale: { type: Boolean, default: false },
  generatedPrompt: { type: String, required: true },
  userEditedPrompt: { type: String, default: null },
  isUserEdited: { type: Boolean, default: false },
  promptTokensEst: { type: Number, default: 0 },
  contextSummary: {
    projectName: String,
    primaryLanguage: String,
    frameworks: [String],
    totalFindingsCount: Number,
    criticalCount: Number,
    highCount: Number,
  },
  validationReport: {
    isValid: { type: Boolean, default: true },
    missingSections: [String],
    hasUnverifiedClaims: { type: Boolean, default: false },
    score: { type: Number, default: 100 }
  },
  status: {
    type: String,
    enum: [
      'DRAFT',
      'GENERATED',
      'COPIED',
      'DOWNLOADED',
      'EXTERNAL_FIX_IN_PROGRESS',
      'FIX_SUBMITTED_FOR_REVIEW',
      'FIX_VERIFIED',
      'STILL_PRESENT',
      'NEEDS_MANUAL_REVIEW'
    ],
    default: 'GENERATED',
    index: true
  }
}, { timestamps: true });

// Compound index for user-scoped repository prompt queries
aiFixPromptSchema.index({ ownerUserId: 1, repositoryId: 1, createdAt: -1 });
```

---

## 4. Prompt Generation Strategy & 10-Section Structure

To ensure maximum execution precision across LLM coding agents, prompts follow a mandatory 10-section contract:

| Section # | Section Title | Description & Invariant |
|---|---|---|
| **1** | `1. Role & Identity` | Positions the agent as a senior software engineer specialized in the stack. Embeds agent-specific formatting profiles. |
| **2** | `2. Project Context` | Documents project type, framework, indexed commit SHA, and emits a **Stale Analysis Warning** if commit has diverged. |
| **3** | `3. Objective` | Clear, concise problem statement defining the target issues to solve without scope creep. |
| **4** | `4. Identified Issues & Evidence` | Detailed breakdown of each finding with Finding ID, Category, Severity, File Path, and verbatim code evidence excerpts. |
| **5** | `5. Investigation Instructions` | Explicit directive to inspect the live codebase first and verify that line numbers haven't shifted before making changes. |
| **6** | `6. Implementation Requirements` | File-by-file implementation guidance, edge-case coverage, state preservation, and security guardrails. |
| **7** | `7. Constraints & Guardrails` | Prohibits removing existing tests, leaking hardcoded secrets, or breaking existing API contracts. |
| **8** | `8. Testing Requirements` | Mandates running the baseline test suite, writing targeted unit tests, and verifying non-regression before declaring success. |
| **9** | `9. Acceptance Criteria` | Measurable checklist verifying that each identified finding is completely mitigated. |
| **10** | `10. Final Verification & Reporting` | Direct imperative instruction to implement and test the changes, not merely provide a conversational explanation. |

---

## 5. Dependency Ordering & Execution Hierarchy

When synthesizing multi-issue or full-project fix prompts, findings are prioritized to ensure foundational and security fixes precede cosmetic or documentation changes:

1. **Security & Authentication** (`CRITICAL` & `HIGH` first) - Secures entry points, cookies, and tokens.
2. **Database & Data Isolation** - Ensures schema and tenant boundaries are solid before modifying APIs.
3. **API & Backend Reliability** - Validates input handling, error responses, and route controllers.
4. **Architecture & Project Structure** - Resolves architectural coupling and circular dependencies.
5. **Dependencies & Environment Configuration** - Resolves vulnerable or outdated packages.
6. **Frontend Reliability** - Fixes UI rendering bugs, state handling, and error boundaries.
7. **Testing & Test Coverage** - Updates test fixtures and adds automated regressions tests.
8. **Documentation** - Synchronizes documentation after code and interfaces are stabilized.
9. **Deployment & CI/CD** - Finalizes Dockerfiles, workflows, and deployment scripts.

---

## 6. Target Agent Profiles

The generator adapts prompt formatting to the specific execution modalities of modern AI coding assistants:

| Agent | Optimization Profile |
|---|---|
| **Google Antigravity** | Emphasizes sandboxed execution, terminal command prefix-matching, workspace state preservation, and automated unit test verification. |
| **Cursor Composer** | Formatted with file `@` mentions, concise unified diff suggestions, multi-file edit grouping, and inline symbol definitions. |
| **Claude Code CLI** | CLI-friendly Markdown formatting, compact terminal command execution sequences, and bash-oriented test runners. |
| **Gemini CLI** | Structured with clear step-by-step tool invocation directives and reproducible validation commands. |
| **Generic / Portable** | Highly standard Markdown with universal instructions compatible with any AI coding agent or human engineer. |

---

## 7. Security Invariants & Secret Redaction

To prevent sensitive credentials in repository code or configuration files from leaking into prompts:

- **Automated Regex Sanitization:** The service scans all code snippets and findings for:
  - GitHub Personal Access Tokens (`ghp_[a-zA-Z0-9]{36}`, `github_pat_[a-zA-Z0-9_]{82}`)
  - Google API Keys (`AIza[0-9A-Za-z-_]{35}`)
  - OpenAI Secret Keys (`sk-[a-zA-Z0-9]{48}`)
  - Bearer tokens, JWTs, and database connection strings with passwords
- **Redaction Replacement:** Matched credentials are automatically scrubbed and replaced with `[REDACTED_SECRET: <TYPE>]`.
- **Validation Quality Score:** If unredacted secrets or missing required sections are detected, the prompt validation engine reduces the quality score and flags warnings in the UI.

---

## 8. Stale Analysis Protection

If the repository commit SHA has changed since the last audit was executed:
- The system flags `isStale: true` on the generated prompt.
- A prominent alert banner is displayed in the UI.
- The prompt explicitly warns the external AI coding agent:
  > *⚠️ STALE ANALYSIS WARNING: The analyzed commit differs from the current repository HEAD. Line numbers and surrounding context may have shifted. Inspect live files before editing.*

---

## 9. Post-Fix Verification & Comparison Engine

File: [backend/services/codebase/analysisComparisonService.js](file:///c:/Users/Lokesh%20Sharma/Desktop/Developers/backend/services/codebase/analysisComparisonService.js)

When a developer finishes running their external AI coding agent and triggers a re-analysis:
1. DevMind AI fetches the previous analysis snapshot (Commit $A$) and the latest analysis snapshot (Commit $B$).
2. Findings are correlated across runs by fingerprint (`category` + `filePath` + `patternHash`).
3. The engine calculates:
   - **Fix Rate Percentage:** $\frac{\text{Resolved Count}}{\text{Previous Total}} \times 100$
   - **Resolved Findings:** Present in previous run, cleanly absent in new run.
   - **Still Present Findings:** Unresolved issues requiring further attention.
   - **New Findings:** Newly introduced issues detected in the new commit.
4. Related `AIFixPrompt` records are automatically updated to `FIX_VERIFIED`, `STILL_PRESENT`, or `NEEDS_MANUAL_REVIEW`.

---

## 10. REST API Specification

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/codebases/fix-prompts/agents` | Returns supported target agents and metadata |
| `POST` | `/api/codebases/:repositoryId/fix-prompts` | Generate and persist a new fix prompt (single, batch, or all) |
| `POST` | `/api/codebases/:repositoryId/findings/:findingId/fix-prompt` | Quick single-finding prompt generation |
| `GET` | `/api/codebases/:repositoryId/fix-prompts` | List user-scoped saved prompts for repository |
| `GET` | `/api/codebases/:repositoryId/fix-prompts/:promptId` | Retrieve prompt detail with validation score |
| `PATCH` | `/api/codebases/:repositoryId/fix-prompts/:promptId` | Save user edits or transition status |
| `GET` | `/api/codebases/:repositoryId/fix-prompts/:promptId/download` | Download prompt as `.md` or `.txt` |
| `DELETE` | `/api/codebases/:repositoryId/fix-prompts/:promptId` | Delete a saved prompt |
| `POST` | `/api/codebases/:repositoryId/analysis/compare` | Compare current vs previous analysis and compute fix rate |

---

## 11. UI/UX Cosmic Implementation

1. **Overview Section Banner:**
   - Quick action buttons to fix all Critical/High issues in one click.
   - Full Project Fix Plan synthesis button.
   - One-click trigger for Post-Fix Comparison.
2. **Findings Tab Multi-Select:**
   - Checkboxes on every finding card with item selection counter.
   - Sticky floating bulk action bar with `Generate Prompt for X Selected Issues`.
   - Per-card `⚡ Fix Prompt` quick pill button for instant single-issue prompts.
3. **Fix Prompt Studio Modal (`FixPromptModal.jsx`):**
   - Target Agent selector pills (Antigravity, Cursor, Claude Code, Gemini CLI, Generic).
   - Mode switcher (Single Issue, Related Issues, Full Project).
   - Interactive finding chips with removal capability.
   - Split Preview / Markdown Source view with live textarea editor.
   - Token counter badge and quality score indicator.
   - One-click Copy to Clipboard and Download as `.md` / `.txt`.
4. **Fix Prompts Management Tab (`PromptsTab`):**
   - Grid cards of all saved prompts with status pills (`GENERATED`, `FIX_VERIFIED`, etc.).
   - Edit, Copy, Download, and Delete actions per prompt.
5. **Post-Fix Verification Modal (`ComparisonModal`):**
   - Metric cards showing Fix Rate %, Resolved count, Still Present count, and New Findings.
   - Color-coded itemized diff breakdown.

---

## 12. Automated Verification & Test Results

### Fix Prompt Generator Test Suite (`testFixPromptGenerator.js`)
- **Total Tests:** 44
- **Passed:** 44 (100%)
- **Failed:** 0

```
--- TEST GROUP 1: Single-Issue Prompt Generation ---
  ✔ PASS: Generates and persists single_issue prompt
  ✔ PASS: Contains exactly 1 selected finding
  ✔ PASS: Matches requested finding ID
  ✔ PASS: Prompt text cites finding ID
  ✔ PASS: Prompt text cites target filePath
  ✔ PASS: Includes verified code evidence excerpt
  ✔ PASS: Estimates non-zero prompt token length

--- TEST GROUP 2: Required 10-Section Structure ---
  ✔ PASS: Prompt validation passes quality threshold
  ✔ PASS: Section 1 (Role) is present
  ✔ PASS: Section 2 (Project Context) is present
  ✔ PASS: Section 3 (Objective) is present
  ✔ PASS: Section 4 (Identified Issues) is present
  ✔ PASS: Section 5 (Investigation Instructions) is present
  ✔ PASS: Section 6 (Implementation Requirements) is present
  ✔ PASS: Section 7 (Constraints) is present
  ✔ PASS: Section 8 (Testing Requirements) is present
  ✔ PASS: Section 9 (Acceptance Criteria) is present
  ✔ PASS: Section 10 (Final Report) is present
  ✔ PASS: Ends with clear action directive to implement, not merely explain

--- TEST GROUP 3: Multi-Issue & Dependency Ordering ---
  ✔ PASS: Contains all 3 requested finding IDs
  ✔ PASS: Orders security/auth fixes before documentation
  ✔ PASS: Flags blocking foundational issues

--- TEST GROUP 4: Secret Redaction ---
  ✔ PASS: Redacts GitHub personal access tokens
  ✔ PASS: Redacts sensitive token assignments
  ✔ PASS: Replaces secrets with safe placeholder

--- TEST GROUP 5: Stale Analysis Protection ---
  ✔ PASS: Detects commit divergence between analysis and current repo
  ✔ PASS: Embeds prominent stale analysis alert
  ✔ PASS: Instructs agent not to rely blindly on old line numbers

--- TEST GROUP 6: Agent-Specific Formatting Profiles ---
  ✔ PASS: Includes Antigravity target header
  ✔ PASS: Includes sandbox safety directives
  ✔ PASS: Includes Cursor Composer header
  ✔ PASS: Includes Claude Code CLI header

--- TEST GROUP 7: Prompt Editing & State Tracking ---
  ✔ PASS: Preserves isUserEdited flag
  ✔ PASS: Persists developer custom edits
  ✔ PASS: Tracks progression to EXTERNAL_FIX_IN_PROGRESS

--- TEST GROUP 8: Multi-Tenant Isolation ---
  ✔ PASS: Tenant B cannot generate fix prompts for Tenant A codebase
  ✔ PASS: Tenant B query yields 0 prompts from Tenant A repo

--- TEST GROUP 9: Post-Fix Verification & Analysis Comparison ---
  ✔ PASS: Analysis comparison executes successfully
  ✔ PASS: Detects 2 resolved findings (AUTH-001, DOCS-001)
  ✔ PASS: Detects 1 still-present finding (AUTH-002)
  ✔ PASS: Detects 1 newly introduced finding (PERF-001)
  ✔ PASS: Identifies AUTH-001 as resolved
  ✔ PASS: Identifies AUTH-002 as still present
  ✔ PASS: Marks fix prompt FIX_VERIFIED when all its findings are resolved
```

### Codebase Auditor Test Suite (`testCodebaseAuditor.js`)
- **Total Tests:** 56
- **Passed:** 56 (100%)
- **Failed:** 0

### Frontend Production Build (`npm run build`)
- **Build Status:** Succeeded (0 errors)
- **Bundler:** Vite v8.3.4
- **Modules Transformed:** 1949

---

## 13. Limitations & Future Roadmap

1. **Automated PR Ingestion from External Agents:** Future versions may support webhook notifications from GitHub when external agent branches are pushed, triggering automated background analysis comparisons.
2. **Interactive Diff Preview in UI:** While the comparison engine detects resolved vs present findings, an inline side-by-side git diff viewer could allow direct code comparison within DevMind AI.
3. **Custom Target Agent Profiles:** Developers could define custom instruction templates and agent personas in their DevMind AI profile settings.

---
*DevMind AI - Understand Your Code. Discover What's Missing. Improve With Confidence.*
