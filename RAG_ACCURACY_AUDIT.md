# DevMind AI: RAG Retrieval Accuracy & Context Optimization Audit

**Date:** October 30, 2026  
**Auditor:** DevMind AI Agentic Architecture Team  
**System Tested:** Northstar Community Learning Hub Report (`Northstar_Community_Learning_Hub_Report.txt`)  
**Status:** Audit Completed & Failure 100% Empirically Reproduced  

---

## 1. Executive Summary & Problem Statement

The user reported a severe retrieval and reasoning failure when querying a document titled `Northstar_Community_Learning_Hub_Report.txt`:

> **Query:**  
> *"Among the three time-limited programmes, which programme had the highest completion rate? Calculate its completion rate to one decimal place. Then compare it with Northstar's overall completion rate of 74.7% and state the difference in percentage points. Use only the figures provided in the report."*

**Actual Observed Failure:**  
The chatbot erroneously responded that the document did not contain the individual programme enrolment and completion figures. The retrieved chunks presented to the model were:
- **Chunk 1 (69% match):** Contained the combined total (381 completers, 510 enrolments, overall rate 74.7%, centre enrolments).
- **Chunk 2 (65% match):** Contained Community Mentor Circle details and the opening sentence of Section 3.
- **Chunk 3 (62% match):** Contained Career Launch 3-month follow-up employment survey results.

None of the individual programme enrolment/completion pairs (`Digital Foundations: 240/186`, `Code Pathways: 150/105`, `Career Launch: 120/90`) were retrieved or supplied to the LLM.

**Audit Finding:**  
Through live database inspection and running the exact query against the stored document in MongoDB (`mern_dev_db`), this failure was **100% empirically reproduced**. The top retrieved chunks scored exactly **0.6915 (Chunk 8)**, **0.6520 (Chunk 7)**, and **0.6161 (Chunk 10)**.

---

## 2. Current End-to-End RAG Architecture

```
[Uploaded Document (.txt / .pdf)]
             │
             ▼
[documentService.js :: extractTextFromBuffer]
   - PDF: pdf-parse (text extracted, linebreaks collapsed)
   - TXT: buffer.toString('utf-8')
             │
             ▼
[documentProcessor.js :: splitIntoChunks(text, 500, 100)]
   - Chunk character length: 500 chars (target maximum)
   - Overlap: 100 chars
   - Boundary detection: regex /[.!?\n]\s+/g in latter 60% of chunk
             │
             ▼
[embeddingGenerator.js :: generateEmbeddings(chunks)]
   - Model: Xenova/all-MiniLM-L6-v2 via ONNX Runtime
   - Output: 384-dimensional dense vectors
   - Pooling: mean, normalized: true
             │
             ▼
[DocumentChunk Collection in MongoDB]
   - Indexed fields: documentId, userId, chunkIndex
             │
             ▼  <Query Phase>
[documentService.js :: retrieveRelevantChunks(question, documentIds, topK=3..4, userId)]
   - Embeds query with all-MiniLM-L6-v2
   - Cosine similarity between query vector and candidate chunk vectors
   - Lexical keyword matching: checks non-stopword tokens (len > 2), adds up to 0.15 boost
   - Noise gate: filters score < 0.10
   - Sorting: descending by hybrid score, slices top-K (default 3 to 4)
             │
             ▼
[BaseLLMProvider.js :: formatContext(cleanChunks)]
   - maxChunks: 5
   - maxTotalChars: 6000
   - Formats as: [Document Excerpt N - Source: <filename>]\n<chunk text>
             │
             ▼
[GeminiProvider.js :: generateAnswer(question, relevantChunks, options)]
   - Models: candidate chain [gemini-3.5-flash-lite, gemini-3.8-flash, etc.]
   - Temperature: 0.1
   - System instruction: strictly grounded, answer using ONLY facts directly mentioned
   - If missing: "The provided documents do not contain enough information to answer this question."
```

---

## 3. Component & Configuration Inventory

