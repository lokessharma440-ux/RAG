import { BaseJudge } from './BaseJudge.js';
import { normalizeRubricScores } from '../utils/jsonParser.js';

/**
 * Deterministic Mock Judge for zero-cost testing, CI reproducibility,
 * and multi-judge agreement baseline.
 */
export class MockJudge extends BaseJudge {
  constructor(config = {}) {
    super('mock-judge', config);
    // Configurable bias injection to simulate position bias or verbosity bias for unit test assertions
    this.simulatedPositionBias = config.simulatedPositionBias || false; // If true, artificially gives +0.3 to Position 1
    this.simulatedVerbosityBias = config.simulatedVerbosityBias || false; // If true, artificially gives +0.4 to longer answers
  }

  /**
   * Evaluates single answer deterministically against context and reference.
   */
  scoreAnswer(answer, context, reference, question) {
    const ansLower = (answer || '').toLowerCase();
    const ctxLower = (context || '').toLowerCase();
    const refLower = (reference || '').toLowerCase();
    const qLower = (question || '').toLowerCase();

    // 1. Factual Correctness
    let factual = 4.5;
    // Check if reference numbers are present
    const refNumbers = (reference || '').match(/\b\d+(?:\.\d+)?%?/g) || [];
    if (refNumbers.length > 0) {
      const matchedNums = refNumbers.filter((n) => answer.includes(n));
      factual = (matchedNums.length / refNumbers.length) * 5.0;
    }
    // Check known false claims / errors
    const errorKeywords = ['unlimited', '500mb', '100%', '512 dimensions', 'incorrect', 'false', 'deprecated v1 standard'];
    if (errorKeywords.some((kw) => ansLower.includes(kw) && !refLower.includes(kw))) {
      factual = Math.min(factual, 1.5);
    }

    // 2. Faithfulness (Grounding in source context)
    const ansTokens = ansLower.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    const groundedTokens = ansTokens.filter((t) => ctxLower.includes(t));
    const faithfulness = ansTokens.length > 0 ? (groundedTokens.length / ansTokens.length) * 5.0 : 4.0;

    // 3. Relevance
    const qTokens = qLower.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    const relevantTokens = qTokens.filter((t) => ansLower.includes(t));
    const relevance = qTokens.length > 0 ? Math.min(5.0, (relevantTokens.length / qTokens.length) * 5.0 + 1.0) : 4.5;

    // 4. Completeness
    const completeness = Math.min(5.0, (factual + relevance) / 2);

    // 5. Citation Correctness
    let citation = 4.5;
    if (ansLower.includes('section 99') || ansLower.includes('unverified appendix')) {
      citation = 1.0;
    }

    return normalizeRubricScores({
      factualCorrectness: factual,
      faithfulness,
      relevance,
      completeness,
      citationCorrectness: citation,
    });
  }

  async evaluatePair(item, options = {}) {
    const startTime = Date.now();
    const ansA = options.answerA || item.answerA;
    const ansB = options.answerB || item.answerB;

    let scoresA = this.scoreAnswer(ansA, item.sourceContext, item.referenceAnswer, item.question);
    let scoresB = this.scoreAnswer(ansB, item.sourceContext, item.referenceAnswer, item.question);

    // Optional simulated position bias
    if (this.simulatedPositionBias) {
      scoresA.overallScore = Math.min(5.0, scoresA.overallScore + 0.35);
    }

    // Optional simulated verbosity bias
    if (this.simulatedVerbosityBias) {
      if (ansA.length > ansB.length * 1.5) scoresA.overallScore = Math.min(5.0, scoresA.overallScore + 0.4);
      if (ansB.length > ansA.length * 1.5) scoresB.overallScore = Math.min(5.0, scoresB.overallScore + 0.4);
    }

    let winner = 'TIE';
    const delta = scoresA.overallScore - scoresB.overallScore;
    if (delta > 0.25) {
      winner = 'A';
    } else if (delta < -0.25) {
      winner = 'B';
    } else {
      winner = 'TIE';
    }

    const explanation = winner === 'TIE'
      ? 'Both candidate answers provide equivalent factual fidelity and relevance.'
      : `Answer ${winner} achieved higher factual correctness and faithfulness to source context.`;

    return {
      winner,
      scoresA,
      scoresB,
      explanation,
      contextReferences: [item.sourceContext.slice(0, 80) + '...'],
      confidence: 0.90,
      durationMs: Date.now() - startTime,
    };
  }

  async evaluateIndependent(item, answer, options = {}) {
    const startTime = Date.now();
    const scores = this.scoreAnswer(answer, item.sourceContext, item.referenceAnswer, item.question);
    return {
      scores,
      overallScore: scores.overallScore,
      explanation: 'Deterministic scoring based on lexical support and factual precision.',
      confidence: 0.90,
      durationMs: Date.now() - startTime,
    };
  }
}

