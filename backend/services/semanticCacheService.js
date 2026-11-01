import crypto from 'crypto';
import mongoose from 'mongoose';
import { SemanticCacheEntry } from '../models/SemanticCacheEntry.js';
import { Document } from '../models/Document.js';
import { cosineSimilarity } from '../RAG/vectorStore.js';

// Default configuration constants
const DEFAULT_SIMILARITY_THRESHOLD = 0.94;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const MAX_CANDIDATE_POOL = 50;
const PROMPT_VERSION = 'v2-grounded-rag';

/**
 * Computes a deterministic SHA-256 scope fingerprint based on authorized documents and their modification dates.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Array<string|mongoose.Types.ObjectId>} scopeIds
 * @returns {Promise<{ scopeHash: string, validIds: Array<mongoose.Types.ObjectId> }>}
 */
export async function computeScopeHash(userId, scopeIds = []) {
  const parsedUserId = new mongoose.Types.ObjectId(userId);
  let docs = [];

  if (Array.isArray(scopeIds) && scopeIds.length > 0) {
    const validObjectIds = scopeIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    docs = await Document.find({
      _id: { $in: validObjectIds },
      userId: parsedUserId,
      status: 'ready',
    }).select('_id updatedAt');
  } else {
    docs = await Document.find({
      userId: parsedUserId,
      status: 'ready',
    }).select('_id updatedAt');
  }

  if (docs.length === 0) {
    return { scopeHash: 'empty_scope', validIds: [] };
  }

  // Sort deterministically by ID
  const sortedTokens = docs
    .map((d) => `${d._id.toString()}:${d.updatedAt ? d.updatedAt.getTime() : 0}`)
    .sort();

  const hash = crypto.createHash('sha256').update(sortedTokens.join('|')).digest('hex');
  return {
    scopeHash: hash,
    validIds: docs.map((d) => d._id),
  };
}

/**
 * Normalizes query string for semantic matching.
 */
export function normalizeQueryString(query) {
  if (!query || typeof query !== 'string') return '';
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Look up semantically similar answer strictly bounded by user and authorized scope hash.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string} params.query
 * @param {Array<number>} params.queryEmbedding
 * @param {Array<string>} [params.documentIds=[]]
 * @param {Object} [params.options={}]
 * @returns {Promise<{ hit: boolean, answer?: string, sources?: Array<Object>, similarity?: number }>}
 */
export async function lookupSemanticCache({
  userId,
  query,
  queryEmbedding,
  documentIds = [],
  options = {},
}) {
  const isEnabled = process.env.SEMANTIC_CACHE_ENABLED !== 'false';
  if (!isEnabled || !userId || !queryEmbedding) {
    return { hit: false, reason: 'cache_disabled_or_missing_params' };
  }

  try {
    const { scopeHash, validIds } = await computeScopeHash(userId, documentIds);
    if (scopeHash === 'empty_scope') {
      return { hit: false, reason: 'empty_scope' };
    }

    const threshold = options.similarityThreshold || parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD) || DEFAULT_SIMILARITY_THRESHOLD;

    // Fetch candidate entries strictly belonging to this user and matching exact scopeHash
    const candidates = await SemanticCacheEntry.find({
      userId: new mongoose.Types.ObjectId(userId),
      scopeType: 'document',
      scopeHash,
      promptVersion: PROMPT_VERSION,
      expiresAt: { $gt: new Date() },
    })
      .select('normalizedQuery queryEmbedding answer sources hitCount')
      .sort({ updatedAt: -1 })
      .limit(MAX_CANDIDATE_POOL);

    if (candidates.length === 0) {
      return { hit: false, reason: 'no_candidates' };
    }

    let bestMatch = null;
    let highestSim = -1;

    for (const entry of candidates) {
      const sim = cosineSimilarity(queryEmbedding, entry.queryEmbedding);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = entry;
      }
    }

    if (highestSim >= threshold && bestMatch) {
      // Async hit count bump without blocking
      SemanticCacheEntry.findByIdAndUpdate(bestMatch._id, {
        $inc: { hitCount: 1 },
        lastHitAt: new Date(),
      }).catch(() => {});

      return {
        hit: true,
        answer: bestMatch.answer,
        sources: bestMatch.sources,
        similarity: highestSim,
        cached: true,
      };
    }

    return { hit: false, similarity: highestSim, reason: 'below_threshold' };
  } catch (err) {
    // Fail-safe: cache lookup errors must NEVER break user queries
    return { hit: false, reason: `lookup_error: ${err.message}` };
  }
}

/**
 * Stores a verified, grounded answer in the semantic cache.
 *
 * @param {Object} params
 */
export async function storeSemanticCache({
  userId,
  query,
  queryEmbedding,
  answer,
  sources = [],
  documentIds = [],
  options = {},
}) {
  const isEnabled = process.env.SEMANTIC_CACHE_ENABLED !== 'false';
  if (!isEnabled || !userId || !query || !queryEmbedding || !answer) {
    return false;
  }

  // Refusal and error responses must NOT be cached
  if (
    answer.includes('do not contain enough information') ||
    answer.includes('No accessible ready documents found') ||
    sources.length === 0
  ) {
    return false;
  }

  try {
    const { scopeHash, validIds } = await computeScopeHash(userId, documentIds);
    if (scopeHash === 'empty_scope') return false;

    const ttlSeconds = options.ttlSeconds || parseInt(process.env.SEMANTIC_CACHE_TTL_SECONDS, 10) || DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const normalized = normalizeQueryString(query);

    await SemanticCacheEntry.create({
      userId: new mongoose.Types.ObjectId(userId),
      scopeType: 'document',
      scopeHash,
      scopeIds: validIds,
      normalizedQuery: normalized,
      queryEmbedding,
      answer,
      sources,
      promptVersion: PROMPT_VERSION,
      expiresAt,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Evicts cache entries when documents are deleted or modified.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 */
export async function invalidateDocumentCache(userId, documentId) {
  try {
    const parsedUserId = new mongoose.Types.ObjectId(userId);
    const parsedDocId = new mongoose.Types.ObjectId(documentId);

    const result = await SemanticCacheEntry.deleteMany({
      userId: parsedUserId,
      scopeIds: parsedDocId,
    });

    return result.deletedCount || 0;
  } catch {
    return 0;
  }
}

