import mongoose from 'mongoose';

const generatedDocumentSchema = new mongoose.Schema(
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
    sourceCommitSha: {
      type: String,
      default: null,
    },
    documentPath: {
      type: String,
      required: true,
      trim: true,
      // e.g. 'README.md', 'ARCHITECTURE.md', 'docs/API.md'
    },
    documentType: {
      type: String,
      enum: [
        'readme',
        'architecture',
        'prd',
        'api',
        'database',
        'security',
        'contributing',
        'testing',
        'deployment',
        'environment',
      ],
      required: true,
    },
    generatedContent: {
      type: String,
      default: '',
    },
    originalContentHash: {
      type: String,
      default: null,
    },
    validationWarnings: [{ type: String }],
    userEdited: {
      type: Boolean,
      default: false,
    },
    publicationStatus: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for per-user/repo document lookup
generatedDocumentSchema.index({ ownerUserId: 1, repositoryId: 1, documentPath: 1 });

export const GeneratedDocument = mongoose.model('GeneratedDocument', generatedDocumentSchema);
