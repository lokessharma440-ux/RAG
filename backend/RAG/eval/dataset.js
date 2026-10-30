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

export const EVAL_DOCUMENT_NORTHSTAR = {
  id: 'doc-eval-northstar-report-2026',
  originalName: 'Northstar_Community_Learning_Hub_Report.txt',
  fileType: 'txt',
  text: `NORTHSTAR COMMUNITY LEARNING HUB
Operations and Impact Report
Reporting period: 1 April 2025 – 31 March 2026
Document version: 1.2
Prepared by: Northstar Programme Office

1. ORGANISATION OVERVIEW
Northstar Community Learning Hub (NCLH) is a nonprofit organisation that provides after-school learning support, digital-literacy workshops, and career-readiness activities for young people aged 13–21. Its main centre is in Devgarh. During the reporting period, Northstar operated three learning centres: Devgarh Central, Riverbend, and Hillview.

Northstar's mission is to help young people build practical skills through accessible, community-based learning. Its programmes are not formal school qualifications, and completion of a Northstar course does not guarantee admission to a college, a job, or a professional certification.

2. PROGRAMMES
Northstar ran four core programmes during the reporting period.

A. Digital Foundations
- Intended participants: ages 13–18.
- Duration: 8 weeks.
- Topics: file management, online safety, email, document editing, and introductory spreadsheets.
- Delivery: two 90-minute sessions per week.
- A participant is counted as a programme completer after attending at least 12 of the 16 sessions and submitting the final practical task.
- The programme had 240 enrolments and 186 completers.

B. Code Pathways
- Intended participants: ages 16–21.
- Duration: 12 weeks.
- Topics: HTML, CSS, JavaScript fundamentals, debugging, Git basics, and a small team project.
- Delivery: three 2-hour sessions per week.
- Completion requires attendance at 27 of 36 sessions and submission of a working team project.
- The programme had 150 enrolments and 105 completers.
- Code Pathways introduces web development; it does not teach advanced machine learning or guarantee a software job.

C. Career Launch
- Intended participants: ages 18–21.
- Duration: 6 weeks.
- Topics: CV preparation, interview practice, workplace communication, and job-search planning.
- Delivery: one 2-hour workshop and one 1-hour mentoring meeting per week.
- Completion requires attending at least five workshops and completing a mock interview.
- The programme had 120 enrolments and 90 completers.

D. Community Mentor Circle
- Intended participants: ages 13–21.
- Duration: ongoing, with a quarterly review.
- Activities: small-group mentoring, goal setting, and referrals to local support services.
- Mentors are volunteers who receive an induction and safeguarding briefing. They are not presented as licensed counsellors.
- The programme had 80 active participants at the end of the reporting period. Because participation is ongoing, Northstar does not report a comparable “completion” count for this programme.

3. PARTICIPATION AND OUTCOMES
Across the three time-limited programmes—Digital Foundations, Code Pathways, and Career Launch—there were 510 enrolments in total and 381 programme completers in total. Enrolments are programme registrations, not unique individuals. A person may enrol in more than one programme, so the total must not be described as 510 distinct people.

The overall completion rate for those three time-limited programmes is calculated as total completers divided by total enrolments. Northstar reports this as 74.7%, rounded to one decimal place.

Centre-level enrolment figures:
- Devgarh Central: 230 enrolments.
- Riverbend: 165 enrolments.
- Hillview: 115 enrolments.
These centre figures sum to the same 510 programme enrolments. They do not indicate how many unique individuals attended each centre.

A follow-up survey was sent to 120 Career Launch completers three months after the programme ended. Seventy-two people responded. Of those respondents, 39 said they had started paid work, 18 said they were pursuing further education, and 15 said they were still seeking work. These are self-reported responses from the 72 respondents only; Northstar has not verified employment status, and the results should not be generalised to all 120 completers without qualification.

4. BUDGET AND EXPENDITURE
Northstar's approved operating budget for the reporting year was ₹12,00,000.
Actual expenditure across all operational categories was ₹11,40,000.
The approved budget for the devices-and-learning-materials category was ₹3,60,000. The report does not provide a separate approved budget for each of the other categories.

5. ACCESS AND ATTENDANCE
Northstar offered transport assistance to participants who reported that travel costs were a barrier. During the reporting period, 64 participants received transport assistance at least once. This is a count of recipients, not the number of trips or the total number of transport requests.

All three centres offered at least one evening session per week. Hillview was the only centre that also piloted a Sunday session. The Sunday pilot ran for 10 weeks and was attended by 28 participants at least once. The report does not state how many participants attended every Sunday session.

6. SAFEGUARDING, PRIVACY, AND SECURITY
Participant records are stored in a restricted-access system. Access is limited to authorised programme staff and the data coordinator.
The organisation uses multi-factor authentication for administrator accounts on its internal portal. The report does not state that every participant account uses multi-factor authentication.

8. LIMITATIONS AND NEXT STEPS
The organisation has proposed, but not yet approved, a plan to add a fourth centre in Lakeside. No opening date, confirmed funding amount, or staffing plan is available in this report.

The report does not provide:
- the number of unique individuals served across all programmes;
- verified long-term employment outcomes;
- a breakdown of expenditure by centre;
- a confirmed date for a Lakeside centre opening;
- the number of portal users;
- the number of participants who attended every Sunday pilot session.
END OF REPORT`,
};

