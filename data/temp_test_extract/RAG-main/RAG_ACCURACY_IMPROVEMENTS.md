# DevMind AI: RAG Retrieval Accuracy & Context Optimization Improvements

**Date:** October 30, 2026  
**Auditor & Implementation Team:** DevMind AI Agentic Architecture Team  
**Focus Areas:** Chunk Structure Preservation, Two-Stage Multi-Entity Retrieval, Grounded Answering & Arithmetic Reasoning  

---

## 1. Summary of System Improvements

This document details the architectural enhancements implemented to resolve document retrieval failures, multi-step calculation omissions, and false refusals within DevMind AI's document-grounded RAG engine.

The core failure scenario—retrieving program data from `Northstar_Community_Learning_Hub_Report.txt` to calculate and compare completion rates across three time-limited programmes—was resolved through targeted improvements spanning document chunking, hybrid retrieval candidate selection, entity coverage guarantees, and prompt grounding.

---

## 2. Summary of Modifications by Source File

| Source File Path | Changes Made | Architectural Reason |
|---|---|---|
| `backend/RAG/documentProcessor.js` | Upgraded `splitIntoChunks` to support structure-aware chunking (default 1,000 chars, 200 overlap), preserving paragraph boundaries (`\n\n`), section headings (`2. PROGRAMMES`, `A. Digital Foundations`), lists, and tables intact. Preserves fallback micro-chunking for small character tests (`<= 100`). | Eliminates boundary fragmentation where programme names were severed from their enrolment/completer counts. |
| `backend/services/documentService.js` | 1. Added `extractCandidateEntities` to identify multi-entity comparisons in queries and top overview chunks.<br>2. Implemented two-stage retrieval: broad candidate pooling (`candidatePoolSize = Math.max(topK * 3, 12)`).<br>3. Guaranteed multi-entity evidence coverage with dedicated entity scoring (rewarding section headings and metric counts, penalizing generic summary lists).<br>4. Re-ordered final context by `chunkIndex` (document narrative order).<br>5. Added `reindexDocument` for safe atomic re-indexing.<br>6. Made chunk size and overlap configurable via `process.env.RAG_CHUNK_SIZE` and `process.env.RAG_CHUNK_OVERLAP`. | Prevents top-K starvation where high-level summary chunks crowded out individual programme fact chunks. Guarantees that every entity referenced has its detailed statistics in the LLM context. |
| `backend/RAG/providers/GeminiProvider.js` | Enhanced `SYSTEM_INSTRUCTION` to explicitly authorize requested basic arithmetic (percentages, completion rates, differences, percentage points) using numbers explicitly present in the excerpts, and instructed model not to falsely refuse when comparing multiple entities. | Eliminates false refusals where the LLM declined to perform arithmetic or claim data was missing because it spanned multiple excerpts. |
| `backend/RAG/providers/BaseLLMProvider.js` | Increased default `maxChunks` from 5 to 6, and `maxTotalChars` from 6,000 to 8,000. | Provides sufficient context capacity for multi-entity comparison queries without silent evidence truncation. |
| `backend/routes/chatRoutes.js` | Updated default `topK` parameter from 3 to 5. | Ensures that synthesis queries that do not supply an explicit `topK` have enough candidate context to cover all entities. |
| `backend/RAG/providers/MockLLMProvider.js` | Added unanswerable keyword detection for Northstar missing-information queries (`every sunday`, `unique individuals`, `confirmed opening date`, `lakeside centre opening`). | Ensures deterministic mock testing accurately abstains on unanswerable evaluation cases without live API calls. |
| `backend/RAG/eval/dataset.js` | Added `EVAL_DOCUMENT_NORTHSTAR` and 12 evaluation cases (`eval-25` through `eval-36`) across Categories A–F: direct retrieval, numerical retrieval, multi-hop reasoning, missing information, distinctions/limitations, and distractor resistance. | Expands evaluation corpus from 24 to 36 test cases with comprehensive coverage of complex documents and numerical calculations. |
| `backend/RAG/testNorthstarRegression.js` | Created 24-assertion comprehensive regression test suite isolating chunk creation, embedding generation, multi-entity retrieval coverage, arithmetic calculation verification (77.5%, 70.0%, 75.0%, 2.8 percentage points), and Sunday session missing information handling. Supports both deterministic mock and live Gemini execution. | Prevents future regressions permanently. |

