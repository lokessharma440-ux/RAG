import mongoose from 'mongoose';

// ── Finding subdocument ────────────────────────────────────────────────────────
const findingSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    category: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    severity: {
      type: String,
      enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
      required: true,
    },
    confidence: {
      type: String,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      default: 'MEDIUM',
    },
    verificationStatus: {
      type: String,
      enum: [
        'VERIFIED_STATIC_PATTERN',
        'TOOL_CONFIRMED',
        'NEEDS_MANUAL_REVIEW',
        'NOT_REPRODUCED',
      ],
      default: 'NEEDS_MANUAL_REVIEW',
    },
    filePath: { type: String, default: null },
    startLine: { type: Number, default: null },
    endLine: { type: Number, default: null },
    evidence: { type: String, default: '' },
    impact: { type: String, default: '' },
    recommendation: { type: String, default: '' },
    effort: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    references: [{ type: String }],
    analysisCommitSha: { type: String, default: null },
  },
  { _id: false }
);

// ── Recommendation subdocument ─────────────────────────────────────────────────
const recommendationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    category: { type: String, required: true },
    title: { type: String, required: true },
    problem: { type: String, default: '' },
    whyItMatters: { type: String, default: '' },
    evidence: { type: String, default: '' },
    recommendedChange: { type: String, default: '' },
    expectedBenefit: { type: String, default: '' },
    effort: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    risk: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    prerequisites: [{ type: String }],
    relevantFiles: [{ type: String }],
    verificationSteps: [{ type: String }],
    priority: { type: Number, default: 99 },
  },
  { _id: false }
);

// ── Main RepositoryAnalysis schema ─────────────────────────────────────────────
const repositoryAnalysisSchema = new mongoose.Schema(
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
    commitSha: { type: String, default: null },
    analysisVersion: { type: String, default: '1.0' },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    detectedStack: {
      projectType: { type: String, default: null },
      frameworks: [{ type: String }],
      languages: [{ type: String }],
      packageManager: { type: String, default: null },
      hasTests: { type: Boolean, default: false },
      hasDocker: { type: Boolean, default: false },
      hasCICD: { type: Boolean, default: false },
      hasDocumentation: { type: Boolean, default: false },
    },
    summary: { type: String, default: '' },
    categorySummaries: {
      architecture: { type: String, default: '' },
      authentication: { type: String, default: '' },
      apiQuality: { type: String, default: '' },
      frontendQuality: { type: String, default: '' },
      database: { type: String, default: '' },
      dependencies: { type: String, default: '' },
      testing: { type: String, default: '' },
      deployment: { type: String, default: '' },
      performance: { type: String, default: '' },
    },
    findings: [findingSchema],
    recommendations: [recommendationSchema],
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient per-user/repo listing sorted by newest
repositoryAnalysisSchema.index({ ownerUserId: 1, repositoryId: 1, createdAt: -1 });

export const RepositoryAnalysis = mongoose.model('RepositoryAnalysis', repositoryAnalysisSchema);
