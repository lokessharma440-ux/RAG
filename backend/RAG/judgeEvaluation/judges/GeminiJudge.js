import { BaseJudge } from './BaseJudge.js';
import { getLLMProvider } from '../../providers/index.js';
import {
  PAIRWISE_JUDGE_SYSTEM_PROMPT,
  INDEPENDENT_JUDGE_SYSTEM_PROMPT,
  buildPairwiseUserPrompt,
  buildIndependentUserPrompt,
} from './judgePrompts.js';
import {
  parsePairwiseJudgeResponse,
  extractJsonString,
  normalizeRubricScores,
  clampScore,
} from '../utils/jsonParser.js';

export class GeminiJudge extends BaseJudge {
  constructor(config = {}) {
    super('gemini-judge', config);
    this.provider = config.provider || getLLMProvider('gemini', config);
    this.temperature = config.temperature ?? 0.0;
    this.maxRetries = config.maxRetries ?? 2;
  }

  /**
   * Executes pairwise answer evaluation via Gemini.
   */
  async evaluatePair(item, options = {}) {
    const startTime = Date.now();
    const userPrompt = buildPairwiseUserPrompt({
      question: item.question,
      context: item.sourceContext,
      referenceAnswer: item.referenceAnswer,
      answerA: options.answerA || item.answerA,
      answerB: options.answerB || item.answerB,
      options,
    });

    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        let rawResponse = '';
        if (typeof this.provider.callWithTimeout === 'function' && typeof this.provider.getClient === 'function') {
          const ai = this.provider.getClient();
          const modelName = options.model || this.provider.candidateModels?.[0] || 'gemini-1.5-flash';
          const res = await this.provider.callWithTimeout(
            ai,
            modelName,
            userPrompt,
            {
              systemInstruction: PAIRWISE_JUDGE_SYSTEM_PROMPT,
              temperature: this.temperature,
              maxOutputTokens: 600,
            }
          );
          rawResponse = res?.text || '';
        } else {
          rawResponse = await this.provider.generateDirectText(
            `${PAIRWISE_JUDGE_SYSTEM_PROMPT}\n\n${userPrompt}`,
            { temperature: this.temperature }
          );
        }

        const parsed = parsePairwiseJudgeResponse(rawResponse);
        if (parsed.success) {
          return {
            ...parsed.data,
            rawResponse,
            durationMs: Date.now() - startTime,
            attempts: attempt,
          };
        } else {
          lastError = new Error(parsed.error);
        }
      } catch (err) {
        lastError = err;
        // Handle 429 rate limit backoff
        if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          const retryMatch = err.message.match(/retry in ([\d\.]+)s/i) || err.message.match(/retryDelay":"(\d+)s"/i);
          const waitSec = retryMatch ? Math.min(30, Math.ceil(parseFloat(retryMatch[1]))) : 4;
          console.warn(`  ⚠️ [GEMINI RATE LIMIT] 429 quota reached. Backing off for ${waitSec}s...`);
          await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
        }
      }
    }

    throw new Error(`GeminiJudge failed pairwise evaluation after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Executes independent pointwise evaluation via Gemini.
   */
  async evaluateIndependent(item, answer, options = {}) {
    const startTime = Date.now();
    const userPrompt = buildIndependentUserPrompt({
      question: item.question,
      context: item.sourceContext,
      referenceAnswer: item.referenceAnswer,
      answer,
    });

    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        let rawResponse = '';
        if (typeof this.provider.callWithTimeout === 'function' && typeof this.provider.getClient === 'function') {
          const ai = this.provider.getClient();
          const modelName = options.model || this.provider.candidateModels?.[0] || 'gemini-1.5-flash';
          const res = await this.provider.callWithTimeout(
            ai,
            modelName,
            userPrompt,
            {
              systemInstruction: INDEPENDENT_JUDGE_SYSTEM_PROMPT,
              temperature: this.temperature,
              maxOutputTokens: 400,
            }
          );
          rawResponse = res?.text || '';
        } else {
          rawResponse = await this.provider.generateDirectText(
            `${INDEPENDENT_JUDGE_SYSTEM_PROMPT}\n\n${userPrompt}`,
            { temperature: this.temperature }
          );
        }

        const jsonStr = extractJsonString(rawResponse);
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          const scores = normalizeRubricScores(parsed.scores || parsed);
          return {
            scores,
            overallScore: scores.overallScore,
            explanation: parsed.explanation || '',
            confidence: clampScore(parsed.confidence, 0.9),
            durationMs: Date.now() - startTime,
          };
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`GeminiJudge failed independent evaluation: ${lastError?.message}`);
  }
}