export const EVAL_DOCUMENTS = [EVAL_DOCUMENT, EVAL_DOCUMENT_2, EVAL_DOCUMENT_NORTHSTAR];

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

  // =========================================================================
  // --- Categories A-F: Northstar Retrieval, Reasoning & Limitations (36 Cases) ---
  // =========================================================================

  // --- Category A: Direct Retrieval ---
  {
    id: 'eval-25',
    category: 'direct_retrieval_northstar',
    question: 'Identify the three learning centres operated by Northstar during the reporting period.',
    expectedAnswer: 'Devgarh Central, Riverbend, and Hillview.',
    expectedPassage: 'Northstar operated three learning centres: Devgarh Central, Riverbend, and Hillview',
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },
  {
    id: 'eval-26',
    category: 'direct_retrieval_northstar',
    question: 'What is the duration in weeks of Digital Foundations?',
    expectedAnswer: '8 weeks.',
    expectedPassage: 'Duration: 8 weeks',
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },

  // --- Category B: Numerical Retrieval ---
  {
    id: 'eval-27',
    category: 'numerical_retrieval_northstar',
    question: 'Find the enrolments and completers for each of the three time-limited programmes in the Northstar report.',
    expectedAnswer: 'Digital Foundations had 240 enrolments and 186 completers; Code Pathways had 150 enrolments and 105 completers; Career Launch had 120 enrolments and 90 completers.',
    expectedPassages: [
      '240 enrolments and 186 completers',
      '150 enrolments and 105 completers',
      '120 enrolments and 90 completers',
    ],
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },
  {
    id: 'eval-28',
    category: 'numerical_retrieval_northstar',
    question: "What was Northstar's approved operating budget for the reporting year, and how much was allocated for devices and learning materials?",
    expectedAnswer: "Approved operating budget was ₹12,00,000, with ₹3,60,000 allocated for devices and learning materials.",
    expectedPassage: 'approved operating budget for the reporting year was ₹12,00,000',
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },

  // --- Category C: Multi-Hop Reasoning ---
  {
    id: 'eval-29',
    category: 'multihop_reasoning_northstar',
    question: "Among the three time-limited programmes, which programme had the highest completion rate? Calculate its completion rate to one decimal place. Then compare it with Northstar's overall completion rate of 74.7% and state the difference in percentage points. Use only the figures provided in the report.",
    expectedAnswer: 'Digital Foundations had the highest completion rate at 77.5% (186/240). The difference compared to the overall rate of 74.7% is 2.8 percentage points (77.5% - 74.7%).',
    expectedPassages: [
      '240 enrolments and 186 completers',
      '150 enrolments and 105 completers',
      '120 enrolments and 90 completers',
      'overall completion rate for those three time-limited programmes is calculated as total completers divided by total enrolments. Northstar reports this as 74.7%',
    ],
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },
  {
    id: 'eval-30',
    category: 'multihop_reasoning_northstar',
    question: 'Calculate the percentage of Career Launch follow-up survey respondents who reported that they had started paid work.',
    expectedAnswer: '39 out of 72 respondents reported paid work, which is 54.2% (or 39/72).',
    expectedPassage: 'Seventy-two people responded. Of those respondents, 39 said they had started paid work',
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },

  // --- Category D: Missing Information ---
  {
    id: 'eval-31',
    category: 'missing_info_northstar',
    question: 'How many unique individuals did Northstar serve across all programmes during the reporting period?',
    expectedAnswer: 'The report explicitly states that it does not provide the number of unique individuals served across all programmes; 510 enrolments are programme registrations, not distinct individuals.',
    expectedPassage: null,
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: false,
  },
  {
    id: 'eval-32',
    category: 'missing_info_northstar',
    question: 'How many participants attended every Sunday session during the pilot?',
    expectedAnswer: 'The report does not provide the number of participants who attended every Sunday pilot session; it only notes that 28 participants attended at least once.',
    expectedPassage: null,
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: false,
  },
  {
    id: 'eval-33',
    category: 'missing_info_northstar',
    question: 'What is the confirmed opening date for the Lakeside centre?',
    expectedAnswer: 'The provided documents do not contain enough information to answer this question. The Lakeside centre is a proposed, unapproved plan with no confirmed opening date.',
    expectedPassage: null,
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: false,
  },

  // --- Category E: Distinctions and Limitations ---
  {
    id: 'eval-34',
    category: 'distinctions_northstar',
    question: 'Why are the 510 total enrolments not equivalent to 510 unique individuals served by Northstar?',
    expectedAnswer: 'Enrolments are programme registrations, not unique individuals. A single person may enrol in more than one programme.',
    expectedPassage: 'Enrolments are programme registrations, not unique individuals. A person may enrol in more than one programme',
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },
  {
    id: 'eval-35',
    category: 'distinctions_northstar',
    question: "Does Northstar's use of administrator multi-factor authentication establish that all participant accounts use MFA?",
    expectedAnswer: 'No, the report explicitly states that it does not state that every participant account uses multi-factor authentication; MFA is used for administrator accounts on the internal portal.',
    expectedPassage: 'The report does not state that every participant account uses multi-factor authentication',
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },

  // --- Category F: Distractor Resistance ---
  {
    id: 'eval-36',
    category: 'distractor_resistance_northstar',
    question: 'What was the completion rate of the Career Launch programme, and why should it not be confused with the follow-up survey employment rate?',
    expectedAnswer: 'Career Launch completion rate was 75.0% (90 completers / 120 enrolments). The follow-up survey was sent to 120 completers with 72 responding (39 in paid work, or 54.2%), which reflects unverified self-reported post-programme survey outcomes, not course completion.',
    expectedPassage: '120 enrolments and 90 completers',
    relevantDocName: 'Northstar_Community_Learning_Hub_Report.txt',
    isAnswerable: true,
  },
];
