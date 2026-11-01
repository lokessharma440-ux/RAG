import mongoose from 'mongoose';

const repositoryFileSchema = new mongoose.Schema(
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
    relativePath: {
      type: String,
      required: true,
      trim: true,
    },
    language: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    extension: {
      type: String,
      required: true,
      lowercase: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 0,
    },
    fileHash: {
      type: String,
      required: true,
    },
    lineCount: {
      type: Number,
      default: 0,
    },
    content: {
      type: String,
      required: true,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    isSecretExempt: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound unique index for file deduplication per repo
repositoryFileSchema.index({ repositoryId: 1, relativePath: 1 }, { unique: true });
repositoryFileSchema.index({ ownerUserId: 1, repositoryId: 1 });

export const RepositoryFile = mongoose.model('RepositoryFile', repositoryFileSchema);
