import express from 'express';
import { authenticateUser } from '../middleware/authMiddleware.js';
import { queryDocumentRAG } from '../services/documentService.js';

const router = express.Router();

// Enforce authentication on chat endpoint
router.use(authenticateUser);

/**
 * POST /api/chat
 * Ask a question grounded strictly in uploaded documents owned by the authenticated user.
 *
 * Body:
 * {
 *   "question": "What does the document say about X?",
 *   "documentIds": ["<optional-doc-id>"],
 *   "topK": 3
 * }
 */
router.post('/', async (req, res) => {
  const body = req.body || {};
  const rawQuestion = body.question || body.message || body.query || body.prompt || body.text;
  const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : '';

  let documentIds = body.documentIds;
  if (!documentIds && body.documentId) {
    documentIds = [body.documentId];
  } else if (typeof documentIds === 'string') {
    documentIds = [documentIds];
  }
  const topK = body.topK;

  if (!question) {
    return res.status(400).json({
      success: false,
      message: 'A valid "question" string is required in the request body.',
    });
  }

  try {
    const result = await queryDocumentRAG(
      question,
      Array.isArray(documentIds) ? documentIds : [],
      typeof topK === 'number' && topK > 0 ? topK : 3,
      req.user._id
    );

    return res.json({
      success: true,
      data: {
        question: question.trim(),
        answer: result.answer,
        reply: result.answer,
        sources: result.sources,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message: error.message || 'Error generating grounded answer.',
    });
  }
});

export default router;
