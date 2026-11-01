/**
 * Phase D4: Base LLM Provider Abstraction
 *
 * Defines the contract for all conversational and RAG synthesis providers.
 * Separates LLM generation and resilience policies from retrieval and document storage.
 */

export class BaseLLMProvider {
  constructor(config = {}) {
    this.name = config.name || 'base';
    this.maxChunks = config.maxChunks || 6;
    this.maxTotalChars = config.maxTotalChars || 8000;
    this.timeoutMs = config.timeoutMs || 30000;
  }

  /**
   * Normalizes chunk objects into consistent format.
   *
   * @param {Array<string|Object>} chunks
   * @returns {Array<{ text: string, name: string, chunkIndex: number, originalName: string }>}
   */
  normalizeChunks(chunks) {
    if (!Array.isArray(chunks)) return [];

    return chunks
      .map((chunk) => {
        if (typeof chunk === 'string') {
          const text = chunk.trim();
          return text ? { text, name: 'Document', originalName: 'Document', chunkIndex: 0 } : null;
        }
        if (chunk && typeof chunk.text === 'string') {
          const text = chunk.text.trim();
          return text
            ? {
                text,
                name: chunk.originalName || 'Document',
                originalName: chunk.originalName || 'Document',
                chunkIndex: chunk.chunkIndex ?? 0,
              }
            : null;
        }
        if (chunk && typeof chunk.pageContent === 'string') {
          const text = chunk.pageContent.trim();
          const docName = chunk.metadata?.source || chunk.metadata?.originalName || 'Document';
          return text
            ? {
                text,
                name: docName,
                originalName: docName,
                chunkIndex: chunk.chunkIndex ?? 0,
              }
            : null;
        }
        return null;
      })
      .filter(Boolean);
  }

  /**
   * Formats retrieved document chunks into a structured prompt context block
   * with budget limits and source metadata.
   *
   * @param {Array<Object>} cleanChunks
   * @returns {string} Formatted context
   */
  formatContext(cleanChunks) {
    if (!cleanChunks || cleanChunks.length === 0) return '';

    // Take top candidate chunks up to maxChunks limit, then sort into logical narrative order for the LLM
    const topCandidates = cleanChunks.slice(0, this.maxChunks);
    const sortedForNarrative = [...topCandidates].sort((a, b) => {
      const nameA = a.name || a.originalName || '';
      const nameB = b.name || b.originalName || '';
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0);
    });

    let currentLength = 0;
    const selectedChunks = [];

    for (const chunk of sortedForNarrative) {
      if (currentLength + chunk.text.length > this.maxTotalChars) {
        const allowed = this.maxTotalChars - currentLength;
        if (allowed > 100) {
          selectedChunks.push({
            ...chunk,
            text: chunk.text.slice(0, allowed) + '... [truncated]',
          });
        }
        break;
      }
      selectedChunks.push(chunk);
      currentLength += chunk.text.length;
    }

    return selectedChunks
      .map(
        (chunk, idx) =>
          `[Document Excerpt ${idx + 1} - Source: ${chunk.name || 'Document'}]\n${chunk.text}`
      )
      .join('\n\n');
  }

  /**
   * Generates a direct text completion without document context (e.g. for query rewriting).
   *
   * @param {string} prompt
   * @param {Object} [options={}]
   * @returns {Promise<string>}
   */
  async generateDirectText(prompt, options = {}) {
    return this.generateAnswer(prompt, [], options);
  }

  /**
   * Generates a grounded answer for a question and retrieved chunks.
   * Must be implemented by concrete providers.
   *
   * @param {string} question
   * @param {Array<string|Object>} relevantChunks
   * @param {Object} [options={}]
   * @returns {Promise<string>}
   */
  async generateAnswer(question, relevantChunks = [], options = {}) {
    throw new Error(`generateAnswer() must be implemented by subclass (provider "${this.name}").`);
  }
}
