import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const SUPPORTED_EXTENSIONS = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.php': 'php',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'shell',
};

export const SUPPORTED_FILENAMES = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

export const IGNORE_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'env',
  '.idea',
  '.vscode',
  'target',
  'bin',
  'obj',
  '.cache',
]);

export const IGNORE_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  '.ds_store',
  'thumbs.db',
]);

const SECRET_PATTERNS = [
  // AWS Access Key ID
  { name: 'AWS Access Key', regex: /\b(AKIA[0-9A-Z]{16})\b/g },
  // RSA / SSH / EC Private Key
  { name: 'Private Key', regex: /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/g },
  // GitHub Personal Access Token
  { name: 'GitHub Token', regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g },
  // Slack Token
  { name: 'Slack Token', regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g },
  // Database Connection URL with password
  { name: 'Database Credentials', regex: /(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/g, replaceGroup: true },
  { name: 'Postgres Credentials', regex: /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/g, replaceGroup: true },
  { name: 'MySQL Credentials', regex: /(mysql:\/\/[^:]+:)([^@]+)(@)/g, replaceGroup: true },
  // Generic High-Entropy API key assignment
  { name: 'API Key', regex: /(api[_-]?key\s*[:=]\s*["'])([A-Za-z0-9_\-]{24,})(["'])/gi, replaceGroup: true },
  { name: 'Secret Token', regex: /(secret[_-]?token\s*[:=]\s*["'])([A-Za-z0-9_\-]{24,})(["'])/gi, replaceGroup: true },
];

/**
 * Detects and redacts potential sensitive tokens and secrets from source text.
 * Never stores or returns unredacted secret values.
 *
 * @param {string} text
 * @returns {{ cleanText: string, secretsFoundCount: number, detectedTypes: string[] }}
 */
export function detectAndRedactSecrets(text) {
  if (!text || typeof text !== 'string') {
    return { cleanText: '', secretsFoundCount: 0, detectedTypes: [] };
  }

  let cleanText = text;
  let secretsFoundCount = 0;
  const detectedTypes = new Set();

  for (const { name, regex, replaceGroup } of SECRET_PATTERNS) {
    if (replaceGroup) {
      cleanText = cleanText.replace(regex, (match, prefix, secret, suffix) => {
        secretsFoundCount++;
        detectedTypes.add(name);
        return `${prefix}[REDACTED_${name.toUpperCase().replace(/\s+/g, '_')}]${suffix}`;
      });
    } else {
      cleanText = cleanText.replace(regex, (match) => {
        secretsFoundCount++;
        detectedTypes.add(name);
        return `[REDACTED_${name.toUpperCase().replace(/\s+/g, '_')}]`;
      });
    }
  }

  return {
    cleanText,
    secretsFoundCount,
    detectedTypes: Array.from(detectedTypes),
  };
}

/**
 * Computes sha256 hash of a string buffer.
 *
 * @param {string} content
 * @returns {string} Hex hash
 */
export function computeContentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Scans a directory and discovers all indexable source code files.
 * Enforces extension whitelist, ignore lists, binary checks, and size caps.
 *
 * @param {string} baseDir - Extracted repository directory.
 * @param {string} [rootPrefix=''] - Optional top-level subfolder from archive.
 * @param {number} [maxIndividualFileBytes=500000] - Skip files larger than 500KB.
 * @returns {Promise<Array<{ relativePath: string, fullPath: string, language: string, extension: string, sizeBytes: number, content: string, contentHash: string, lineCount: number }>>}
 */
export async function discoverRepositoryFiles(baseDir, rootPrefix = '', maxIndividualFileBytes = 500000) {
  const searchRoot = rootPrefix ? path.join(baseDir, rootPrefix) : baseDir;
  const discoveredFiles = [];

  async function traverse(currentDir, relativePrefix = '') {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryName = entry.name;
      const lowerName = entryName.toLowerCase();

      if (entry.isDirectory()) {
        if (IGNORE_DIRECTORIES.has(lowerName) || lowerName.startsWith('.')) {
          continue;
        }
        await traverse(path.join(currentDir, entryName), path.join(relativePrefix, entryName));
      } else if (entry.isFile()) {
        if (IGNORE_FILES.has(lowerName) || lowerName.endsWith('.min.js') || lowerName.endsWith('.min.css')) {
          continue;
        }

        const ext = path.extname(lowerName);
        let language = SUPPORTED_EXTENSIONS[ext];

        if (!language && SUPPORTED_FILENAMES[lowerName]) {
          language = SUPPORTED_FILENAMES[lowerName];
        }

        if (!language) {
          continue; // Skip unsupported file types
        }

        const fullPath = path.join(currentDir, entryName);
        const relativePath = path.join(relativePrefix, entryName).replace(/\\/g, '/');

        const stats = await fs.promises.stat(fullPath);
        if (stats.size === 0 || stats.size > maxIndividualFileBytes) {
          continue; // Skip empty files or files exceeding individual file cap
        }

        // Read and verify text is not binary
        const buffer = await fs.promises.readFile(fullPath);
        if (buffer.includes(0)) {
          continue; // Contains null byte -> binary file
        }

        const rawContent = buffer.toString('utf8');
        const { cleanText } = detectAndRedactSecrets(rawContent);
        const contentHash = computeContentHash(cleanText);
        const lineCount = cleanText.split('\n').length;

        discoveredFiles.push({
          relativePath,
          fullPath,
          language,
          extension: ext || entryName.toLowerCase(),
          sizeBytes: stats.size,
          content: cleanText,
          contentHash,
          lineCount,
        });
      }
    }
  }

  if (fs.existsSync(searchRoot)) {
    await traverse(searchRoot);
  }

  return discoveredFiles;
}
