import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { authenticateUser } from '../middleware/authMiddleware.js';
import {
  processAndSaveDocument,
  getAllDocuments,
  getDocumentById,
  deleteDocument,
  retryDocumentProcessing,
  cleanupTempFile,
} from '../services/documentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Enforce authentication on all document endpoints
router.use(authenticateUser);

// Ensure temporary upload directory exists
const tempUploadDir = path.resolve(__dirname, '../uploads/temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Bounded Disk Storage: Writes upload stream directly to disk instead of heap memory
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `upload-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max file size
    files: 1, // Max 1 file per upload request
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (ext === 'pdf' || ext === 'txt') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .pdf and .txt files are supported.'), false);
    }
  },
});

/**
 * POST /api/documents/upload
 * Accepts a PDF or TXT file, writes to disk buffer, extracts text,
 * splits into chunks, generates embeddings, and saves to MongoDB.
 */
router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (req.file?.path) {
        await cleanupTempFile(req.file.path);
      }
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File size exceeds 15MB limit. Please upload a smaller document.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error.',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No document file uploaded. Please attach a .pdf or .txt file.',
      });
    }

    try {
      const savedDoc = await processAndSaveDocument(req.file, req.user._id);
      return res.status(201).json({
        success: true,
        message: 'Document successfully parsed, embedded, and indexed.',
        data: savedDoc,
      });
    } catch (processError) {
      return res.status(400).json({
        success: false,
        message: processError.message || 'Failed to process document.',
      });
    }
  });
});

/**
 * GET /api/documents
 * Returns paginated list of documents uploaded by the authenticated user.
 * Supports query params: page (default 1), limit (default 10, max 50), status.
 */
router.get('/', async (req, res) => {
  try {
    const { page, limit, status } = req.query;
    const documents = await getAllDocuments(req.user._id, {
      page: page || 1,
      limit: limit || 10,
      status: status || null,
    });

    return res.json({
      success: true,
      count: documents.length,
      data: documents,
      pagination: documents.pagination || {
        total: documents.length,
        page: 1,
        limit: documents.length,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve documents.',
    });
  }
});

/**
 * POST /api/documents/:id/retry
 * Retries processing for a failed document owned by the user.
 */
router.post('/:id/retry', async (req, res) => {
  try {
    const updatedDoc = await retryDocumentProcessing(req.params.id, req.user._id);
    return res.json({
      success: true,
      message: 'Document retry completed successfully.',
      data: updatedDoc,
    });
  } catch (err) {
    const isNotFound = err.message.includes('not found') || err.message.includes('denied');
    const status = isNotFound ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: err.message || 'Document retry failed.',
    });
  }
});

/**
 * GET /api/documents/:id/status
 * Returns processing status and chunk statistics for a single document owned by the user.
 */
router.get('/:id/status', async (req, res) => {
  try {
    const doc = await getDocumentById(req.params.id, req.user._id);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Document not found or access denied.',
      });
    }

    return res.json({
      success: true,
      data: {
        id: doc._id,
        originalName: doc.originalName,
        status: doc.status,
        chunkCount: doc.chunkCount,
        characterCount: doc.characterCount,
        pageCount: doc.pageCount,
        errorMessage: doc.errorMessage,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get document status.',
    });
  }
});

/**
 * DELETE /api/documents/:id
 * Deletes document record and all associated vector chunks from MongoDB,
 * restricted strictly to the document owner.
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteDocument(req.params.id, req.user._id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Document not found or access denied.',
      });
    }

    return res.json({
      success: true,
      message: 'Document and its chunks have been deleted successfully.',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete document.',
    });
  }
});

export default router;
