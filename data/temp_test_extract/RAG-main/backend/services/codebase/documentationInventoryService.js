/**
 * documentationInventoryService.js
 *
 * Inspects a repository's indexed files to build a documentation inventory
 * and detect inconsistencies between docs and code.
 */

import { RepositoryFile } from '../../models/RepositoryFile.js';

// ─── Document type definitions ─────────────────────────────────────────────────

const DOC_DEFINITIONS = [
  {
    docType: 'readme',
    documentPath: 'README.md',
    patterns: [/\/?readme\.md$/i],
    description: 'Project overview, installation, and usage guide',
    minContentLength: 500,
    requiredSections: ['install', 'usage', 'getting started'],
  },
  {
    docType: 'architecture',
    documentPath: 'ARCHITECTURE.md',
    patterns: [/\/?architecture\.md$/i, /\/?docs\/architecture\.md$/i],
    description: 'System architecture and component overview',
    minContentLength: 200,
    requiredSections: ['architecture', 'component', 'service', 'module', 'diagram'],
  },
  {
    docType: 'prd',
    documentPath: 'PRD.md',
    patterns: [/\/?prd\.md$/i, /\/?product-requirements\.md$/i, /\/?requirements\.md$/i],
    description: 'Product requirements document',
    minContentLength: 200,
    requiredSections: [],
  },
  {
    docType: 'api',
    documentPath: 'API.md',
    patterns: [/\/?api\.md$/i, /\/?docs\/api\.md$/i, /\/?api-reference\.md$/i],
    description: 'API endpoint documentation',
    minContentLength: 200,
    requiredSections: ['endpoint', 'route', 'request', 'response'],
  },
  {
    docType: 'database',
    documentPath: 'DATABASE_SCHEMA.md',
    patterns: [
      /\/?database_schema\.md$/i,
      /\/?database\.md$/i,
      /\/?schema\.md$/i,
      /\/?docs\/database\.md$/i,
    ],
    description: 'Database schema and model documentation',
    minContentLength: 200,
    requiredSections: [],
  },
  {
    docType: 'security',
    documentPath: 'SECURITY.md',
    patterns: [/\/?security\.md$/i, /\/?docs\/security\.md$/i],
    description: 'Security policy and vulnerability reporting',
    minContentLength: 100,
    requiredSections: [],
  },
  {
    docType: 'contributing',
    documentPath: 'CONTRIBUTING.md',
    patterns: [/\/?contributing\.md$/i],
    description: 'Contribution guidelines',
    minContentLength: 100,
    requiredSections: [],
  },
  {
    docType: 'testing',
    documentPath: 'TESTING.md',
    patterns: [/\/?testing\.md$/i, /\/?test\.md$/i, /\/?docs\/testing\.md$/i],
    description: 'Testing strategy and instructions',
    minContentLength: 100,
    requiredSections: [],
  },
  {
    docType: 'deployment',
    documentPath: 'DEPLOYMENT.md',
    patterns: [/\/?deployment\.md$/i, /\/?deploy\.md$/i, /\/?docs\/deployment\.md$/i],
    description: 'Deployment and infrastructure guide',
    minContentLength: 100,
    requiredSections: [],
  },
  {
    docType: 'environment',
    documentPath: '.env.example',
    patterns: [/\.env\.example$/i, /\.env\.sample$/i, /\.env\.template$/i],
    description: 'Environment variable template',
    minContentLength: 10,
    requiredSections: [],
  },
];

// ─── Status constants ─────────────────────────────────────────────────────────

const STATUS = {
  PRESENT_AND_REVIEWED: 'PRESENT_AND_REVIEWED',
  PRESENT_BUT_INCOMPLETE: 'PRESENT_BUT_INCOMPLETE',
  MISSING: 'MISSING',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * buildDocumentationInventory
 *
 * Scans the indexed repository files and produces a documentation inventory.
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @returns {Promise<Array<{docType, documentPath, status, evidence, recommendedAction, priority}>>}
 */
export async function buildDocumentationInventory(repositoryId, ownerUserId) {
  const files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
    'relativePath content lineCount fileSize'
  );

  const inventory = [];

  for (let i = 0; i < DOC_DEFINITIONS.length; i++) {
    const def = DOC_DEFINITIONS[i];
    const matchedFile = files.find((f) => def.patterns.some((pat) => pat.test(f.relativePath)));

    if (!matchedFile) {
      inventory.push({
        docType: def.docType,
        documentPath: def.documentPath,
        status: STATUS.MISSING,
        evidence: `No file matching ${def.patterns.map((p) => p.source).join(', ')} found.`,
        recommendedAction: `Generate ${def.documentPath} — ${def.description}.`,
        priority: i + 1,
      });
      continue;
    }

    const content = matchedFile.content || '';
    const issues = [];

    // Length check
    if (content.length < def.minContentLength) {
      issues.push(
        `Content is very short (${content.length} chars, minimum recommended ${def.minContentLength}).`
      );
    }

    // Required sections check
    for (const section of def.requiredSections) {
      if (!content.toLowerCase().includes(section)) {
        issues.push(`Missing section covering "${section}".`);
      }
    }

    const status =
      issues.length === 0 ? STATUS.PRESENT_AND_REVIEWED : STATUS.PRESENT_BUT_INCOMPLETE;

    inventory.push({
      docType: def.docType,
      documentPath: matchedFile.relativePath,
      status,
      evidence:
        issues.length > 0
          ? issues.join(' ')
          : `Found at ${matchedFile.relativePath} (${content.length} chars).`,
      recommendedAction:
        issues.length > 0
          ? `Update ${matchedFile.relativePath}: ${issues.join('; ')}`
          : 'Document is present and appears complete.',
      priority: i + 1,
    });
  }

  return inventory;
}

