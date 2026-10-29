import mongoose from 'mongoose';

/**
 * Sanitizes error messages to ensure no internal file system paths,
 * stack traces, or credentials are leaked to the client.
 */
function sanitizeErrorMessage(msg) {
  if (!msg) return null;
  let clean = String(msg).split('\n')[0].trim(); // Take only the summary line
  // Strip absolute file system paths (e.g. C:\... or /home/...)
  clean = clean.replace(/[A-Za-z]:\\[^:\n]+/g, '[filepath]');
  clean = clean.replace(/\/[a-zA-Z0-9_\-./]+/g, '[filepath]');
  return clean.slice(0, 300); // Bounded length
}

const documentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },
    originalName: {
      type: String,
      required: [true, 'Original document name is required'],
      trim: true,
    },
    fileType: {
      type: String,
      required: [true, 'File type is required'],
      enum: ['pdf', 'txt'],
      lowercase: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'ready', 'failed'],
      default: 'queued',
      index: true,
    },
    characterCount: {
      type: Number,
      default: 0,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    pageCount: {
      type: Number,
      default: 1,
    },
    extractedText: {
      type: String,
      default: null,
      select: false, // Omit from default queries to preserve network bandwidth and memory
    },
    errorMessage: {
      type: String,
      default: null,
      set: sanitizeErrorMessage,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.chunksCount = ret.chunkCount;
        ret.size = ret.fileSize;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.chunksCount = ret.chunkCount;
        ret.size = ret.fileSize;
        return ret;
      },
    },
  }
);

// Compound index for efficient multi-tenant document listings and status filtering
documentSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const Document = mongoose.model('Document', documentSchema);
