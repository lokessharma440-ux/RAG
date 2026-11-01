import mongoose from 'mongoose';

const codeChunkSchema = new mongoose.Schema(
  {
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    repositoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Codebase',
      required: true,
      index: true,
    },
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepositoryFile',
      required: true,
      index: true,
    },
    relativePath: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      required: true,
      lowercase: true,
    },
    chunkType: {
      type: String,
      enum: ['function', 'class', 'method', 'import', 'export', 'route', 'block', 'config'],
      default: 'block',
    },
    symbolName: {
      type: String,
      default: null,
      index: true,
    },
    startLine: {
      type: Number,
      required: true,
      min: 1,
    },
    endLine: {
      type: Number,
      required: true,
      min: 1,
    },
    content: {
      type: String,
      required: true,
    },
    contentHash: {
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
        message: (props) => `Expected 384-dimensional embedding, received ${props.value.length}`,
      },
    },
    indexVersion: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

codeChunkSchema.index({ repositoryId: 1, ownerUserId: 1 });
codeChunkSchema.index({ repositoryId: 1, relativePath: 1 });
codeChunkSchema.index({ repositoryId: 1, symbolName: 1 });

export const CodeChunk = mongoose.model('CodeChunk', codeChunkSchema);