| Component | Source File Path | Current Configuration |
|---|---|---|
| **Text Chunking** | `backend/RAG/documentProcessor.js` | `chunkSize = 500` characters, `overlap = 100` characters. Splits on `[.!?\n]\s+` or space. |
| **Embeddings** | `backend/RAG/embeddingGenerator.js` | `Xenova/all-MiniLM-L6-v2`, 384 dimensions, normalized L2 vectors. |
| **Vector Store** | `backend/RAG/vectorStore.js` | In-memory cosine similarity, `topK = 2` default. |
| **Document Storage & Retrieval** | `backend/services/documentService.js` | MongoDB `DocumentChunk` records. `topK = 4` default in service, but overridden by route. |
| **Chat API Route** | `backend/routes/chatRoutes.js` | `typeof topK === 'number' && topK > 0 ? topK : 3` (Hardcoded default `topK = 3`). |
| **Context Assembly** | `backend/RAG/providers/BaseLLMProvider.js` | `maxChunks = 5`, `maxTotalChars = 6000`. |
| **LLM Inference** | `backend/RAG/providers/GeminiProvider.js` | Gemini API, `temperature: 0.1`, `maxOutputTokens: 600`, timeout 20s. |
| **Evaluation Suite** | `backend/RAG/eval/` | 24-case evaluation dataset (`dataset.js`), IR evaluator (`retrievalEvaluator.js`), Faithfulness evaluator (`faithfulnessEvaluator.js`). |

---

## 4. Confirmed Root Causes of the Failure

### Root Cause 1: Oversized Fragmentation & Boundary Severing (Chunk Size = 500)
In `backend/RAG/documentProcessor.js`, the default chunk size is **500 characters** with **100 characters overlap**.
In `Northstar_Community_Learning_Hub_Report.txt`, Section 2 ("PROGRAMMES") describes four programmes across ~1,800 characters:
- **Chunk 2 (indices 720 to 1180):** Contains the header `2. PROGRAMMES`, `A. Digital Foundations`, age range, and delivery schedule. It cuts off **before** the completion criteria and statistics!
- **Chunk 3 (indices 1080 to 1540):** Begins mid-sentence with `- Delivery: two 90-minute sessions... A participant is counted as a programme completer... The programme had 240 enrolments and 186 completers.` Followed immediately by `B. Code Pathways`.
  - **Critical Defect:** Chunk 3 contains `240 enrolments and 186 completers`, but **the string "Digital Foundations" is completely absent from Chunk 3** because it was severed at Chunk 2's boundary!
- **Chunk 4 & 5:** Severed `Code Pathways` and `Career Launch` across two chunks each.

### Root Cause 2: Semantic Density Mismatch & Vocabulary Asymmetry
The user's query asks:
> *"Among the three time-limited programmes, which programme had the highest completion rate? Calculate its completion rate to one decimal place. Then compare it with Northstar's overall completion rate of 74.7%..."*

Look at Chunk 8:
> *"The overall completion rate for those three time-limited programmes is calculated as total completers divided by total enrolments. Northstar reports this as 74.7%, rounded to one decimal place..."*

Chunk 8 has an overwhelming semantic and lexical similarity to the query (cosine = 0.6025, hybrid = 0.6915).
Similarly, Chunk 7 contains `"three time-limited programmes—Digital Foundations, Code Pathways, and Career Launch—there were 510 enrolments in total and 381 programme completers in total"` (cosine = 0.5957, hybrid = 0.6520).
Chunk 10 discusses `Career Launch completers` (cosine = 0.5880, hybrid = 0.6161).

Meanwhile, Chunk 3 (which holds the numbers `240 enrolments and 186 completers`) had a cosine score of only **0.3660**.
Chunk 4 (Code Pathways numbers `150` and `105`) had a cosine score of **0.2612**.
Chunk 5 (Career Launch numbers `120` and `90`) had a cosine score of **0.1903**.

Because the question is an analytical synthesis question, **dense semantic search scores the summary/overview paragraphs far higher than the individual fact-listing paragraphs**.

### Root Cause 3: Top-K Starvation (`topK = 3`)
In `backend/routes/chatRoutes.js` (line 45), `topK` defaults to **3**.
Because the top 3 spots were occupied by Chunks 8, 7, and 10, **none** of Chunks 3, 4, or 5 were ever retrieved or passed to the LLM. The LLM was handed only summary statistics and survey results, making it impossible to answer.

