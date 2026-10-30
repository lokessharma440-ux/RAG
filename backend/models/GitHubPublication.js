import mongoose from 'mongoose';

const gitHubPublicationSchema = new mongoose.Schema(
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
    targetBranch: {
      type: String,
      default: null,
    },
    generatedBranch: {
      type: String,
      default: null,
    },
    pullRequestUrl: {
      type: String,
      default: null,
    },
    pullRequestNumber: {
      type: Number,
      default: null,
    },
    publicationStatus: {
      type: String,
      enum: [
        'pending',
        'creating_branch',
        'pushing_files',
        'creating_pr',
        'completed',
        'failed',
        'conflict_detected',
      ],
      default: 'pending',
    },
    publishedFiles: [{ type: String }],
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

gitHubPublicationSchema.index({ ownerUserId: 1, repositoryId: 1, createdAt: -1 });

export const GitHubPublication = mongoose.model('GitHubPublication', gitHubPublicationSchema);
