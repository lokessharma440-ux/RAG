# DevMind AI — Codebase Intelligence Architecture & Implementation Plan

## 1. Executive Summary & Objective
**DevMind AI** is an enterprise-grade Codebase Intelligence extension built directly on top of the existing MERN-based RAG architecture. It enables software engineers and engineering teams to import, parse, index, search, and reason about full codebases (via public GitHub repositories or uploaded ZIP archives) with strict multi-tenant isolation, code-aware semantic chunking, grounded LLM synthesis, cross-file dependency mapping, and automated static security analysis.

This document sets out the baseline audit, system design, data models, API contracts, security boundaries, and phased roadmap for implementation.

---

## 2. Existing Architecture Audit & Baseline
The existing application is a production-hardened MERN RAG system:
- **Backend Runtime:** Node.js (v20+), Express.js (v4.21.2) with ESM modules (`"type": "module"`).
- **Database:** MongoDB (v8.9.5 via Mongoose) with compound indexes and tenant isolation.
- **Security Middleware:** `helmet`, `cookie-parser` (HTTP-only JWT sessions, 7-day expiration), strict `cors` with credentials, `express-rate-limit`, and `requestCorrelationMiddleware`.
- **Vector Embedding Engine:** Local `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`) generating 384-dimensional dense vectors on CPU with in-memory model caching.
- **Retrieval Pipeline:** Hybrid retrieval combining Cosine Similarity with lexical keyword matching and bounded top-K window.
- **Generative Provider:** `@google/genai` (Gemini 2.5 Flash / 3.8 Flash) abstracted behind `BaseLLMProvider` with `GeminiProvider` and deterministic `MockLLMProvider` for testing.
- **Frontend Client:** React 19 + Vite 8 client with clean minimalist developer typography (`#111827`, `#f9fafb`, `#ffffff`), KaTeX math rendering, responsive layouts, and status polling.

### Existing Reusable Components:
1. `backend/middleware/authMiddleware.js`: `authenticateUser`, `getAuthCookieOptions`, `signAuthToken`.
2. `backend/RAG/embeddingGenerator.js`: `generateEmbeddings([text])` yielding 384-dimensional normalized vectors.
3. `backend/RAG/vectorStore.js`: `cosineSimilarity(vecA, vecB)`.
4. `backend/RAG/providers/`: `BaseLLMProvider`, `GeminiProvider`, `MockLLMProvider`.
5. `backend/utils/logger.js`: `requestCorrelationMiddleware`, `logRagOperation`.
6. `backend/config/db.js`: MongoDB connection lifecycle and transaction support detection.
7. `frontend/src/components/MarkdownContent.jsx`: KaTeX math parser + code block copy components.

### Baseline Test Status:
- `testPhaseE.js`: **19/19 PASS** (100% Passing).
- `testDocumentRAG.js`: **6/6 PASS** (100% Passing).
- Frontend Build: **Vite build succeeds in 897ms with 0 errors**.

---

## 3. Missing Components Required for Codebase Intelligence
To support Codebase Intelligence without altering existing Document RAG functionality, the following new components must be introduced:
1. **GitHub Import Service:** Public GitHub repository validator, metadata fetcher, and archive streamer (`codeload.github.com/.../zipball/` or API archive endpoint) with commit SHA extraction and rate-limit backoff.
2. **Safe ZIP Processing Service:** Multi-layered archive validation enforcing size bounds, entry limits, nesting depth caps, expansion ratio guards (zip-bomb prevention), directory-traversal prevention (`..`), and isolated temporary directory extraction with guaranteed `finally` cleanup.
3. **Repository Discovery & Filtering Service:** Extension filtering (JS/TS, Python, Java, Go, Rust, C/C++, HTML/CSS, JSON/YAML, SQL, Shell, Dockerfile), directory ignore rules (`node_modules`, `.git`, `dist`, `build`, etc.), and heuristic secret detection (AWS keys, private keys, database connection strings, JWTs).
4. **Code-Aware Parser & Semantic Chunker:** Language-aware boundary detection (functions, classes, methods, imports, exports, API routes) that preserves exact 1-indexed original file line numbers (`startLine`, `endLine`) and file hashes.
5. **Database Models:**
   - `Codebase`: Repository metadata, source type, commit SHA, indexing status (`QUEUED`, `FETCHING`, `PARSING`, `EMBEDDING`, `READY`, `FAILED`), stats.
   - `RepositoryFile`: Relative file path, language, extension, file size, content hash, raw content for viewer.
   - `CodeChunk`: Code chunk content, chunk type, symbol name, start/end line numbers, 384-d vector embedding, content hash.
