/**
 * Phase D1: Deterministic Evaluation Dataset
 *
 * Contains:
 * 1. Reference corpus document (rag_architecture_reference.txt) with well-defined chunks.
 * 2. Deterministic evaluation queries covering:
 *    - Direct factual questions
 *    - Multi-chunk synthesis questions
 *    - Paraphrased questions
 *    - Similar / confusing terminology questions
 *    - Questions whose answers are absent from the document (unanswerable)
 *    - Questions based on unsupported assumptions
 */

export const EVAL_DOCUMENT = {
  id: 'doc-eval-rag-architecture-2026',
  originalName: 'rag_architecture_reference.txt',
  fileType: 'txt',
  text: `SECTION 1: CORE RAG WORKFLOW AND ARCHITECTURE
Retrieval-Augmented Generation (RAG) is an architectural framework that grounds large language model responses in verified external knowledge. The workflow operates in two distinct phases: ingestion and inference. During ingestion, source documents are extracted, cleaned, partitioned into fixed overlapping chunks, and transformed into dense vector representations. During inference, user queries are embedded into the same mathematical vector space to identify top matching excerpts using cosine similarity before passing them to a grounded generative model.

SECTION 2: EMBEDDING GENERATION AND VECTOR SPACE
The embedding pipeline utilizes the local Xenova/all-MiniLM-L6-v2 transformer model running via ONNX Runtime in Node.js. It maps raw text chunks into 384-dimensional dense floating-point vector arrays. All embeddings are normalized so that cosine similarity values range between -1.0 and 1.0. A cosine similarity threshold of 0.10 is applied as a noise gate to filter out irrelevant chunks before ranking candidate passages.

SECTION 3: HYBRID RETRIEVAL AND LEXICAL BOOST
The retrieval engine combines semantic dense vector search with an exact lexical keyword matching boost to overcome semantic search blind spots. After stopwords such as articles and prepositions are removed from the user query, remaining query terms are checked against candidate chunk text. A lexical keyword boost of up to 0.15 is added to the cosine similarity score proportionally to matched terms. The hybrid score is calculated as: HybridScore = VectorCosineSimilarity + LexicalKeywordBoost.

SECTION 4: GROUNDED ANSWER GENERATION AND GUARDRAILS
Answer generation utilizes the Gemini API using high-speed flash-tier models such as gemini-3.5-flash-lite and gemini-3.8-flash. The model is constrained with a strict system instruction and a low temperature of 0.1 to minimize hallucinations. The model must answer using only direct facts mentioned in retrieved excerpts. If the retrieved excerpts do not contain enough information to answer the question, the system is instructed to state explicitly: "The provided documents do not contain enough information to answer this question."

SECTION 5: MULTI-TENANT ISOLATION AND ACCESS CONTROL
Data privacy and multi-tenant security are enforced through strict backend ownership scoping. Every Document and DocumentChunk record in MongoDB includes an indexed userId ownership reference. Document chunk retrieval queries require matching both the target documentId and the authenticated user's userId. This design eliminates Insecure Direct Object Reference (IDOR) vulnerabilities and guarantees that User A cannot search, inspect, or delete chunks belonging to User B.

SECTION 6: INGESTION RELIABILITY AND RESOURCE MANAGEMENT
Upload reliability is protected through disk-backed streaming with a 15MB file size limit. Inbound files are written to a dedicated temporary directory rather than heap memory, preventing Node.js out-of-memory crashes under concurrent load. The document lifecycle tracks four explicit states: queued, processing, ready, and failed. Temporary upload files are guaranteed to be unlinked upon completion, and failed ingestions automatically purge any partially written chunks.`,
};

