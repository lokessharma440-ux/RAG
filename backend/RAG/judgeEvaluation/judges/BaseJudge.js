/**
 * Base Judge Class.
 * Defines the contract and common lifecycle for LLM-as-a-Judge evaluators.
 */

export class BaseJudge {
  constructor(name = 'base-judge', config = {}) {
    this.name = name;
    this.config = config;
  }

  /**
   * Evaluates a pair of candidate answers (A vs B).
   *
   * @param {Object} item - Evaluation dataset item
   * @param {Object} [options={}]
   * @returns {Promise<{
   *   winner: 'A' | 'B' | 'TIE',
   *   scoresA: Object,
   *   scoresB: Object,
   *   explanation: string,
   *   contextReferences: Array<string>,
   *   confidence: number,
   *   durationMs: number
   * }>}
   */
  async evaluatePair(item, options = {}) {
    throw new Error('evaluatePair must be implemented by concrete Judge subclass.');
  }

  /**
   * Evaluates a single candidate answer independently.
   *
   * @param {Object} item
   * @param {string} answer - Answer string to evaluate
   * @param {Object} [options={}]
   * @returns {Promise<{
   *   scores: Object,
   *   overallScore: number,
   *   explanation: string,
   *   confidence: number
   * }>}
   */
  async evaluateIndependent(item, answer, options = {}) {
    throw new Error('evaluateIndependent must be implemented by concrete Judge subclass.');
  }
}

