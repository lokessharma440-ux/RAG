import mongoose from 'mongoose';

const codebaseSchema = new mongoose.Schema(
  {
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Repository name is required'],
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    sourceType: {
      type: String,
      enum: ['github', 'zip'],
      required: true,
    },
    sourceUrl: {
      type: String,
      default: null,
      trim: true,
    },
    defaultBranch: {
      type: String,
      default: 'main',
      trim: true,
    },
    indexedCommitSha: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        'queued',
        'fetching',
        'extracting',
        'discovering_files',
        'parsing',
        'chunking',
        'embedding',
        'indexing',
        'ready',
        'failed',
        'cancelled',
      ],
      default: 'queued',
      index: true,
    },
    progress: {
      stage: { type: String, default: 'queued' },
      percentage: { type: Number, default: 0, min: 0, max: 100 },
      currentFile: { type: String, default: '' },
      message: { type: String, default: 'Repository queued for ingestion.' },
    },
    stats: {
      totalFiles: { type: Number, default: 0 },
      indexedFiles: { type: Number, default: 0 },
      skippedFiles: { type: Number, default: 0 },
      totalChunks: { type: Number, default: 0 },
      totalLines: { type: Number, default: 0 },
      languages: [
        {
          name: { type: String, required: true },
          count: { type: Number, default: 0 },
          bytes: { type: Number, default: 0 },
        },
      ],
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for user query performance and sorting
codebaseSchema.index({ ownerUserId: 1, status: 1, createdAt: -1 });

export const Codebase = mongoose.model('Codebase', codebaseSchema);
