import crypto from 'crypto';

/**
 * Extracts code-aware chunks with exact 1-indexed start and end line mapping.
 * Handles JavaScript/TypeScript, Python, Java, Go, Rust, and generic codefiles.
 *
 * @param {string} content - Full file source text.
 * @param {string} relativePath - Relative file path.
 * @param {string} language - Code language identifier.
 * @returns {Array<{ chunkType: string, symbolName: string|null, startLine: number, endLine: number, content: string, contentHash: string }>}
 */
export function parseCodeFileIntoChunks(content, relativePath, language) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const lines = content.split('\n');
  if (lines.length === 0) return [];

  // Short files (< 40 lines) are kept as a single coherent chunk
  if (lines.length <= 40) {
    const chunkText = content.trim();
    if (!chunkText) return [];
    return [
      {
        chunkType: 'block',
        symbolName: relativePath.split('/').pop() || null,
        startLine: 1,
        endLine: lines.length,
        content: chunkText,
        contentHash: crypto.createHash('sha256').update(chunkText).digest('hex'),
      },
    ];
  }

  const chunks = [];
  const isJsTs = ['javascript', 'typescript'].includes(language);
  const isPython = language === 'python';

  // Identify semantic boundaries
  let currentChunkLines = [];
  let chunkStartLine = 1;
  let currentSymbolName = null;
  let currentChunkType = 'block';

  const flushChunk = (endLine) => {
    if (currentChunkLines.length === 0) return;
    const chunkText = currentChunkLines.join('\n').trim();
    if (chunkText.length > 20) {
      chunks.push({
        chunkType: currentChunkType,
        symbolName: currentSymbolName,
        startLine: chunkStartLine,
        endLine: Math.max(chunkStartLine, endLine),
        content: chunkText,
        contentHash: crypto.createHash('sha256').update(chunkText).digest('hex'),
      });
    }
    currentChunkLines = [];
    currentSymbolName = null;
    currentChunkType = 'block';
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    let boundaryDetected = false;
    let detectedSymbol = null;
    let detectedType = 'block';

    if (isJsTs) {
      // 1. Route handlers (e.g. router.post('/login', ...))
      const routeMatch = line.match(/(?:app|router)\.(get|post|put|delete|patch|use)\s*\(\s*['"`]([^'"`]+)['"`]/i);
      if (routeMatch) {
        boundaryDetected = true;
        detectedType = 'route';
        detectedSymbol = `${routeMatch[1].toUpperCase()} ${routeMatch[2]}`;
      }
      // 2. Class definitions
      else if (/^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/.test(trimmed)) {
        const classMatch = trimmed.match(/class\s+([A-Za-z0-9_$]+)/);
        boundaryDetected = true;
        detectedType = 'class';
        detectedSymbol = classMatch ? classMatch[1] : null;
      }
      // 3. Named Functions or exported const arrows
      else if (/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.test(trimmed)) {
        const fnMatch = trimmed.match(/function\s+([A-Za-z0-9_$]+)/);
        boundaryDetected = true;
        detectedType = 'function';
        detectedSymbol = fnMatch ? fnMatch[1] : null;
      } else if (/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/.test(trimmed)) {
        const arrowMatch = trimmed.match(/(?:const|let|var)\s+([A-Za-z0-9_$]+)/);
        boundaryDetected = true;
        detectedType = 'function';
        detectedSymbol = arrowMatch ? arrowMatch[1] : null;
      }
    } else if (isPython) {
      // Python def or class
      if (/^def\s+([A-Za-z0-9_]+)\s*\(/.test(trimmed)) {
        const pyFn = trimmed.match(/^def\s+([A-Za-z0-9_]+)/);
        boundaryDetected = true;
        detectedType = 'function';
        detectedSymbol = pyFn ? pyFn[1] : null;
      } else if (/^class\s+([A-Za-z0-9_]+)/.test(trimmed)) {
        const pyClass = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
        boundaryDetected = true;
        detectedType = 'class';
        detectedSymbol = pyClass ? pyClass[1] : null;
      }
    }

    // When a new structural boundary is encountered and current chunk is long enough
    if (boundaryDetected && currentChunkLines.length >= 10) {
      flushChunk(lineNum - 1);
      chunkStartLine = lineNum;
      currentSymbolName = detectedSymbol;
      currentChunkType = detectedType;
    } else if (boundaryDetected && !currentSymbolName) {
      currentSymbolName = detectedSymbol;
      currentChunkType = detectedType;
    }

    currentChunkLines.push(line);

    // Hard limit chunk size to ~60 lines to keep context tight for MiniLM and Gemini
    if (currentChunkLines.length >= 65) {
      flushChunk(lineNum);
      chunkStartLine = lineNum + 1;
    }
  }

  // Flush remaining lines
  flushChunk(lines.length);

  return chunks;
}