/**
 * detectDocumentationInconsistencies
 *
 * Compares existing documentation against the indexed code to surface potential
 * inconsistencies. All findings are based on textual evidence only.
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @param {Array} [files] - Pre-loaded RepositoryFile documents
 * @returns {Promise<Array<{type, description, filePath, evidence}>>}
 */
export async function detectDocumentationInconsistencies(repositoryId, ownerUserId, files = null) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath content lineCount'
    );
  }

  const inconsistencies = [];

  // ── 1. README mentions port that doesn't match server code ──────────────
  const readmeFile = files.find((f) => /\/?readme\.md$/i.test(f.relativePath));
  const serverFile = files.find((f) => /(?:server|app|index)\.[jt]s$/.test(f.relativePath));

  if (readmeFile && serverFile) {
    const readmePorts = [...readmeFile.content.matchAll(/:\s*(\d{4,5})/g)].map((m) => m[1]);
    const serverPorts = [...serverFile.content.matchAll(/PORT\s*[=|]\s*(\d{4,5})/g)].map((m) => m[1]);

    const onlyInReadme = readmePorts.filter(
      (p) => serverPorts.length > 0 && !serverPorts.includes(p)
    );
    if (onlyInReadme.length > 0) {
      inconsistencies.push({
        type: 'port_mismatch',
        description: `README references port(s) ${onlyInReadme.join(', ')} that do not match server configuration.`,
        filePath: readmeFile.relativePath,
        evidence: `README ports: ${readmePorts.join(', ')}; Server ports: ${serverPorts.join(', ')}`,
      });
    }
  }

  // ── 2. Documented env vars not present in .env.example ──────────────────
  const envExampleFile = files.find((f) => /\.env\.example$/i.test(f.relativePath));
  if (readmeFile && envExampleFile) {
    // Find env vars mentioned in README
    const readmeEnvVars = [
      ...readmeFile.content.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g),
    ]
      .map((m) => m[1])
      .filter((v) => !['README', 'API', 'URL', 'HTTP', 'HTTPS', 'JSON'].includes(v));

    const exampleEnvVars = new Set(
      [...envExampleFile.content.matchAll(/^([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
    );

    const missingFromExample = readmeEnvVars.filter(
      (v) => !exampleEnvVars.has(v) && /^[A-Z][A-Z0-9_]{3,}$/.test(v)
    );

    if (missingFromExample.length > 0) {
      inconsistencies.push({
        type: 'env_var_not_in_example',
        description: `README references env vars that are not in .env.example: ${missingFromExample.slice(0, 5).join(', ')}.`,
        filePath: readmeFile.relativePath,
        evidence: `Referenced: ${missingFromExample.slice(0, 5).join(', ')}`,
      });
    }
  }

  // ── 3. API docs reference endpoints not found in route files ────────────
  const apiDocFile = files.find((f) => /\/?api\.md$/i.test(f.relativePath));
  if (apiDocFile) {
    const docEndpoints = [
      ...apiDocFile.content.matchAll(/(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s'")\]]+)/gi),
    ].map((m) => m[1].toLowerCase());

    const routeFiles = files.filter(
      (f) => f.content && /route|controller/i.test(f.relativePath)
    );
    const codeEndpoints = routeFiles.flatMap((f) =>
      [...f.content.matchAll(/router\.(get|post|put|patch|delete)\s*\(['"`](\/[^'"`)]*)/gi)].map(
        (m) => m[2].toLowerCase()
      )
    );

    const onlyInDocs = docEndpoints.filter(
      (ep) => !codeEndpoints.some((ce) => ce.includes(ep) || ep.includes(ce))
    );
    if (onlyInDocs.length > 0) {
      inconsistencies.push({
        type: 'api_endpoint_in_docs_not_in_code',
        description: `API.md documents endpoint(s) that were not found in route files: ${onlyInDocs.slice(0, 3).join(', ')}`,
        filePath: apiDocFile.relativePath,
        evidence: `Documented endpoints not matched: ${onlyInDocs.slice(0, 3).join(', ')}`,
      });
    }
  }

  return inconsistencies;
}
