import { getGlobalProvider } from './geminiGenerator.js';

/**
 * Prompt instruction for query rewriting to optimize retrieval without hallucinating facts.
 */
export const REWRITING_SYSTEM_INSTRUCTION = `You are a high-precision Query Reformulation Specialist for a document Retrieval-Augmented Generation (RAG) system.
Your sole job is to transform unclear, fragmented, conversational, or poorly phrased user questions into a single, standalone search query optimized for dense semantic vector retrieval.

Rules:
1. Preserve User Intent: Do NOT alter the factual subject or question intent.
2. Resolve Anaphora/Pronouns: If conversation history is provided, resolve references like "it", "that", "this", or "explain that again" to the specific entity or topic discussed. If no history or topic is available, do NOT invent one.
3. Fix Spelling & Grammar: Correct typos, spelling errors, and fragmented grammar (e.g. "whr is dockr" -> "Where is Docker located?").
4. Expand Common Acronyms/Abbreviations cautiously: Expand terms like "WFH" -> "working from home", "CP" -> "connection problem / computer problem" ONLY when the meaning is unambiguous in context.
5. Support English and Hinglish: If the input is in Hinglish (e.g. "leave policy kya hai"), reformulate it into clear English and preserve the original intent (e.g. "What is the organization's leave policy?").
6. Preserve Technical Precision: NEVER change or drop technical terms, library names, error codes, version numbers, function names, or file paths.
7. No Hallucinations / Assumptions: Do NOT introduce external facts or answers. Do NOT answer the question.
8. Output Format: You MUST output ONLY valid JSON matching this schema:
{"rewrittenQuery": "concise standalone retrieval query"}`;

/**
 * Rewrites a user query for retrieval using the configured LLM provider.
 * Implements bounded timeout, strict JSON validation, Hinglish support, and safe fallback.
 *
 * @param {string} originalQuery - The user's input query.
 * @param {Array<{role: string, content: string}>} [conversationHistory=[]] - Recent conversation turns.
 * @param {Object} [options={}] - Configuration options.
 * @returns {Promise<{ rewrittenQuery: string, wasRewritten: boolean, reason?: string }>}
 */
export async function rewriteQuery(originalQuery, conversationHistory = [], options = {}) {
  const isEnabled = process.env.QUERY_REWRITING_ENABLED !== 'false';
  const cleanOriginal = (originalQuery || '').trim();

  if (!cleanOriginal) {
    return { rewrittenQuery: cleanOriginal, wasRewritten: false, reason: 'empty_query' };
  }

  // If query rewriting is disabled via feature flag, return original query immediately
  if (!isEnabled) {
    return { rewrittenQuery: cleanOriginal, wasRewritten: false, reason: 'feature_disabled' };
  }

  // Fast heuristic: If query is already very detailed, structured, or contains quotes/code, we can pass it through
  // But standard questions, abbreviations, typos, and anaphora benefit from reformulation.
  const provider = options.provider || getGlobalProvider();

  // If mock provider or provider without structured rewriting capability
  if (provider && provider.name === 'mock') {
    // Check if mock has custom behavior or test registered for rewriting
    if (options.mockRewrittenQuery !== undefined) {
      return {
        rewrittenQuery: options.mockRewrittenQuery || cleanOriginal,
        wasRewritten: Boolean(options.mockRewrittenQuery && options.mockRewrittenQuery !== cleanOriginal),
        reason: 'mock_provider',
      };
    }
  }

  // Build conversation context if available
  let contextSnippet = '';
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-4);
    contextSnippet = recent
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || m.text || '').slice(0, 300)}`)
      .join('\n');
  }

  const userPrompt = contextSnippet
    ? `Conversation History:\n${contextSnippet}\n\nCurrent User Query: "${cleanOriginal}"\n\nReturn JSON with {"rewrittenQuery": "..."}:`
    : `User Query: "${cleanOriginal}"\n\nReturn JSON with {"rewrittenQuery": "..."}:`;

  const timeoutMs = parseInt(process.env.QUERY_REWRITING_TIMEOUT_MS, 10) || options.timeoutMs || 8000;

  try {
    let rawText = '';

    if (provider && typeof provider.generateAnswer === 'function') {
      // Use existing provider abstraction
      // We wrap the call in a timeout race to guarantee bounded latency
      const rewritePromise = (async () => {
        if (typeof provider.generateDirectText === 'function') {
          return await provider.generateDirectText(userPrompt, {
            systemInstruction: REWRITING_SYSTEM_INSTRUCTION,
            temperature: 0.1,
            maxOutputTokens: 150,
          });
        }

        // Fallback through provider.callWithTimeout if GeminiProvider
        if (typeof provider.callWithTimeout === 'function' && typeof provider.getClient === 'function') {
          const ai = provider.getClient();
          const modelName = provider.candidateModels?.[0] || 'gemini-1.5-flash';
          const resp = await provider.callWithTimeout(
            ai,
            modelName,
            `${REWRITING_SYSTEM_INSTRUCTION}\n\n${userPrompt}`,
            {
              temperature: 0.1,
              maxOutputTokens: 150,
            }
          );
          return resp?.text || '';
        }

        // Generic provider fallback
        return await provider.generateAnswer(
          `${REWRITING_SYSTEM_INSTRUCTION}\n\nTask: Output ONLY JSON with "rewrittenQuery".\n${userPrompt}`,
          [],
          { temperature: 0.1, maxOutputTokens: 150 }
        );
      })();

      let timer = null;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`Query rewriting timed out after ${timeoutMs}ms.`);
          err.code = 'REWRITE_TIMEOUT';
          reject(err);
        }, timeoutMs);
      });

      try {
        rawText = await Promise.race([rewritePromise, timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return { rewrittenQuery: cleanOriginal, wasRewritten: false, reason: 'empty_response_fallback' };
    }

    // Parse JSON safely
    const cleanedJson = rawText
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();

    // Find JSON object boundaries if model added prose
    const startIdx = cleanedJson.indexOf('{');
    const endIdx = cleanedJson.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      return { rewrittenQuery: cleanOriginal, wasRewritten: false, reason: 'json_boundary_fallback' };
    }

    const jsonStr = cleanedJson.substring(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr);

    const candidate = parsed?.rewrittenQuery;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      const sanitized = candidate.trim().replace(/^["']|["']$/g, '');
      return {
        rewrittenQuery: sanitized,
        wasRewritten: sanitized.toLowerCase() !== cleanOriginal.toLowerCase(),
        reason: 'success',
      };
    }

    return { rewrittenQuery: cleanOriginal, wasRewritten: false, reason: 'invalid_field_fallback' };
  } catch (err) {
    // Graceful fallback: Never crash the RAG pipeline or chat endpoint on rewriting error
    return {
      rewrittenQuery: cleanOriginal,
      wasRewritten: false,
      reason: `error_fallback: ${err.message}`,
    };
  }
}