export const EVAL_DOCUMENT_2 = {
  id: 'doc-eval-multi-doc-operations-2026',
  originalName: 'rag_operations_reference.txt',
  fileType: 'txt',
  text: `SECTION 1: QUERY CACHING AND INDEXING OPTIMIZATIONS
The production serving layer deploys an in-memory Least Recently Used (LRU) query cache to minimize redundant embeddings and reduce database reads. Repeated identical queries within a 15-minute Time-To-Live (TTL) return cached vector search results in under 5 milliseconds. The cache key is constructed by hashing the normalized query string alongside the user ID.

SECTION 2: CONTRADICTORY VERSION POLICIES AND DEPRECATIONS
DEPRECATION NOTICE: In Legacy Architecture v1, the embedding pipeline utilized the Xenova/bge-small-en model producing 512-dimensional vectors. In current Production Architecture v2, this was completely superseded by Xenova/all-MiniLM-L6-v2 producing 384-dimensional vectors. All deployed microservices and test suites must strictly adhere to the 384-dimensional standard and disregard the deprecated 512-dimensional legacy configuration.

SECTION 3: DISASTER RECOVERY CAPABILITIES AND LIMITATIONS
Disaster recovery procedures support automated cold database snapshots taken every 24 hours and stored on secondary local storage disks. However, active multi-region automated failover and real-time cross-region database replica synchronizations are explicitly undocumented, unvalidated, and currently unsupported in this deployment tier.

SECTION 4: TOKENIZER NORMALIZATION AND KEYWORD OVERLAP RULES
When computing exact lexical keyword overlap boosts, the query tokenizer executes deterministic sanitization. Punctuation is stripped using the regular expression /[^\w\s]/g. Only words whose character length strictly exceeds 2 characters (i.e. length >= 3) and that are not members of the standard stopword set are evaluated for chunk substring matches.`,
};

export const EVAL_DOCUMENTS = [EVAL_DOCUMENT, EVAL_DOCUMENT_2];

/**
 * 12 Deterministic Evaluation Cases across all 6 required categories.
 */
