# DevMind AI — Phase 5 Architecture Audit Report: RAG Observability & Evaluation Readiness

**Document Version:** 1.0  
**Date:** October 31, 2026  
**Auditor:** Senior RAG Engineer, AI Evaluation Researcher & Full-Stack MERN Architect  
**Scope:** Architecture Audit for Production-Grade RAG Observability, Diagnostic Evaluation, and Developer Dashboard  

---

## 1. Executive Summary

This architecture audit inspects all 12 operational stages of the DevMind AI codebase to design a zero-paid, highly secure, production-grade **RAG Observability and Evaluation Engine** with an integrated **Developer/Admin Dashboard**.

The objective is not merely to track whether an answer is correct, but to diagnose **WHY** a question failed, pinpointing the exact malfunctioning stage across the pipeline: **Query Understanding**, **Retrieval**, **Context Construction**, **Generation**, **Citation**, or **Cache**.

---

## 2. In-Depth Inspection of Existing 12 Architecture Components

### 2.1 RAG Query Lifecycle (`backend/routes/chatRoutes.js`, `backend/services/documentService.js`)
- Inbound user request hits `POST /api/chat` with `{ question, documentIds, topK, conversationHistory }`.
- Authenticated via `authenticateUser` middleware (`req.user._id`).
- Dispatched to `queryDocumentRAG(question, documentIds, topK, userId, options)`.
- Returns `{ answer, sources, rewrittenQuery, wasRewritten, cached }`.
- **Current Observability Gap**: The request flow does not currently persist per-stage duration telemetry (rewrite time, embedding time, vector search time, LLM time), nor does it capture candidate chunk score distributions or failure root causes.

### 2.2 Document Ingestion & Chunking (`backend/RAG/documentProcessor.js`, `documentService.js`)
- Streams PDF/TXT to disk with a 15MB file size limit.
- `splitIntoChunks(text, chunkSize = 1000, overlap = 200)` preserves structure:
  - Paragraph double-newline boundaries preserved.
  - Section headers (`#`, `1.`, `SECTION`) retained to prevent orphan text.
  - Generates cohesive chunks with sliding overlap window.

### 2.3 Embedding Generation (`backend/RAG/embeddingGenerator.js`)
- Local `@xenova/transformers` with `Xenova/all-MiniLM-L6-v2`.
- Outputs 384-dimensional dense floating-point vector arrays.
- Vectors are L2-normalized, allowing cosine similarity to be computed via dot product.
- Fully local and zero-cost; zero paid external embedding APIs.

### 2.4 Hybrid Retrieval & Multi-Entity Evidence (`backend/services/documentService.js`)
- Filter strictly bounded by `userId` and `documentId in readyDocs`.
- Cosine vector similarity computed against candidate chunks.
- Lexical keyword match boost (up to 0.15) applied for query terms $> 2$ characters.
- Candidate pool selected ($topK \times 3$).
- Entity detection (`extractCandidateEntities`) ensures multi-entity questions (e.g. comparing programmes) retrieve dedicated evidence chunks for each named entity.
- Chunks sorted strictly by descending hybrid score in `sources`.

### 2.5 Query Rewriting (`backend/RAG/queryRewriter.js`)
- Reformulates conversational, fragmented, abbreviation-heavy, or Hinglish queries into standalone retrieval queries.
- Bounded 8s timeout with safe fallback to original question.
- Controlled via `QUERY_REWRITING_ENABLED` feature flag.

### 2.6 Semantic Caching (`backend/services/semanticCacheService.js`, `models/SemanticCacheEntry.js`)
- Scoped to `userId` and SHA-256 hash of sorted authorized document IDs.
- Normalized query embedding compared against candidate cache entries with cosine threshold ($0.92$).
- Auto-invalidates upon document updates, re-indexing, retries, and deletions.

### 2.7 Context Construction (`backend/RAG/providers/BaseLLMProvider.js`)
- `formatContext(cleanChunks)` enforces budget limits (`maxChunks = 6`, `maxTotalChars = 8000`).
- Re-orders top candidate chunks into chronological narrative document order (`chunkIndex`) to prevent fragmented reading order for the generator.

### 2.8 LLM Generation Abstraction (`backend/RAG/providers/`)
- `BaseLLMProvider`: Abstract contract.
- `GeminiProvider`: Connects to Google Gemini 1.5/2.0 Flash via `@google/genai` (v0.1.1) with model candidate fallback chain, 20s timeout, exponential backoff, and deduplication.
- `MockLLMProvider`: Deterministic mock generator for zero-cost tests.
- System instruction strictly enforces grounding: only use facts from excerpts; explicitly refuse when context is insufficient.

