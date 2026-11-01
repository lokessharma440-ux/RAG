import mongoose from 'mongoose';

/**
 * Production-grade Semantic Cache Mongoose Schema for DevMind AI RAG Chatbot.
 * Implements deterministic scope hashing, TTL expiration, tenant isolation,
 * and vector validation for 384-dimensional Xenova embeddings.
 */
const semanticCacheEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    scopeType: {
      type: String,
      enum: ['document', 'codebase'],
      default: 'document',
      required: true,
      index: true,
    },
    // SHA-256 fingerprint of the authorized document/codebase IDs and their last modification timestamps
    scopeHash: {
      type: String,
      required: true,
      index: true,
    },
    scopeIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
    ],
    normalizedQuery: {
      type: String,
      required: true,
      trim: true,
    },
    queryEmbedding: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 384,
        message: 'Query embedding must be 384 dimensions',
      },
    },
    answer: {
      type: String,
      required: true,
    },
    sources: [
      {
        documentId: String,
        originalName: String,
        chunkIndex: Number,
        text: String,
        score: Number,
      },
    ],
    llmModel: {
      type: String,
      default: 'gemini-1.5-flash',
    },
    promptVersion: {
      type: String,
      default: 'v2-grounded-rag',
      index: true,
    },
    hitCount: {
      type: Number,
      default: 0,
    },
    lastHitAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // Native MongoDB TTL index automatically purges expired records
    },
  },
  { timestamps: true }
);

// Compound index for fast candidate pre-filtering strictly isolated by user and scope
semanticCacheEntrySchema.index({ userId: 1, scopeType: 1, scopeHash: 1, expiresAt: 1 });

export const SemanticCacheEntry = mongoose.model('SemanticCacheEntry', semanticCacheEntrySchema);

