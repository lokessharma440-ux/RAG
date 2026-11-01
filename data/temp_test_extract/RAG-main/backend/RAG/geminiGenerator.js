import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { SYSTEM_INSTRUCTION, GeminiProvider } from "./providers/GeminiProvider.js";
import { getGlobalProvider, getLLMProvider, setGlobalProvider } from "./providers/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from backend/RAG/.env or backend/.env
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

/**
 * Backwards-compatible helper returning GoogleGenAI client instance.
 */
function getClient() {
  const provider = getGlobalProvider();
  if (provider instanceof GeminiProvider) {
    return provider.getClient();
  }
  return new GeminiProvider().getClient();
}

/**
 * Generates an answer to the user's question grounded in the retrieved document chunks
 * using the configured LLM provider abstraction (Gemini by default).
 *
 * @param {string} question - The user's query.
 * @param {Array<string|Object>} relevantChunks - Retrieved document chunks.
 * @param {Object} [options={}] - Settings (model, temperature, etc.).
 * @returns {Promise<string>} The generated answer string.
 */
async function generateAnswer(question, relevantChunks = [], options = {}) {
  const provider = getGlobalProvider();
  return provider.generateAnswer(question, relevantChunks, options);
}

export {
  generateAnswer,
  getClient,
  SYSTEM_INSTRUCTION,
  getGlobalProvider,
  getLLMProvider,
  setGlobalProvider,
};
