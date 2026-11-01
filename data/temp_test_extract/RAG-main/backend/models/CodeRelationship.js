import mongoose from 'mongoose';

const codeRelationshipSchema = new mongoose.Schema(
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
    sourcePath: {
      type: String,
      required: true,
      index: true,
    },
    targetPath: {
      type: String,
      default: null,
      index: true,
    },
    relationType: {
      type: String,
      enum: ['imports', 'defines_route', 'uses_model', 'calls_function', 'renders_component'],
      required: true,
    },
    symbol: {
      type: String,
      default: null,
      index: true,
    },
    lineNumber: {
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

codeRelationshipSchema.index({ repositoryId: 1, sourcePath: 1 });
codeRelationshipSchema.index({ repositoryId: 1, targetPath: 1 });
codeRelationshipSchema.index({ repositoryId: 1, relationType: 1 });

export const CodeRelationship = mongoose.model('CodeRelationship', codeRelationshipSchema);
