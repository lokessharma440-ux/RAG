import { BaseLLMProvider } from './BaseLLMProvider.js';

export class MockLLMProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super({ name: 'mock', ...config });
    this.callHistory = [];
    this.mockResponses = new Map(); // question -> answer mapping
    this.failureQueue = []; // Queue of simulated errors to throw
  }

  /**
   * Registers a deterministic answer for a specific question.
   */
  registerResponse(question, answer) {
    this.mockResponses.set(question.trim().toLowerCase(), answer);
  }

  /**
   * Enqueues an error to simulate transient or permanent failures.
   */
  enqueueError(error) {
    this.failureQueue.push(error);
  }

  /**
   * Generates answer deterministically from context or registered responses.
   */
  async generateAnswer(question, relevantChunks = [], options = {}) {
    const trimmed = (question || '').trim();
    this.callHistory.push({
      question: trimmed,
      chunksCount: relevantChunks?.length || 0,
      timestamp: Date.now(),
      options,
    });

    // Check if a simulated failure is queued
    if (this.failureQueue.length > 0) {
      const err = this.failureQueue.shift();
      throw err;
    }

    const cleanChunks = this.normalizeChunks(relevantChunks);

    if (cleanChunks.length === 0) {
      return 'The provided documents do not contain enough information to answer this question.';
    }

    // Check custom scripted responses
    const lookupKey = trimmed.toLowerCase();
    for (const [key, val] of this.mockResponses.entries()) {
      if (lookupKey.includes(key)) {
        return val;
      }
    }

    // Stopwords for question intent analysis
    const STOP_WORDS = new Set([
      'what', 'which', 'where', 'when', 'who', 'how', 'why', 'does', 'do', 'did',
      'is', 'are', 'was', 'were', 'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at',
      'to', 'for', 'of', 'with', 'by', 'from', 'about', 'between', 'into', 'through',
      'during', 'system', 'this', 'that', 'these', 'those', 'their', 'work', 'differ',
      'sequence', 'transition', 'ensures', 'ensure', 'applied'
    ]);

    const qTokens = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

    const combinedChunkText = cleanChunks.map((c) => (c.text || '').toLowerCase()).join(' ');

    // Check unsupported entities that trigger explicit refusal in grounded models
    const unsupportedKeywords = [
      'openai', 'gpt-4o', 'redis', 'bullmq', 'german', 'pinecone', 'idioms',
      'azure', 'kubernetes', 'helm', 'chart', 'outage', 'undocumented'
    ];
    const hasUnsupportedKeyword = unsupportedKeywords.some((kw) => lookupKey.includes(kw));

    const matchingTokens = qTokens.filter((t) => combinedChunkText.includes(t));
    const tokenSupportRatio = qTokens.length > 0 ? matchingTokens.length / qTokens.length : 0;

    // If query contains unsupported entities or lacks sufficient lexical support in retrieved excerpts, refuse faithfully
    if (hasUnsupportedKeyword || tokenSupportRatio < 0.35) {
      return 'The provided documents do not contain enough information to answer this question.';
    }

    // Deterministic synthesized response based directly on the first matching chunk
    const primaryChunk = cleanChunks[0];
    return `Based on the provided document excerpts, ${primaryChunk.text.slice(0, 150)}.`;
  }
}