6. **Codebase Hybrid Retrieval Service:** Vector cosine similarity combined with exact symbol matching, file path weighting, and language filters.
7. **Developer Intelligence Services:**
   - **Cross-File Dependency & Flow Analyzer:** Import/export graphs, API route mapping, and downstream change impact reports.
   - **Static Security Analyzer:** Pattern scanner for hardcoded credentials, unsafe `eval`/`Function`, SQL/command injection risks, and missing auth middleware.
   - **Automated Documentation Generator:** Evidence-grounded architecture overviews, module summaries, and API endpoint references.
8. **Frontend Codebase Workspace:**
   - `CodebasesView`: Repository cards, import modal (GitHub URL + ZIP upload), indexing progress indicator.
   - `CodebaseDetailView`: Multi-tab workspace with File Explorer, Code Viewer with highlighted citations, Codebase Q&A Chat, Visual Dependency Graph, Security Audit Panel, and Documentation Generator.

---

## 4. Proposed Database Schema Design
All new collections are isolated by `ownerUserId`:

### 4.1 `Codebase` (Collection: `codebases`)
```javascript
{
  ownerUserId: { type: ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  sourceType: { type: String, enum: ['github', 'zip'], required: true },
  sourceUrl: { type: String, default: null },
  defaultBranch: { type: String, default: 'main' },
  indexedCommitSha: { type: String, default: null },
  status: { 
    type: String, 
    enum: ['queued', 'fetching', 'extracting', 'discovering_files', 'parsing', 'chunking', 'embedding', 'indexing', 'ready', 'failed', 'cancelled'], 
    default: 'queued', 
    index: true 
  },
  progress: {
    stage: { type: String, default: 'queued' },
    percentage: { type: Number, default: 0 },
    currentFile: { type: String, default: '' },
    message: { type: String, default: 'Repository queued for ingestion.' }
  },
  stats: {
    totalFiles: { type: Number, default: 0 },
    indexedFiles: { type: Number, default: 0 },
    skippedFiles: { type: Number, default: 0 },
    totalChunks: { type: Number, default: 0 },
    totalLines: { type: Number, default: 0 },
    languages: [{ name: String, count: Number, bytes: Number }]
  },
  errorMessage: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}
```

### 4.2 `RepositoryFile` (Collection: `repository_files`)
```javascript
{
  ownerUserId: { type: ObjectId, ref: 'User', required: true, index: true },
  repositoryId: { type: ObjectId, ref: 'Codebase', required: true, index: true },
  relativePath: { type: String, required: true },
  language: { type: String, required: true },
  extension: { type: String, required: true },
  fileSize: { type: Number, required: true },
  fileHash: { type: String, required: true },
  lineCount: { type: Number, default: 0 },
  content: { type: String, required: true }, // Persisted for instant source viewing
  chunkCount: { type: Number, default: 0 },
  isSecretExempt: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}
// Unique compound index: { repositoryId: 1, relativePath: 1 }
```

### 4.3 `CodeChunk` (Collection: `code_chunks`)
```javascript
{
  ownerUserId: { type: ObjectId, ref: 'User', required: true, index: true },
  repositoryId: { type: ObjectId, ref: 'Codebase', required: true, index: true },
  fileId: { type: ObjectId, ref: 'RepositoryFile', required: true, index: true },
  relativePath: { type: String, required: true },
  language: { type: String, required: true },
  chunkType: { type: String, enum: ['function', 'class', 'method', 'import', 'export', 'route', 'block', 'config'], default: 'block' },
  symbolName: { type: String, default: null, index: true },
  startLine: { type: Number, required: true },
  endLine: { type: Number, required: true },
  content: { type: String, required: true },
  contentHash: { type: String, required: true },
  embedding: { type: [Number], required: true }, // 384 dimensions
  indexVersion: { type: Number, default: 1 }
}
// Compound search index: { repositoryId: 1, ownerUserId: 1 }
```