export const EVAL_DATASET = [
  // --- Category 1: Direct Factual Questions ---
  {
    id: 'eval-01',
    category: 'direct_factual',
    question: 'What is the dimensionality of the vector embeddings produced by the local transformer model?',
    expectedAnswer: '384-dimensional dense floating-point vector arrays.',
    expectedPassage: 'maps raw text chunks into 384-dimensional dense floating-point vector arrays',
    relevantSectionIndex: 1, // Section 2
    isAnswerable: true,
  },
  {
    id: 'eval-02',
    category: 'direct_factual',
    question: 'What is the maximum file size limit enforced for uploaded documents?',
    expectedAnswer: '15MB file size limit.',
    expectedPassage: 'protected through disk-backed streaming with a 15MB file size limit',
    relevantSectionIndex: 5, // Section 6
    isAnswerable: true,
  },

  // --- Category 2: Multi-Chunk Questions ---
  {
    id: 'eval-03',
    category: 'multi_chunk',
    question: 'How do the hybrid retrieval equation and the low Gemini temperature work together to prevent hallucinated answers?',
    expectedAnswer: 'Hybrid retrieval combines cosine similarity with a lexical boost up to 0.15 to retrieve the most factually relevant chunks, while Gemini runs at a low temperature of 0.1 with strict system instructions to base its answer solely on those excerpts.',
    expectedPassage: 'HybridScore = VectorCosineSimilarity + LexicalKeywordBoost',
    relevantSectionIndices: [2, 3], // Section 3 & Section 4
    isAnswerable: true,
  },
  {
    id: 'eval-04',
    category: 'multi_chunk',
    question: 'How does the system ensure both multi-tenant isolation and memory safety during document ingestion?',
    expectedAnswer: 'Multi-tenant isolation is enforced via indexed userId ownership references on Document and DocumentChunk records, while memory safety is achieved by writing inbound files to disk in a temporary directory instead of Node.js heap memory.',
    expectedPassage: 'Every Document and DocumentChunk record in MongoDB includes an indexed userId ownership reference',
    relevantSectionIndices: [4, 5], // Section 5 & Section 6
    isAnswerable: true,
  },

  // --- Category 3: Paraphrased Questions ---
  {
    id: 'eval-05',
    category: 'paraphrased',
    question: 'In what way does the search system blend keyword frequency with dense vector matching?',
    expectedAnswer: 'The retrieval engine adds an exact lexical keyword boost of up to 0.15 to the cosine similarity vector score after filtering out stopwords.',
    expectedPassage: 'retrieval engine combines semantic dense vector search with an exact lexical keyword matching boost',
    relevantSectionIndex: 2, // Section 3
    isAnswerable: true,
  },
  {
    id: 'eval-06',
    category: 'paraphrased',
    question: 'What sequence of lifecycle statuses does a document transition through during processing?',
    expectedAnswer: 'queued, processing, ready, and failed.',
    expectedPassage: 'document lifecycle tracks four explicit states: queued, processing, ready, and failed',
    relevantSectionIndex: 5, // Section 6
    isAnswerable: true,
  },

  // --- Category 4: Similar or Confusing Terminology ---
  {
    id: 'eval-07',
    category: 'similar_terminology',
    question: 'What is the difference between the 0.10 cosine similarity threshold and the 0.15 lexical keyword boost?',
    expectedAnswer: 'The 0.10 threshold is a noise gate used to filter out candidate chunks with low semantic similarity, whereas the 0.15 lexical boost is the maximum score added to the vector score for matching non-stopword query terms.',
    expectedPassage: 'cosine similarity threshold of 0.10 is applied as a noise gate',
    relevantSectionIndex: [1, 2], // Section 2 & Section 3
    isAnswerable: true,
  },
  {
    id: 'eval-08',
    category: 'similar_terminology',
    question: 'How does the role of the ONNX Runtime model differ from the role of the Gemini API models?',
    expectedAnswer: 'The local ONNX Runtime model (Xenova/all-MiniLM-L6-v2) generates 384-dimensional vector embeddings during ingestion and query processing, while the Gemini API models (flash-lite/flash) synthesize the final grounded conversational answer.',
    expectedPassage: 'Xenova/all-MiniLM-L6-v2 transformer model running via ONNX Runtime',
    relevantSectionIndices: [1, 3], // Section 2 & Section 4
    isAnswerable: true,
  },

  // --- Category 5: Absent from Document (Unanswerable) ---
  {
    id: 'eval-09',
    category: 'unanswerable_absent',
    question: 'What is the pricing cost per million tokens for OpenAI GPT-4o in this system?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question.',
    expectedPassage: null,
    relevantSectionIndex: null,
    isAnswerable: false,
  },
  {
    id: 'eval-10',
    category: 'unanswerable_absent',
    question: 'How many gigabytes of RAM are required to host the Redis BullMQ cluster?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question.',
    expectedPassage: null,
    relevantSectionIndex: null,
    isAnswerable: false,
  },

  // --- Category 6: Unsupported Assumptions ---
  {
    id: 'eval-11',
    category: 'unsupported_assumptions',
    question: 'Since this RAG pipeline automatically converts all documents into German before embedding, how does it translate idioms?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question. The document does not state that documents are translated into German.',
    expectedPassage: null,
    relevantSectionIndex: null,
    isAnswerable: false,
  },
  {
    id: 'eval-12',
    category: 'unsupported_assumptions',
    question: 'Why does the system use Pinecone cloud vector database instead of MongoDB for chunk storage?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question. The document states that chunks are stored in MongoDB with indexed userId references, not in Pinecone.',
    expectedPassage: null,
    relevantSectionIndex: null,
    isAnswerable: false,
  },

  // --- Category 7: Direct Factual Questions (Operations) ---
  {
    id: 'eval-13',
    category: 'direct_factual',
    question: 'What is the configured Time-To-Live (TTL) duration for cached vector search query results in the operations specification?',
    expectedAnswer: '15-minute Time-To-Live (TTL).',
    expectedPassage: 'within a 15-minute Time-To-Live (TTL) return cached vector search results in under 5 milliseconds',
    relevantDocName: 'rag_operations_reference.txt',
    relevantSectionIndex: 0,
    isAnswerable: true,
  },

  // --- Category 8: Questions Requiring Multiple Chunks ---
  {
    id: 'eval-14',
    category: 'multi_chunk',
    question: 'How do the in-memory LRU query cache in operations and the hybrid keyword boost in architecture collaborate to optimize query latency?',
    expectedAnswer: 'The hybrid keyword boost accurately ranks passages using dense vectors and exact keywords, while the in-memory LRU cache stores those retrieved results for 15 minutes to return identical repeated queries in under 5 milliseconds without re-embedding.',
    expectedPassage: 'in-memory Least Recently Used (LRU) query cache to minimize redundant embeddings',
    relevantDocNames: ['rag_architecture_reference.txt', 'rag_operations_reference.txt'],
    isAnswerable: true,
  },

  // --- Category 9: Paraphrased Questions ---
  {
    id: 'eval-15',
    category: 'paraphrased',
    question: 'For how long do cached search query lookups persist in RAM before expiring?',
    expectedAnswer: '15 minutes.',
    expectedPassage: 'within a 15-minute Time-To-Live (TTL) return cached vector search results',
    relevantDocName: 'rag_operations_reference.txt',
    relevantSectionIndex: 0,
    isAnswerable: true,
  },

  // --- Category 10: Similar or Confusing Terminology ---
  {
    id: 'eval-16',
    category: 'similar_terminology',
    question: 'What is the operational difference between the 15MB file upload limit and the 15-minute cache TTL?',
    expectedAnswer: 'The 15MB limit is the maximum disk storage threshold enforced on uploaded document files, whereas the 15-minute TTL is the expiration duration for cached in-memory vector query results.',
    expectedPassage: '15MB file size limit',
    relevantDocNames: ['rag_architecture_reference.txt', 'rag_operations_reference.txt'],
    isAnswerable: true,
  },

  // --- Category 11: Unanswerable Absent Questions ---
  {
    id: 'eval-17',
    category: 'unanswerable_absent',
    question: 'What is the Kubernetes Helm chart deployment configuration for the vector database?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question.',
    expectedPassage: null,
    isAnswerable: false,
  },

  // --- Category 12: Unsupported Assumptions ---
  {
    id: 'eval-18',
    category: 'unsupported_assumptions',
    question: 'Given that this system uses Elasticsearch for BM25 keyword scoring, what is the cluster shard count?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question. The document states lexical boost uses custom keyword overlap, not Elasticsearch.',
    expectedPassage: null,
    isAnswerable: false,
  },

  // --- Category 13: Multiple Uploaded Documents ---
  {
    id: 'eval-19',
    category: 'multi_document',
    question: 'What vector embedding dimensionality is defined in the architecture reference, and what cache TTL is specified in the operations reference?',
    expectedAnswer: 'The architecture reference defines 384-dimensional dense vectors, while the operations reference specifies a 15-minute cache TTL.',
    expectedPassages: ['384-dimensional', '15-minute Time-To-Live'],
    relevantDocNames: ['rag_architecture_reference.txt', 'rag_operations_reference.txt'],
    isAnswerable: true,
  },

  // --- Category 14: Partial Evidence ---
  {
    id: 'eval-20',
    category: 'partial_evidence',
    question: 'Does the system support cold snapshots and real-time cross-region database replication for disaster recovery?',
    expectedAnswer: 'The system supports automated cold database snapshots every 24 hours. However, real-time cross-region database replication is explicitly undocumented and unsupported.',
    expectedPassage: 'automated cold database snapshots taken every 24 hours and stored on secondary local storage disks',
    relevantDocName: 'rag_operations_reference.txt',
    relevantSectionIndex: 2,
    isAnswerable: true,
  },

  // --- Category 15: Contradictory Evidence & Deprecations ---
  {
    id: 'eval-21',
    category: 'contradictory_evidence',
    question: 'According to current specifications, does the production embedding model use 512 dimensions or 384 dimensions?',
    expectedAnswer: 'Current production uses 384 dimensions (Xenova/all-MiniLM-L6-v2). The 512-dimension model (Xenova/bge-small-en) was a legacy v1 configuration that has been completely deprecated.',
    expectedPassage: 'completely superseded by Xenova/all-MiniLM-L6-v2 producing 384-dimensional vectors',
    relevantDocName: 'rag_operations_reference.txt',
    relevantSectionIndex: 1,
    isAnswerable: true,
  },

  // --- Category 16: Difficult to Retrieve Nuance ---
  {
    id: 'eval-22',
    category: 'hard_to_retrieve',
    question: 'What exact minimum character length must a query term have to qualify for lexical keyword boosting after punctuation stripping?',
    expectedAnswer: 'A query term must strictly exceed 2 characters in length (i.e. length >= 3 characters).',
    expectedPassage: 'Only words whose character length strictly exceeds 2 characters (i.e. length >= 3)',
    relevantDocName: 'rag_operations_reference.txt',
    relevantSectionIndex: 3,
    isAnswerable: true,
  },

  // --- Category 17: Long Technical Questions ---
  {
    id: 'eval-23',
    category: 'long_technical',
    question: 'In the hybrid search pipeline, if a user query contains punctuation and mixed-case terms alongside stopwords, what sequence of transformations, normalization steps, and score additions are executed to produce the final ranked list of chunks?',
    expectedAnswer: 'Punctuation is stripped with regex, stopwords are removed, remaining terms with length > 2 are checked for chunk substring matches to calculate a lexical boost up to 0.15, which is added to the 384-d cosine similarity score.',
    expectedPassage: 'Punctuation is stripped using the regular expression /[^\w\s]/g',
    relevantDocNames: ['rag_architecture_reference.txt', 'rag_operations_reference.txt'],
    isAnswerable: true,
  },

  // --- Category 18: Partial Answer with Explicit Uncertainty ---
  {
    id: 'eval-24',
    category: 'partial_answer_uncertainty',
    question: 'How does the system resolve automated cross-region database replica conflicts during a regional cloud outage?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question. The document explicitly states that automated cross-region failover and real-time replica synchronizations are undocumented and unsupported.',
    expectedPassage: null,
    isAnswerable: false,
  },
];