### 2.9 Citation Generation (`backend/services/documentService.js`)
- Returns `sources` array with `{ documentId, originalName, chunkIndex, text, score }`.
- Client and evaluators verify source metadata against indexed documents.

### 2.10 Existing Evaluation Frameworks (`backend/RAG/eval/`, `backend/RAG/judgeEvaluation/`)
- `retrievalEvaluator.js`: Precision@K, Recall@K, MRR, HitRate@K.
- `faithfulnessEvaluator.js`: Lexical and numerical grounding verification.
- `judgeEvaluation/`: Pairwise 5-dimension rubric evaluator with Cohen's Kappa, position bias, and verbosity bias experiments.

### 2.11 Authentication & Admin Authorization (`backend/middleware/authMiddleware.js`, `models/User.js`)
- JWT-based authentication in HTTP-only cookies and `Authorization: Bearer` headers.
- User schema includes `role: { type: String, enum: ['user', 'admin'], default: 'user' }`.
- **Requirement**: Implement `requireAdmin` middleware to guard all `/api/admin/rag/...` endpoints while allowing developer access in local development environments.

### 2.12 Frontend Architecture & Routing (`frontend/src/`)
- React 19 + Vite with Tailwind CSS and Lucide React icons.
- Single Page App architecture inside `App.jsx` with active view state (`overview`, `codebases`, `documents`, `chat`).
- Responsive sidebar with clean dark/midnight glassmorphism design system (`DvLogo`, `TopHeader`, `Sidebar`).
- Seamless extension: Mount `rag-dashboard` inside `Sidebar.jsx` and render `RAGDashboardView.jsx` in `App.jsx`.

---

## 3. Architecture Blueprint for Phase 5

```text
backend/
├── RAG/
│   ├── observability/
│   │   ├── ragTracer.js              # Request instrumentation & sanitization
│   │   └── traceCollector.js         # Buffer & background trace persistence
│   └── productionEvaluation/
│       ├── diagnosisEngine.js        # 6-stage failure classifier (Query, Retrieval, Context, LLM, Citation, Cache)
│       ├── benchmarkRunner.js        # Multi-document production benchmark orchestrator
│       ├── realDocumentDataset.js    # 36 human-reviewed real-doc evaluation items
│       └── metricsAggregator.js      # Unified quality, IR, hallucination, and reliability metrics
├── models/
│   ├── RAGQueryTrace.js              # MongoDB schema for request traces & telemetry
│   └── RAGDiagnosticRun.js           # MongoDB schema for evaluation runs, configs, and metrics
├── routes/
│   └── adminRAGRoutes.js             # Secure REST API endpoints (/api/admin/rag/...)
└── middleware/
    └── adminMiddleware.js            # Admin & Developer role verification

frontend/src/
└── components/
    ├── RAGDashboard/
    │   ├── RAGDashboardView.jsx      # Master Container with 9 Tabbed Sections
    │   ├── RAGDashboardView.css      # Responsive styles matching DevMind theme
    │   ├── OverviewTab.jsx           # KPI summary cards & pipeline health
    │   ├── EvaluationRunsTab.jsx     # Run manager & trigger
    │   ├── QueryAnalyticsTab.jsx     # Filterable query table & status badges
    │   ├── RetrievalInspectorTab.jsx # Candidate chunks, scores & ranks
    │   ├── AnswerInspectorTab.jsx    # Grounded vs generated side-by-side
    │   ├── HallucinationAnalysisTab.jsx # Claim verification & contradictions
    │   ├── DocumentAnalyticsTab.jsx  # Ingestion stats & retrieval hit/miss ratios
    │   ├── PerformanceTab.jsx        # Latency breakdown & throughput
    │   └── RegressionComparisonTab.jsx # Run A vs Run B comparison
```

---

## 4. Security & Data Protection Controls

1. **Strict Sanitization**: Telemetry records strip JWTs, Authorization headers, and passwords.
2. **Context Bounding**: Traces store excerpts capped at 1,000 characters to prevent memory bloat and unauthorized document exposure.
3. **Multi-Tenant Scoping**: All trace queries are strictly indexed and scoped to `userId` or authenticated `admin`.
4. **No Unauthenticated Access**: All `/api/admin/rag/*` endpoints require verified admin credentials or active local developer sessions.