### Root Cause 4: Absence of Multi-Entity Evidence Collection
When a question asks to compare multiple named entities or members of a category (*"Among the three time-limited programmes..."*), standard single-vector retrieval only fetches the nearest neighbors to the query vector as a single point in space. It does not ensure coverage across each entity mentioned or implied.

### Root Cause 5: LLM Grounding Prompt Lacked Synthesis & Arithmetic Directives
The current `SYSTEM_INSTRUCTION` in `GeminiProvider.js` says:
> *"Answer using ONLY facts directly mentioned in the provided excerpts. Do not infer, assume, or extrapolate beyond the text."*

When an LLM is asked to perform arithmetic (`186 / 240 = 77.5%`) or compare entities, this rule can cause the LLM to refuse if it believes calculating completion rates from raw enrolments and completers is an unauthorized "inference" or "extrapolation." The prompt must explicitly authorize basic arithmetic and entity comparison using provided numbers.

---

## 5. Unverified Hypotheses Ruled Out

1. **Hypothesis: Text Extraction / PDF parsing corrupted the data.**
   - *Status:* **RULED OUT.** Inspection of `doc.extractedText` confirmed all 8,783 characters were extracted perfectly with zero missing characters or corrupted tables.
2. **Hypothesis: MongoDB database failure or dropped chunks.**
   - *Status:* **RULED OUT.** All 24 chunks were present in MongoDB with verified embeddings.
3. **Hypothesis: Model failure or API key outage.**
   - *Status:* **RULED OUT.** `GeminiProvider` connects cleanly and responds properly.
4. **Hypothesis: Embedding dimensions corrupted.**
   - *Status:* **RULED OUT.** Embeddings are strictly 384 dimensions from `all-MiniLM-L6-v2`.

---

## 6. Proposed Actionable Improvements (Ranked)

| Rank | Improvement Area | Description | Expected Impact | Implementation Effort | Regression Risk |
|---|---|---|---|---|---|
| **1** | **Structure-Aware Chunking & Header Preservation** | Upgrade `documentProcessor.js` to support section/heading awareness (e.g. keeping `A. Digital Foundations` with its data), increase default chunk size from 500 to 1,000–1,200 chars, with 200 overlap, and preserve markdown/list formatting. | **CRITICAL** (Keeps programme names and statistics together) | Low | Low (existing documents can be re-indexed safely) |
| **2** | **Separate Candidate Retrieval vs Final Context Selection** | Decouple retrieval: Retrieve top 12–15 candidate chunks from vector/keyword search, deduplicate/rerank, and supply top 5–6 high-density chunks to the LLM context. | **HIGH** (Prevents top-K starvation where 3 summary chunks crowd out data chunks) | Low | Very Low |
| **3** | **Multi-Entity & Keyword-Aware Query Expansion** | If a query mentions or refers to multiple entities (e.g., detected entities in query or top summary chunk like `Digital Foundations`, `Code Pathways`, `Career Launch`), perform targeted secondary candidate retrieval to guarantee evidence coverage for each entity. | **HIGH** (Directly solves multi-hop comparison queries) | Medium | Very Low |
| **4** | **Query-Aware Context Construction & Deduplication** | Order chunks logically (by document flow / section order), remove near-duplicate chunks, and ensure context budget (up to 8,000 chars) is utilized effectively without truncation. | **HIGH** (Preserves reasoning flow for the LLM) | Medium | Very Low |
| **5** | **Grounded Answering Prompt Upgrade** | Update system prompt to explicitly instruct the model to perform requested arithmetic, compare entities, and clearly distinguish missing context from genuinely unanswerable facts. | **HIGH** (Eliminates false refusals and supports arithmetic) | Low | Very Low |
| **6** | **Missing Information & Fallback Handling** | When evidence is partial or query is genuinely unanswerable (e.g. "Sunday sessions attended every week"), properly distinguish between context absence vs document absence without hallucinations. | **MEDIUM** (Prevents hallucinations and false refusals) | Low | Very Low |
| **7** | **Northstar Regression & Benchmark Test Suite** | Add automated deterministic test suite verifying the Northstar completion calculations (77.5%, 70.0%, 75.0%, 2.8 percentage points) and Sunday session missing information test. | **HIGH** (Prevents regressions permanently) | Medium | Zero |

---
*Audit approved for Phase 2–8 execution.*