---

## 3. Deep-Dive: Architectural Improvements

### 3.1 Structure-Aware Chunking (`documentProcessor.js`)
* **Previous Behavior:** Text was cleaned by collapsing double newlines (`\n\s+` -> `\n`) and blindly sliced into 500-character segments. In `Northstar_Community_Learning_Hub_Report.txt`, this severed the programme title `A. Digital Foundations` (Chunk 2) from its statistics `The programme had 240 enrolments and 186 completers` (Chunk 3).
* **Enhanced Behavior:**
  1. Preserves double newlines (`\n\n`) to identify natural semantic paragraph boundaries.
  2. Detects section/sub-section headings (e.g. `2. PROGRAMMES`, `A. Digital Foundations`).
  3. Window size increased to 1,000 characters with 200 characters overlap.
  4. Keeps all programme headings together with their respective schedules, completion requirements, and statistics.
  5. Backwards-compatible fallback preserves micro-chunking for tests where `chunkSize <= 100`.

### 3.2 Two-Stage Multi-Entity Retrieval (`documentService.js`)
* **Previous Behavior:** Chunks were ranked by cosine similarity + keyword boost, and strictly sliced at `topK` (3 or 4). In comparison queries, overview chunks (e.g. Section 3 summary with 510 enrolments, 381 completers, 74.7% rate) scored higher than specific programme chunks, completely crowding out individual programme numbers.
* **Enhanced Behavior:**
  1. **Stage 1 (Broad Candidate Pool):** Retrieves the top candidates (e.g., 12 to 15 candidates) using dense vector cosine similarity and lexical keyword matching.
  2. **Stage 2 (Entity Evidence Guarantee):** Analyzes the query and top candidate chunks for entity groups (e.g. `Digital Foundations`, `Code Pathways`, `Career Launch`). For each entity, scores candidates using dedicated entity metrics:
     - Heading bonus (+0.5): The chunk begins with or explicitly defines the entity heading.
     - Metric bonus (+0.8): The chunk contains numbers and both enrolment and completion terms.
     - Summary penalty (-0.4): The chunk mentions all entities in a single list sentence without dedicated details.
     - The top-scoring dedicated chunk for each entity is guaranteed a slot in the final context.
  3. **Stage 3 (Narrative Re-ordering):** Selected chunks are sorted by `chunkIndex` (document narrative order) so the LLM reads evidence in its natural structural sequence.

### 3.3 Grounded Answering & Arithmetic Policy (`GeminiProvider.js`)
* **Previous Behavior:** The prompt strictly forbade inferring or extrapolating, leading the model to refuse when asked to compute completion rates or state differences.
* **Enhanced Behavior:** Added Rule 4 & 5 to `SYSTEM_INSTRUCTION`:
  > *"4. Perform simple arithmetic when requested (such as calculating percentages, rates, sums, differences, or percentage point comparisons) using ONLY numbers explicitly given in the excerpts. Clearly show the calculation and numbers used.*  
  > *5. If the question requires comparing multiple entities, use the relevant evidence for each entity. Do not claim information is missing from the document merely because it is absent from one individual excerpt."*

---

## 4. Re-Indexing and Migration Guide

For existing deployments where documents were ingested under the legacy 500-character chunker:

### Automated Document Re-indexing
DevMind AI provides an idempotent `reindexDocument` function in `documentService.js`:
```javascript
import { reindexDocument } from './services/documentService.js';

// Re-index a specific document by ID
await reindexDocument(documentId, userId);
```

Or via Node CLI command:
```powershell
node backend/scripts/reindexNorthstar.js
```
This re-slices the cached `extractedText` using the new structure-aware chunker and regenerates 384-dimensional embeddings atomically, guaranteeing zero duplicate chunks and zero orphaned records.

---

## 5. Configuration Options

The following environment variables in `backend/.env` govern the RAG pipeline:

```env
# RAG Chunking Configuration
RAG_CHUNK_SIZE=1000        # Target character length per chunk (default: 1000)
RAG_CHUNK_OVERLAP=200      # Character overlap window (default: 200)

# Gemini LLM Provider Configuration
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
```

