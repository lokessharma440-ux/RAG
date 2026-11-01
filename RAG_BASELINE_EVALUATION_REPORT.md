# DevMind AI — RAG Baseline Evaluation Report

**Document Version:** 1.0  
**Date:** October 31, 2026  
**Auditor / Engineer:** Senior RAG Engineer & AI Evaluation Engineer  
**Evaluation Harness:** `backend/RAG/runEvaluation.js` / `backend/RAG/eval/dataset.js`  
**Dataset Scope:** 36 Queries across 18 IR and Grounding Categories (26 Answerable, 10 Unanswerable)  
**Database:** Local MongoDB (`mongodb://127.0.0.1:27017/mern_dev_db`)  
**Embedding Model:** `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384 dimensions)  
**LLM Mode:** Deterministic Mock Baseline Harness  

---

## 1. Executive Summary

A comprehensive technical baseline audit of the existing DevMind AI Retrieval-Augmented Generation (RAG) system was conducted. The evaluation covers information retrieval metrics (Precision@K, Recall@K, MRR, Hit Rate@K, False Positive Retrieval) at both K = 3 and K = 4, as well as generative answer faithfulness, hallucination rates, and unanswerable refusal accuracy.

### Baseline Summary Metrics

| Metric | K = 3 | K = 4 | Status / Target |
| :--- | :--- | :--- | :--- |
| **Precision@K** | 30.8% | 33.7% | Needs Improvement (> 45%) |
| **Recall@K** | 53.8% | 80.8% | Target: > 90% |
| **Mean Reciprocal Rank (MRR)** | 0.3782 | 0.4455 | Needs Improvement (> 0.65) |
| **Hit Rate@K** | 61.5% | 88.5% | Target: > 95% |
| **False Positive Retrieval** | 100.0% | 100.0% | Vector KNN returns top-K unconditionally |
| **Mean Faithfulness Score** | 95.6% | 95.6% | Good |
| **Overall Faithfulness Rate** | 94.4% | 94.4% | Good (Target: 100%) |
| **Unanswerable Refusal Accuracy** | 100.0% | 100.0% | **Optimal (10/10 Correct Refusals)** |

---

## 2. Category-by-Category Retrieval Breakdown (K = 4)

| Category | Total | Answerable | Unanswerable | P@4 | R@4 | MRR | Hit Rate@4 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `direct_factual` | 3 | 3 | 0 | 25.0% | 100.0% | 0.44 | 100.0% |
| `multi_chunk` | 3 | 3 | 0 | 41.7% | 83.3% | 0.36 | 100.0% |
| `paraphrased` | 3 | 3 | 0 | 25.0% | 100.0% | 0.28 | 100.0% |
| `similar_terminology` | 3 | 3 | 0 | 33.3% | 66.7% | 0.67 | 100.0% |
| `unanswerable_absent` | 3 | 0 | 3 | N/A | N/A | N/A | N/A |
| `unsupported_assumptions` | 3 | 0 | 3 | N/A | N/A | N/A | N/A |
| `multi_document` | 1 | 1 | 0 | 25.0% | 50.0% | 0.50 | 100.0% |
| `partial_evidence` | 1 | 1 | 0 | 25.0% | 100.0% | 0.25 | 100.0% |
| `contradictory_evidence` | 1 | 1 | 0 | 25.0% | 100.0% | 0.25 | 100.0% |
| `hard_to_retrieve` | 1 | 1 | 0 | **0.0%** | **0.0%** | **N/A** | **0.0%** |
| `long_technical` | 1 | 1 | 0 | **0.0%** | **0.0%** | **N/A** | **0.0%** |
| `partial_answer_uncertainty` | 1 | 0 | 1 | N/A | N/A | N/A | N/A |
| `direct_retrieval_northstar` | 2 | 2 | 0 | 37.5% | 100.0% | 1.00 | 100.0% |
| `numerical_retrieval_northstar` | 2 | 2 | 0 | **50.0%** | **50.0%** | **0.50** | **50.0%** |
| `multihop_reasoning_northstar` | 2 | 2 | 0 | 50.0% | 100.0% | 0.38 | 100.0% |
| `missing_info_northstar` | 3 | 0 | 3 | N/A | N/A | N/A | N/A |
| `distinctions_northstar` | 2 | 2 | 0 | 25.0% | 100.0% | 0.29 | 100.0% |
| `distractor_resistance_northstar`| 1 | 1 | 0 | 100.0% | 100.0% | 1.00 | 100.0% |

---

## 3. Critical Root Cause Analysis of Baseline Weaknesses

Detailed inspection and debugging revealed three structural bottlenecks affecting retrieval accuracy, MRR, and false refusals:

### 3.1 Premature Chunk Sorting by `chunkIndex` in Retrieval
- **Mechanism**: In `backend/services/documentService.js` (lines 785-788), `selectedChunks` are sorted in ascending order of `chunkIndex`:
  ```javascript
  selectedChunks.sort((a, b) => {
    if (a.documentId !== b.documentId) return a.documentId.localeCompare(b.documentId);
    return (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0);
  });
  ```
- **Consequence**:
  - The highest-scoring relevant chunks (such as Chunk 6 with a score of 0.889 in `eval-28`) are sorted to the tail of the list.
  - When callers or evaluation slices `sources.slice(0, 4)`, Chunk 6 is truncated out despite having the highest relevance score in the document!
  - For all other queries, introductory Chunk 0 (which often has low relevance) is arbitrarily promoted to Rank 1, severely depressing MRR from ~0.75+ down to 0.4455.
- **Remedy**: `retrieveRelevantChunks` must preserve descending relevance score ordering in its returned `sources` array. Narrative ordering by `chunkIndex` should only be applied downstream inside `formatContext()` during prompt construction for the LLM.

### 3.2 Fixed Lexical Boost Term Weighting & Stopword Filtering
- **Mechanism**: In `retrieveRelevantChunks`, lexical keyword matching uses an unweighted ratio `(matchedTerms / queryTerms.length) * 0.15`.
- **Consequence**: In long queries (`eval-23`) or technical nuance queries (`eval-22`), general words dilute the ratio, preventing high-specificity technical terms (e.g., regex strings, "minimum character length") from boosting the target chunk into the top candidates.

### 3.3 Strict Lexical Overlap Penalty on Multi-Hop Queries
- **Mechanism**: In `MockLLMProvider.js`, queries `eval-02` and `eval-34` triggered `FALSE_REFUSAL` because the token support ratio heuristic required >= 35% exact keyword match against the single first retrieved chunk, even when the answer was fully supported across the retrieved context set.

---

## 4. Optimization Plan for Phase 11

1. **Relevance-Preserving Retrieval Output**:
   - Order `sources` strictly by descending hybrid relevance score (`score`).
   - Format prompt context in `BaseLLMProvider.formatContext()` in logical narrative order (`chunkIndex`).
2. **Dynamic Top-K Retrieval Budgeting**:
   - Allow `retrieveRelevantChunks` to return the true top-K highest-scoring chunks without truncating high-relevance chunks via arbitrary index-based reordering.
3. **Lexical Matching Enhancement**:
   - Enhance hybrid search with inverse frequency or query-term length weighting so specific technical terms carry proportional weight.
4. **Grounded Synthesis & Verification**:
   - Verify all 36 evaluation cases post-optimization to validate that `eval-22`, `eval-23`, `eval-28`, `eval-02`, and `eval-34` achieve 100% faithfulness and hit rate.