### 4.4 `CodeRelationship` (Collection: `code_relationships`)
```javascript
{
  ownerUserId: { type: ObjectId, ref: 'User', required: true, index: true },
  repositoryId: { type: ObjectId, ref: 'Codebase', required: true, index: true },
  sourcePath: { type: String, required: true },
  targetPath: { type: String, default: null },
  relationType: { type: String, enum: ['imports', 'defines_route', 'uses_model', 'calls_function', 'renders_component'], required: true },
  symbol: { type: String, default: null },
  lineNumber: { type: Number, default: 1 }
}
```

---

## 5. API Design & Endpoints (`/api/codebases`)
All endpoints are secured behind `authenticateUser` and strictly filter queries by `req.user._id`:
- `POST /api/codebases/github`: Ingest public GitHub repository (`{ url, branch }`).
- `POST /api/codebases/upload`: Ingest uploaded ZIP archive (Multer stream, max 25MB).
- `GET /api/codebases`: List all user repositories with real stats.
- `GET /api/codebases/:id`: Fetch single repository metadata, stats, and ingestion progress.
- `DELETE /api/codebases/:id`: Cascade-delete repository, files, chunks, and relationships.
- `GET /api/codebases/:id/status`: Polling endpoint for real-time ingestion stage.
- `POST /api/codebases/:id/reindex`: Incremental re-indexing using file hashes.
- `GET /api/codebases/:id/files`: Paginated file tree / file list with language filters.
- `GET /api/codebases/:id/files/content`: Fetch original source file content for viewer.
- `POST /api/codebases/:id/chat`: Ask grounded questions about the codebase.
- `GET /api/codebases/:id/dependencies`: Retrieve extracted cross-file relationships and dependency graph.
- `GET /api/codebases/:id/impact`: Compute downstream impact analysis for a specific symbol or file.
- `POST /api/codebases/:id/security-analysis`: Run static security audit and return grounded findings.
- `POST /api/codebases/:id/documentation`: Generate structured architecture and API documentation.

---

## 6. Security & Safety Principles
1. **Never Execute Untrusted Code:** Repository files, package manifests, build scripts (`npm install`, `python setup.py`, etc.) are NEVER executed. Parsing is strictly static.
2. **Zip Bomb & Path Traversal Protection:**
   - Archive entries are inspected before extraction.
   - Any entry with `..`, absolute paths (`/` or `C:\`), or invalid characters is rejected immediately.
   - Max compressed size: 25 MB; max uncompressed size: 100 MB; max expansion ratio: 20x.
   - Max files: 2,500; max directory depth: 10 levels.
3. **Multi-Tenant Authorization & IDOR Block:**
   - Every database query specifies `{ _id: id, ownerUserId: req.user._id }`.
   - No request body `userId` is trusted.
4. **Secret Detection & Redaction:**
   - Regex patterns identify AWS access keys (`AKIA[0-9A-Z]{16}`), RSA private keys (`-----BEGIN.*PRIVATE KEY-----`), high-entropy API tokens, database URIs with passwords.
   - Detected secrets are redacted prior to chunk storage and LLM context construction.
5. **Prompt Injection Defense:**
   - System prompts delineate retrieved code snippets as untrusted data blocks.
   - The LLM provider abstraction enforces output grounding constraints.

---

## 7. Phased Implementation Strategy
- **Phase A:** Plan and Baseline Verification (Complete).
- **Phase B:** Codebase Import Engine (GitHub archive stream & ZIP upload with path traversal guards).
- **Phase C:** File Discovery, Ignore Rules, Secret Heuristics & Code-Aware Chunker.
- **Phase D:** Database Persistence (`Codebase`, `RepositoryFile`, `CodeChunk`, `CodeRelationship`).
- **Phase E:** Codebase Retrieval Engine & Grounded Q&A with Exact Line Citations.
- **Phase F:** Developer Intelligence (Cross-file dependency extraction, impact analysis, security audit, documentation generation).
- **Phase G:** Frontend Integration (`CodebasesView`, `CodebaseDetailView`, File Explorer, Code Viewer, Dependency Explorer).
- **Phase H:** Automated Test Suite (Unit, Integration, Adversarial, Regression) & Documentation.

---

## 8. Verification & Compatibility Matrix
All original endpoints (`/api/auth/*`, `/api/documents/*`, `/api/chat`, `/api/health`) remain untouched and 100% backward-compatible. Document RAG tests and Codebase tests run independently and simultaneously.
