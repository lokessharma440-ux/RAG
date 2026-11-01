import { CodeChunk } from '../../models/CodeChunk.js';
import { RepositoryFile } from '../../models/RepositoryFile.js';
import { generateAnswer } from '../../RAG/geminiGenerator.js';

/**
 * Generates evidence-grounded documentation for a repository module or topic.
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @param {string} docType - 'architecture' | 'api' | 'models' | 'setup' | 'overview'
 * @param {Object} [options={}]
 * @returns {Promise<{ documentation: string, references: Array<string> }>}
 */
export async function generateCodebaseDocumentation(repositoryId, ownerUserId, docType = 'overview', options = {}) {
  let queryTerms = [];
  let systemPromptTopic = '';

  switch (docType) {
    case 'api':
      queryTerms = ['router', 'app.get', 'app.post', 'endpoint', 'controller', 'req', 'res'];
      systemPromptTopic = 'API Endpoint Catalog and Route Handlers';
      break;
    case 'models':
      queryTerms = ['mongoose.Schema', 'model', 'database', 'collection', 'Schema', 'field'];
      systemPromptTopic = 'Database Models and Schema Architecture';
      break;
    case 'setup':
      queryTerms = ['package.json', 'dotenv', 'process.env', 'PORT', 'connect', 'config', 'Dockerfile'];
      systemPromptTopic = 'Setup, Environment Variables, and Deployment Guide';
      break;
    case 'architecture':
    default:
      queryTerms = ['server', 'express', 'router', 'service', 'model', 'middleware', 'app'];
      systemPromptTopic = 'High-Level System Architecture and Component Flow';
      break;
  }

  // Retrieve relevant structural chunks
  const chunks = await CodeChunk.find({
    repositoryId,
    ownerUserId,
    $or: [
      { chunkType: { $in: ['route', 'class', 'function', 'config'] } },
      { relativePath: { $regex: /(?:server|app|route|model|config)/i } },
    ],
  })
    .limit(15)
    .select('relativePath startLine endLine content chunkType symbolName');

  if (chunks.length === 0) {
    // Fall back to reading top files
    const topFiles = await RepositoryFile.find({ repositoryId, ownerUserId }).limit(5).select('relativePath content');
    if (topFiles.length === 0) {
      return {
        documentation: '# Documentation\n\nNo indexable source code found in this repository to generate documentation.',
        references: [],
      };
    }
  }

  const contextSources = chunks.map((c) => ({
    originalName: `${c.relativePath} (L${c.startLine}-${c.endLine})`,
    text: `// File: ${c.relativePath} [${c.chunkType}${c.symbolName ? `: ${c.symbolName}` : ''}]\n${c.content}`,
  }));

  const question = `Generate a comprehensive, truthful, and well-structured Markdown documentation document covering: ${systemPromptTopic}.
Rely strictly on the provided codebase evidence. Include exact file paths and code snippets where relevant. Do not invent unverified commands or environment variables.`;

  const answer = await generateAnswer(question, contextSources, options);

  const references = Array.from(new Set(chunks.map((c) => `${c.relativePath}:${c.startLine}-${c.endLine}`)));

  return {
    documentation: answer,
    references,
  };
}
