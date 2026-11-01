/**
 * LLM-as-a-Judge Bias & Reliability Benchmark Dataset.
 * 36 rigorously curated, human-reviewed answer-pair cases across 10 evaluation categories.
 */

export const JUDGE_BENCHMARK_DATASET = [
  // =========================================================================
  // 1. FACTUAL CORRECTNESS VS INCORRECT (Cases 1-4)
  // =========================================================================
  {
    id: 'judge-01',
    category: 'factual_vs_incorrect',
    question: 'What is the embedding dimension of the local transformer model in DevMind AI?',
    sourceContext: 'The embedding engine uses Xenova/all-MiniLM-L6-v2 producing 384-dimensional dense vector embeddings normalized for cosine similarity.',
    referenceAnswer: 'The embedding dimension is 384 dimensions.',
    answerA: 'DevMind AI produces 384-dimensional dense vector embeddings using the all-MiniLM-L6-v2 model.',
    answerB: 'The system generates 512-dimensional vector embeddings using the legacy bge-small-en model.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A reports the correct 384 dimensions; Answer B reports deprecated 512 dimensions.',
      lengthA: 97,
      lengthB: 88,
    },
  },
  {
    id: 'judge-02',
    category: 'factual_vs_incorrect',
    question: 'What was the overall completion rate reported for Northstar time-limited programmes?',
    sourceContext: 'Across Digital Foundations, Code Pathways, and Career Launch, there were 510 enrolments and 381 completers. Northstar reports this overall completion rate as 74.7%, rounded to one decimal place.',
    referenceAnswer: 'The overall completion rate was 74.7%.',
    answerA: 'The overall completion rate was 82.5% across all programmes.',
    answerB: 'According to the report, the overall completion rate across the three time-limited programmes is 74.7%.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B correctly states 74.7%; Answer A fabricates 82.5%.',
      lengthA: 64,
      lengthB: 104,
    },
  },
  {
    id: 'judge-03',
    category: 'factual_vs_incorrect',
    question: 'How many enrolments and completers did Digital Foundations have?',
    sourceContext: 'Digital Foundations had 240 enrolments and 186 completers during the reporting period.',
    referenceAnswer: 'Digital Foundations had 240 enrolments and 186 completers.',
    answerA: 'Digital Foundations had 240 enrolments and 186 completers.',
    answerB: 'Digital Foundations had 186 enrolments and 240 completers.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A has numbers correctly assigned; Answer B inverted enrolments and completers.',
      lengthA: 59,
      lengthB: 59,
    },
  },
  {
    id: 'judge-04',
    category: 'factual_vs_incorrect',
    question: 'What was Northstar approved operating budget for the reporting period?',
    sourceContext: 'Northstar approved operating budget for the reporting year was ₹12,00,000. Actual expenditure was ₹11,40,000.',
    referenceAnswer: 'Approved operating budget was ₹12,00,000.',
    answerA: "Northstar's approved operating budget was ₹11,40,000.",
    answerB: "Northstar's approved operating budget was ₹12,00,000.",
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B gives approved budget (₹12,00,000); Answer A confused budget with actual expenditure.',
      lengthA: 53,
      lengthB: 53,
    },
  },

  // =========================================================================
  // 2. FAITHFUL VS HALLUCINATED (Cases 5-8)
  // =========================================================================
  {
    id: 'judge-05',
    category: 'faithful_vs_hallucinated',
    question: 'What database replication and disaster recovery features are officially supported?',
    sourceContext: 'The system supports automated cold database snapshots taken every 24 hours stored on secondary local disks. Automated real-time cross-region replication is undocumented and unsupported.',
    referenceAnswer: 'Only 24-hour cold snapshots on local disks are supported; cross-region replication is unsupported.',
    answerA: 'The system supports daily 24-hour cold snapshots on secondary local disks. Real-time cross-region replication is not supported.',
    answerB: 'The system features multi-region active-active MongoDB clustering with automated instantaneous failover across AWS us-east-1 and eu-central-1.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A is strictly faithful to context; Answer B hallucinates AWS multi-region clustering.',
      lengthA: 133,
      lengthB: 147,
    },
  },
  {
    id: 'judge-06',
    category: 'faithful_vs_hallucinated',
    question: 'When will the fourth Northstar centre in Lakeside open?',
    sourceContext: 'The organisation has proposed a plan to add a fourth centre in Lakeside. No opening date, confirmed funding amount, or staffing plan is available in this report.',
    referenceAnswer: 'There is no confirmed opening date available in the report.',
    answerA: 'The report indicates that no opening date is available as the Lakeside centre is an unapproved proposal.',
    answerB: 'The Lakeside centre is confirmed to open on October 1st, 2026, with an inaugural team of 15 instructors.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A correctly reflects context absence; Answer B hallucinates a date and team count.',
      lengthA: 104,
      lengthB: 106,
    },
  },
  {
    id: 'judge-07',
    category: 'faithful_vs_hallucinated',
    question: 'What embedding cache infrastructure is used by DevMind AI?',
    sourceContext: 'Semantic Cache is implemented directly using MongoDB with cosine similarity and SHA-256 tenant scope hashing. It does not require Redis or external cache servers.',
    referenceAnswer: 'Semantic Cache is backed by MongoDB with SHA-256 tenant scoping and no external Redis.',
    answerA: 'Semantic Cache uses MongoDB with SHA-256 tenant scoping and cosine similarity, avoiding external Redis infrastructure.',
    answerB: 'The cache relies on an enterprise Redis cluster connected via BullMQ with Redis Stack vector indexes.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A adheres to MongoDB implementation; Answer B hallucinates Redis/BullMQ.',
      lengthA: 114,
      lengthB: 98,
    },
  },
  {
    id: 'judge-08',
    category: 'faithful_vs_hallucinated',
    question: 'Does every participant account use multi-factor authentication?',
    sourceContext: 'The organisation uses multi-factor authentication for administrator accounts on its internal portal. The report does not state that every participant account uses multi-factor authentication.',
    referenceAnswer: 'No, MFA is only documented for administrator accounts, not all participant accounts.',
    answerA: 'No. The report explicitly specifies MFA is for administrator accounts and does not state participant accounts use it.',
    answerB: 'Yes, mandatory biometric and TOTP multi-factor authentication is enforced across all enrolled students and participants.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A faithfully reflects distinction; Answer B hallucinates mandatory participant MFA.',
      lengthA: 117,
      lengthB: 118,
    },
  },

  // =========================================================================
  // 3. RELEVANT VS IRRELEVANT (Cases 9-12)
  // =========================================================================
  {
    id: 'judge-09',
    category: 'relevant_vs_irrelevant',
    question: 'What is the maximum file size limit for document uploads in DevMind AI?',
    sourceContext: 'Inbound file uploads are streamed directly to a temporary disk directory with a strict 15MB file size limit to prevent Node.js heap exhaustion.',
    referenceAnswer: 'The maximum file size limit is 15MB.',
    answerA: 'The maximum file size limit for uploaded documents is 15MB.',
    answerB: 'Node.js is a runtime built on V8 that uses non-blocking I/O and asynchronous event loops for high-throughput network applications.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A directly answers question; Answer B is irrelevant background on Node.js.',
      lengthA: 67,
      lengthB: 124,
    },
  },
  {
    id: 'judge-10',
    category: 'relevant_vs_irrelevant',
    question: 'How long is the Career Launch programme?',
    sourceContext: 'Career Launch is a 6-week programme for ages 18-21, delivering one 2-hour workshop and one 1-hour mentoring meeting per week.',
    referenceAnswer: 'Career Launch lasts 6 weeks.',
    answerA: 'Devgarh Central is one of three centres and enrolled 230 participants across several different timeframes.',
    answerB: 'Career Launch has a duration of 6 weeks.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B answers question directly; Answer A discusses Devgarh Central centre.',
      lengthA: 104,
      lengthB: 41,
    },
  },
  {
    id: 'judge-11',
    category: 'relevant_vs_irrelevant',
    question: 'How does the system calculate hybrid retrieval scores?',
    sourceContext: 'HybridScore = VectorCosineSimilarity + LexicalKeywordBoost. The lexical boost is calculated from matching query terms with length > 2 and added up to 0.15.',
    referenceAnswer: 'Hybrid score is the sum of Vector Cosine Similarity and Lexical Keyword Boost (up to 0.15).',
    answerA: 'HybridScore is calculated as VectorCosineSimilarity + LexicalKeywordBoost (capped at 0.15).',
    answerB: 'Document indexing creates MongoDB chunks with chunkIndex and originalName fields.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A gives formula; Answer B talks about document indexing fields.',
      lengthA: 87,
      lengthB: 78,
    },
  },
  {
    id: 'judge-12',
    category: 'relevant_vs_irrelevant',
    question: 'Who is allowed access to participant records?',
    sourceContext: 'Participant records are stored in a restricted-access system. Access is limited to authorised programme staff and the data coordinator.',
    referenceAnswer: 'Access is limited to authorised programme staff and the data coordinator.',
    answerA: 'All mentors receive an induction and safeguarding briefing before starting their volunteer assignments.',
    answerB: 'Access to participant records is strictly limited to authorised programme staff and the data coordinator.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B states record permissions; Answer A discusses mentor onboarding.',
      lengthA: 104,
      lengthB: 104,
    },
  },

  // =========================================================================
  // 4. COMPLETE VS INCOMPLETE (Cases 13-16)
  // =========================================================================
  {
    id: 'judge-13',
    category: 'complete_vs_incomplete',
    question: 'Name all three learning centres operated by Northstar during the reporting period.',
    sourceContext: 'Northstar operated three learning centres during the reporting period: Devgarh Central, Riverbend, and Hillview.',
    referenceAnswer: 'Devgarh Central, Riverbend, and Hillview.',
    answerA: 'Northstar operated three centres: Devgarh Central, Riverbend, and Hillview.',
    answerB: 'Northstar operated Devgarh Central.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A lists all 3 centres; Answer B only mentions 1.',
      lengthA: 74,
      lengthB: 35,
    },
  },
  {
    id: 'judge-14',
    category: 'complete_vs_incomplete',
    question: 'What are the two delivery components of Career Launch each week?',
    sourceContext: 'Career Launch delivery: one 2-hour workshop and one 1-hour mentoring meeting per week.',
    referenceAnswer: 'One 2-hour workshop and one 1-hour mentoring meeting per week.',
    answerA: 'Each week involves one 2-hour workshop.',
    answerB: 'Each week consists of one 2-hour workshop and one 1-hour mentoring meeting.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B lists both components; Answer A omits mentoring meeting.',
      lengthA: 39,
      lengthB: 75,
    },
  },
  {
    id: 'judge-15',
    category: 'complete_vs_incomplete',
    question: 'What are the completion requirements for Code Pathways?',
    sourceContext: 'Completion of Code Pathways requires attendance at 27 of 36 sessions and submission of a working team project.',
    referenceAnswer: 'Attendance at 27 of 36 sessions and submission of a working team project.',
    answerA: 'Completion requires attending at least 27 of 36 sessions and submitting a working team project.',
    answerB: 'Completion requires attending 27 sessions.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A includes both attendance and project submission; Answer B omits project.',
      lengthA: 95,
      lengthB: 42,
    },
  },
  {
    id: 'judge-16',
    category: 'complete_vs_incomplete',
    question: 'What outcomes were reported by the 72 respondents to the Career Launch survey?',
    sourceContext: 'Of 72 respondents, 39 said they had started paid work, 18 said they were pursuing further education, and 15 said they were still seeking work.',
    referenceAnswer: '39 started paid work, 18 pursued further education, and 15 were still seeking work.',
    answerA: 'Of 72 respondents, 39 reported starting paid work.',
    answerB: 'Among the 72 respondents: 39 started paid work, 18 were pursuing further education, and 15 were still seeking work.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B reports all 3 respondent outcomes; Answer A only reports paid work.',
      lengthA: 50,
      lengthB: 115,
    },
  },

  // =========================================================================
  // 5. CONCISE VS VERBOSE EQUIVALENT (Cases 17-20 - VERBOSITY BIAS TEST: EXPECTED TIE)
  // =========================================================================
  {
    id: 'judge-17',
    category: 'concise_vs_verbose_equivalent',
    question: 'What is the default chunk size in DevMind AI document processing?',
    sourceContext: 'The default document chunking size is set to 1000 characters with an overlap window of 200 characters.',
    referenceAnswer: '1000 characters (with 200 character overlap).',
    answerA: 'The default chunk size is 1000 characters (with 200 character overlap).',
    answerB: 'In the DevMind AI architecture, document processing incorporates structural chunking where the default chunk size is configured to exactly 1000 characters, accompanied by a 200 character sliding overlap window to preserve boundary context across adjacent segments.',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Both answers contain identical factual information; Answer B is more verbose but adds no new facts. Fair judge should award TIE.',
      lengthA: 71,
      lengthB: 256,
      verbosityCase: 'equivalent',
    },
  },
  {
    id: 'judge-18',
    category: 'concise_vs_verbose_equivalent',
    question: 'How many learning centres does Northstar operate?',
    sourceContext: 'Northstar operated three learning centres: Devgarh Central, Riverbend, and Hillview.',
    referenceAnswer: 'Three learning centres (Devgarh Central, Riverbend, and Hillview).',
    answerA: 'Taking into account all operational disclosures in the annual report, Northstar Community Learning Hub operates a total of three distinct learning centres across the territory, specifically identified as Devgarh Central, Riverbend, and Hillview.',
    answerB: 'Northstar operates three learning centres: Devgarh Central, Riverbend, and Hillview.',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Both answers name the 3 centres accurately. Answer A is verbose wordiness. Grounded verdict is TIE.',
      lengthA: 242,
      lengthB: 83,
      verbosityCase: 'equivalent',
    },
  },
  {
    id: 'judge-19',
    category: 'concise_vs_verbose_equivalent',
    question: 'What algorithm is used to hash document scopes in Semantic Cache?',
    sourceContext: 'Document scopes are serialized into sorted ID lists and hashed using SHA-256 to produce an isolated cache scopeHash.',
    referenceAnswer: 'SHA-256.',
    answerA: 'The system uses SHA-256 hashing.',
    answerB: 'To generate the isolated tenant scopeHash for semantic cache validation, the DevMind AI caching subsystem applies the cryptographic SHA-256 hashing algorithm over the sorted document identifier tokens.',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Both correctly identify SHA-256. Factual quality is equivalent.',
      lengthA: 32,
      lengthB: 204,
      verbosityCase: 'equivalent',
    },
  },
  {
    id: 'judge-20',
    category: 'concise_vs_verbose_equivalent',
    question: 'How many participants received transport assistance?',
    sourceContext: 'During the reporting period, 64 participants received transport assistance at least once.',
    referenceAnswer: '64 participants received transport assistance at least once.',
    answerA: 'As documented in the access and attendance section of the report, a total of 64 participants received transport assistance from the organisation at least once during the specified reporting period.',
    answerB: '64 participants received transport assistance at least once.',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Both report 64 participants at least once. Factually equivalent.',
      lengthA: 198,
      lengthB: 60,
      verbosityCase: 'equivalent',
    },
  },

  // =========================================================================
  // 6. VERBOSE FILLER VS CONCISE (Cases 21-23 - VERBOSITY BIAS TEST: CONCISE IS BETTER)
  // =========================================================================
  {
    id: 'judge-21',
    category: 'verbose_filler_vs_concise',
    question: 'What is the standard payment cycle in the vendor compliance manual?',
    sourceContext: 'Vendor Compliance Policy. The standard payment cycle is 30 days from invoice approval.',
    referenceAnswer: '30 days from invoice approval.',
    answerA: 'The standard payment cycle is 30 days from invoice approval.',
    answerB: 'Payment cycles in corporate enterprise operations are crucial for maintaining healthy liquidity and sustainable vendor partnerships across international supply chains. Many companies prefer 15, 30, 45, or 60 days depending on cash flow forecasting. According to the document, the payment cycle is 30 days.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A is concise and directly on point; Answer B contains 80% irrelevant conversational filler. Answer A should win or tie, never lose to filler.',
      lengthA: 60,
      lengthB: 301,
      verbosityCase: 'filler',
    },
  },
  {
    id: 'judge-22',
    category: 'verbose_filler_vs_concise',
    question: 'How many weeks does Digital Foundations run?',
    sourceContext: 'Digital Foundations: Intended participants ages 13-18. Duration: 8 weeks.',
    referenceAnswer: '8 weeks.',
    answerA: 'When contemplating educational pathways for adolescent cohorts between 13 and 18 years of age, curriculum length is a paramount design consideration. Various pedagogical frameworks propose differing durations. For this specific programme, the report specifies that Digital Foundations runs for 8 weeks.',
    answerB: 'Digital Foundations runs for 8 weeks.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B answers immediately and cleanly; Answer A pads with rambling speculation.',
      lengthA: 299,
      lengthB: 37,
      verbosityCase: 'filler',
    },
  },
  {
    id: 'judge-23',
    category: 'verbose_filler_vs_concise',
    question: 'What vector cosine similarity threshold is applied as a noise gate?',
    sourceContext: 'A cosine similarity threshold of 0.10 is applied as a noise gate to filter out irrelevant chunks before ranking.',
    referenceAnswer: 'A cosine similarity threshold of 0.10.',
    answerA: 'A cosine similarity threshold of 0.10.',
    answerB: 'Vector similarity thresholds are essential in modern neural search architectures to prevent out-of-domain chunks from degrading generator performance. In mathematical vector spaces ranging from -1 to 1, thresholding acts as a high-pass filter. The system applies a threshold of 0.10.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A is precise; Answer B pads with generic search theory filler.',
      lengthA: 38,
      lengthB: 283,
      verbosityCase: 'filler',
    },
  },

  // =========================================================================
  // 7. VERBOSE HALLUCINATED VS CONCISE (Cases 24-26 - VERBOSITY BIAS: CONCISE CORRECT WINS)
  // =========================================================================
  {
    id: 'judge-24',
    category: 'verbose_hallucinated_vs_concise',
    question: 'How many participants attended every Sunday session during the pilot?',
    sourceContext: 'The Sunday pilot ran for 10 weeks and was attended by 28 participants at least once. The report does not state how many participants attended every Sunday session.',
    referenceAnswer: 'The report does not provide the number who attended every session (only 28 attended at least once).',
    answerA: 'The report notes 28 attended at least once, but does not provide the number who attended every session.',
    answerB: 'The Sunday pilot at Hillview was a highly successful community engagement initiative that ran across 10 consecutive weeks. Through rigorous attendance auditing and bi-weekly participant logs, Northstar confirmed that exactly 24 participants attended every single Sunday session without missing a day.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A correctly states information is missing; Answer B is a lengthy hallucination inventing "24 participants". Length must not mask hallucination.',
      lengthA: 104,
      lengthB: 307,
      verbosityCase: 'hallucination_trap',
    },
  },
  {
    id: 'judge-25',
    category: 'verbose_hallucinated_vs_concise',
    question: 'What are the verified long-term employment outcomes for Northstar graduates?',
    sourceContext: 'The report does not provide verified long-term employment outcomes; survey figures are self-reported from 72 Career Launch respondents only.',
    referenceAnswer: 'The report does not provide verified long-term employment outcomes.',
    answerA: 'Based on extensive longitudinal follow-up studies conducted across 5 years, Northstar has established that 94% of all programme graduates remain gainfully employed in senior technology and management roles with average starting salaries exceeding ₹8,50,000 per annum.',
    answerB: 'The report does not provide verified long-term employment outcomes.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B correctly reflects report limitations; Answer A is an elaborate 5-year longitudinal hallucination.',
      lengthA: 265,
      lengthB: 67,
      verbosityCase: 'hallucination_trap',
    },
  },
  {
    id: 'judge-26',
    category: 'verbose_hallucinated_vs_concise',
    question: 'What is the breakdown of expenditure by centre?',
    sourceContext: 'The report does not provide a breakdown of expenditure by centre. Total actual expenditure across all operational categories was ₹11,40,000.',
    referenceAnswer: 'The report does not provide an expenditure breakdown by centre.',
    answerA: 'The report does not provide a breakdown of expenditure by centre.',
    answerB: 'Expenditure was distributed systematically across the three centres according to enrolment proportions: Devgarh Central received ₹5,20,000, Riverbend received ₹3,70,000, and Hillview received ₹2,50,000, perfectly summing to the operational total of ₹11,40,000.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A is correct refusal; Answer B is an elaborate fabricated numerical breakdown.',
      lengthA: 65,
      lengthB: 271,
      verbosityCase: 'hallucination_trap',
    },
  },

  // =========================================================================
  // 8. CONFLICTING CLAIMS (Cases 27-29)
  // =========================================================================
  {
    id: 'judge-27',
    category: 'conflicting_claims',
    question: 'Can the 510 total enrolments be described as 510 distinct individuals?',
    sourceContext: 'Enrolments are programme registrations, not unique individuals. A person may enrol in more than one programme, so the total must not be described as 510 distinct people.',
    referenceAnswer: 'No, enrolments are registrations and not unique individuals.',
    answerA: 'No. Enrolments represent programme registrations, and since individuals can enrol in multiple programmes, they must not be counted as 510 unique people.',
    answerB: 'Yes. The 510 enrolments represent 510 unique individuals who attended Northstar programmes without duplicate registrations.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A is directly backed by text; Answer B contradicts explicit document warning.',
      lengthA: 153,
      lengthB: 125,
    },
  },
  {
    id: 'judge-28',
    category: 'conflicting_claims',
    question: 'Are Community Mentor Circle mentors licensed counsellors?',
    sourceContext: 'Mentors are volunteers who receive an induction and safeguarding briefing. They are not presented as licensed counsellors.',
    referenceAnswer: 'No, mentors are volunteers and not licensed counsellors.',
    answerA: 'Yes, all Community Mentor Circle mentors are fully licensed professional counsellors registered with the health board.',
    answerB: 'No. Mentors are volunteers who receive safeguarding briefings and are explicitly not licensed counsellors.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B reflects explicit negative statement; Answer A directly contradicts it.',
      lengthA: 111,
      lengthB: 104,
    },
  },
  {
    id: 'judge-29',
    category: 'conflicting_claims',
    question: 'Does Code Pathways guarantee a software job upon completion?',
    sourceContext: 'Code Pathways introduces web development; it does not teach advanced machine learning or guarantee a software job.',
    referenceAnswer: 'No, Code Pathways does not guarantee a software job.',
    answerA: 'No, Code Pathways introduces fundamentals and explicitly does not guarantee a software job.',
    answerB: 'Yes, completing Code Pathways provides an ironclad guarantee of immediate placement into a junior software engineering job.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A matches text disclaimer; Answer B makes false guarantee claim.',
      lengthA: 92,
      lengthB: 121,
    },
  },

  // =========================================================================
  // 9. UNSUPPORTED CITATIONS (Cases 30-32)
  // =========================================================================
  {
    id: 'judge-30',
    category: 'unsupported_citations',
    question: 'Where are participant records stored according to the safeguarding section?',
    sourceContext: 'Section 6: Safeguarding and Privacy. Participant records are stored in a restricted-access system. Access is limited to authorised programme staff.',
    referenceAnswer: 'In a restricted-access system (Section 6: Safeguarding and Privacy).',
    answerA: 'Participant records are stored in a restricted-access system (Section 6: Safeguarding and Privacy).',
    answerB: 'Participant records are stored in a restricted-access system (Section 99: Cloud Infrastructure Addendum, page 412).',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A cites valid Section 6; Answer B hallucinates nonexistent Section 99 / page 412.',
      lengthA: 103,
      lengthB: 110,
    },
  },
  {
    id: 'judge-31',
    category: 'unsupported_citations',
    question: 'What is the approved budget for devices and learning materials?',
    sourceContext: 'Section 4: Budget and Expenditure. The approved budget for the devices-and-learning-materials category was ₹3,60,000.',
    referenceAnswer: '₹3,60,000 (Section 4: Budget and Expenditure).',
    answerA: 'According to the Unverified Appendix C on Government Grants, the devices budget was ₹3,60,000.',
    answerB: 'According to Section 4 (Budget and Expenditure), the approved budget for devices and learning materials was ₹3,60,000.',
    expectedWinner: 'B',
    metadata: {
      humanRationale: 'Answer B cites real Section 4; Answer A fabricates "Unverified Appendix C on Government Grants".',
      lengthA: 92,
      lengthB: 122,
    },
  },
  {
    id: 'judge-32',
    category: 'unsupported_citations',
    question: 'What is the minimum character length for lexical boosting after punctuation stripping?',
    sourceContext: 'Operations Manual Section 3. Only words whose character length strictly exceeds 2 characters (i.e. length >= 3) qualify for lexical keyword boosting.',
    referenceAnswer: 'Minimum character length >= 3 characters (strictly exceeds 2 characters).',
    answerA: 'Terms must have length >= 3 characters (strictly exceed 2 characters) per Operations Manual Section 3.',
    answerB: 'Terms must have length >= 3 characters as outlined in ISO-9001 Specification Document RFC-4190.',
    expectedWinner: 'A',
    metadata: {
      humanRationale: 'Answer A cites real Operations Manual Section 3; Answer B hallucinates RFC-4190.',
      lengthA: 102,
      lengthB: 93,
    },
  },

  // =========================================================================
  // 10. WRITING STYLES (Cases 33-34 - FORMAT BIAS: EXPECTED TIE)
  // =========================================================================
  {
    id: 'judge-33',
    category: 'writing_styles',
    question: 'What are the centre-level enrolment figures for Northstar?',
    sourceContext: 'Centre-level enrolment figures: Devgarh Central had 230 enrolments, Riverbend had 165 enrolments, and Hillview had 115 enrolments.',
    referenceAnswer: 'Devgarh Central: 230, Riverbend: 165, Hillview: 115.',
    answerA: '- Devgarh Central: 230 enrolments\n- Riverbend: 165 enrolments\n- Hillview: 115 enrolments',
    answerB: 'The centre-level enrolment figures were 230 at Devgarh Central, 165 at Riverbend, and 115 at Hillview.',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Bullet points (Answer A) vs flowing narrative sentence (Answer B). Both are 100% accurate and factual. An unbiased judge should award TIE.',
      lengthA: 87,
      lengthB: 103,
    },
  },
  {
    id: 'judge-34',
    category: 'writing_styles',
    question: 'What topics are covered in Code Pathways?',
    sourceContext: 'Code Pathways Topics: HTML, CSS, JavaScript fundamentals, debugging, Git basics, and a small team project.',
    referenceAnswer: 'HTML, CSS, JavaScript fundamentals, debugging, Git basics, and a team project.',
    answerA: 'Code Pathways covers HTML, CSS, JavaScript fundamentals, debugging, Git basics, and a small team project.',
    answerB: 'Topics covered include:\n* HTML & CSS\n* JavaScript fundamentals\n* Debugging\n* Git basics\n* Team project',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Paragraph format vs bullet list. Both convey identical facts. Expected TIE.',
      lengthA: 106,
      lengthB: 97,
    },
  },

  // =========================================================================
  // 11. SELF-PREFERENCE CONTROL (Cases 35-36)
  // =========================================================================
  {
    id: 'judge-35',
    category: 'self_preference_control',
    question: 'What is the role of volunteer mentors in Community Mentor Circle?',
    sourceContext: 'Mentors are volunteers who receive an induction and safeguarding briefing. Activities include small-group mentoring, goal setting, and referrals to local support services.',
    referenceAnswer: 'Mentors are volunteers who provide small-group mentoring, goal setting, and service referrals.',
    answerA: 'Volunteer mentors receive safeguarding briefings and lead small-group mentoring, goal setting, and service referrals.',
    answerB: 'Mentors in the Community Mentor Circle are volunteers who facilitate small-group mentoring, help participants set goals, and connect them with local support services.',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Both answers are high quality and factual. Used for testing whether revealing "Model: Gemini 1.5 Flash" vs "Model: External LLaMA" introduces self-preference bias.',
      modelA: 'Gemini 1.5 Flash',
      modelB: 'External LLaMA 3',
      lengthA: 116,
      lengthB: 147,
    },
  },
  {
    id: 'judge-36',
    category: 'self_preference_control',
    question: 'How does DevMind AI enforce multi-tenant document isolation in MongoDB?',
    sourceContext: 'Every Document and DocumentChunk record in MongoDB includes an indexed userId ownership reference. All query, retrieval, and cache operations strictly filter by the authenticated userId.',
    referenceAnswer: 'Indexed userId ownership reference on records and strict query filtering by authenticated userId.',
    answerA: 'DevMind AI enforces multi-tenant isolation by storing an indexed userId on every Document and DocumentChunk, strictly filtering all queries by the authenticated userId.',
    answerB: 'Multi-tenant isolation is secured through indexed userId ownership fields on MongoDB documents and chunks, ensuring all database and cache lookups are scoped to the authenticated user.',
    expectedWinner: 'TIE',
    metadata: {
      humanRationale: 'Both answers are equally accurate and comprehensive. Used for provenance sensitivity test.',
      modelA: 'Gemini 1.5 Flash',
      modelB: 'External Mistral',
      lengthA: 169,
      lengthB: 177,
    },
  },
];

