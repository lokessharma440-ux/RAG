import mongoose from 'mongoose';

const documentChunkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length === 384;
        },
        message: (props) => `Embedding vector must have 384 dimensions, got ${props.value?.length}`,
      },
    },
    originalName: {
      type: String,
      required: true,
    },
    pageNumber: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient multi-tenant document chunk queries
documentChunkSchema.index({ userId: 1, documentId: 1, chunkIndex: 1 });
documentChunkSchema.index({ documentId: 1, chunkIndex: 1 });

export const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
