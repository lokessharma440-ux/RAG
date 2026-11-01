import { GeminiProvider } from './GeminiProvider.js';
import { MockLLMProvider } from './MockLLMProvider.js';

let globalProvider = null;

/**
 * Returns a configured LLM provider instance.
 * Defaults to GeminiProvider unless overridden by parameter or environment.
 *
 * @param {string|null} [name=null] - 'gemini' | 'mock'
 * @param {Object} [config={}]
 * @returns {BaseLLMProvider}
 */
export function getLLMProvider(name = null, config = {}) {
  const providerType = (name || process.env.LLM_PROVIDER || 'gemini').toLowerCase();

  if (providerType === 'mock') {
    return new MockLLMProvider(config);
  }

  return new GeminiProvider(config);
}

/**
 * Returns the currently active global LLM provider.
 * Lazily initializes GeminiProvider if none has been set.
 *
 * @returns {BaseLLMProvider}
 */
export function getGlobalProvider() {
  if (!globalProvider) {
    globalProvider = getLLMProvider();
  }
  return globalProvider;
}

/**
 * Sets the active global LLM provider (useful for testing and dependency injection).
 *
 * @param {BaseLLMProvider} provider
 */
export function setGlobalProvider(provider) {
  globalProvider = provider;
}

export { GeminiProvider, MockLLMProvider };
