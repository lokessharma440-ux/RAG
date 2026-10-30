import mongoose from 'mongoose';

const aiFixPromptSchema = new mongoose.Schema(
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
    analysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RepositoryAnalysis',
      required: false,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250,
    },
    mode: {
      type: String,
      enum: [
        'single_issue',
        'related_issues',
        'full_project',
        'documentation',
        'security',
        'test_generation',
      ],
      default: 'single_issue',
      required: true,
    },
    targetAgent: {
      type: String,
      enum: ['generic', 'antigravity', 'cursor', 'claude_code', 'gemini_cli', 'custom'],
      default: 'generic',
      required: true,
    },
    selectedFindingIds: [
      {
        type: String,
        required: true,
      },
    ],
    analyzedCommitSha: {
      type: String,
      default: null,
    },
    currentCommitSha: {
      type: String,
      default: null,
    },
    isStale: {
      type: Boolean,
      default: false,
    },
    generatedPrompt: {
      type: String,
      required: true,
    },
    userEditedPrompt: {
      type: String,
      default: null,
    },
    isUserEdited: {
      type: Boolean,
      default: false,
    },
    promptTokensEst: {
      type: Number,
      default: 0,
    },
    contextSummary: {
      repositoryName: { type: String, default: '' },
      projectType: { type: String, default: '' },
      filesReferenced: [{ type: String }],
      totalIssuesCount: { type: Number, default: 0 },
      criticalCount: { type: Number, default: 0 },
      highCount: { type: Number, default: 0 },
      categories: [{ type: String }],
    },
    validationReport: {
      isValid: { type: Boolean, default: true },
      score: { type: Number, default: 100 },
      warnings: [{ type: String }],
      sectionsPresent: [{ type: String }],
      checks: {
        hasRole: { type: Boolean, default: true },
        hasProjectContext: { type: Boolean, default: true },
        hasObjective: { type: Boolean, default: true },
        hasFindings: { type: Boolean, default: true },
        hasInvestigation: { type: Boolean, default: true },
        hasImplementation: { type: Boolean, default: true },
        hasConstraints: { type: Boolean, default: true },
        hasTesting: { type: Boolean, default: true },
        hasAcceptanceCriteria: { type: Boolean, default: true },
        hasFinalReport: { type: Boolean, default: true },
        noSecretsDetected: { type: Boolean, default: true },
        staleChecked: { type: Boolean, default: true },
      },
    },
    status: {
      type: String,
      enum: [
        'DRAFT',
        'GENERATED',
        'COPIED',
        'DOWNLOADED',
        'EXTERNAL_FIX_IN_PROGRESS',
        'FIX_SUBMITTED_FOR_REVIEW',
        'FIX_VERIFIED',
        'STILL_PRESENT',
        'NEEDS_MANUAL_REVIEW',
      ],
      default: 'GENERATED',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for user/repo listing
aiFixPromptSchema.index({ ownerUserId: 1, repositoryId: 1, createdAt: -1 });

export const AIFixPrompt = mongoose.model('AIFixPrompt', aiFixPromptSchema);

