/**
 * codebaseAuditService.js
 *
 * Comprehensive static-analysis audit of an indexed repository.
 * All findings are grounded in actual evidence from RepositoryFile content —
 * no invented CVE numbers, benchmark numbers, or fake metrics.
 */

import { randomUUID } from 'crypto';
import { RepositoryFile } from '../../models/RepositoryFile.js';
import { Codebase } from '../../models/Codebase.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a normalised finding object.
 */
function makeFinding({
  category,
  title,
  description,
  severity,
  confidence = 'MEDIUM',
  verificationStatus = 'VERIFIED_STATIC_PATTERN',
  filePath = null,
  startLine = null,
  endLine = null,
  evidence = '',
  impact = '',
  recommendation = '',
  effort = 'medium',
  references = [],
  commitSha = null,
}) {
  return {
    id: randomUUID(),
    category,
    title,
    description,
    severity,
    confidence,
    verificationStatus,
    filePath,
    startLine,
    endLine,
    evidence,
    impact,
    recommendation,
    effort,
    references,
    analysisCommitSha: commitSha,
  };
}

/**
 * Scan a file's content for a regex pattern and return the first match
 * along with approximate line number.
 */
function findInContent(content, pattern) {
  const match = pattern.exec(content);
  if (!match) return null;
  const linesBefore = content.slice(0, match.index).split('\n');
  const lineNumber = linesBefore.length;
  const excerpt = match[0].slice(0, 200);
  return { lineNumber, excerpt };
}

/**
 * Get files matching a filename pattern.
 */
function getFilesByName(files, pattern) {
  return files.filter((f) => pattern.test(f.relativePath));
}

// ─── 1. Project Structure Detection ───────────────────────────────────────────

/**
 * analyzeProjectStructure
 * Detects project type, frameworks, languages, tooling, etc.
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @param {Array} files - RepositoryFile documents (may be pre-loaded)
 * @returns {Object} stack descriptor
 */
export async function analyzeProjectStructure(repositoryId, ownerUserId, files = null) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language extension fileSize lineCount content'
    );
  }

  const paths = files.map((f) => f.relativePath.toLowerCase());

  // ── Language detection ──────────────────────────────────────────────────
  const languageSet = new Set(files.map((f) => f.language).filter(Boolean));
  const languages = [...languageSet];

  // ── Project type ────────────────────────────────────────────────────────
  let projectType = 'unknown';
  let packageManager = null;
  const frameworks = [];
  const evidence = {};

  const hasPackageJson = paths.some((p) => p === 'package.json' || p.endsWith('/package.json'));
  const hasRequirementsTxt = paths.some((p) => p === 'requirements.txt' || p.endsWith('/requirements.txt'));
  const hasPomXml = paths.some((p) => p === 'pom.xml' || p.endsWith('/pom.xml'));
  const hasGoMod = paths.some((p) => p === 'go.mod' || p.endsWith('/go.mod'));
  const hasCargoToml = paths.some((p) => p === 'cargo.toml' || p.endsWith('/cargo.toml'));
  const hasGemfile = paths.some((p) => p === 'gemfile' || p.endsWith('/gemfile'));
  const hasBuildGradle = paths.some((p) => p.endsWith('build.gradle') || p.endsWith('build.gradle.kts'));

  if (hasPackageJson) {
    projectType = 'node';
    evidence.packageJson = true;
    const pkgFile = files.find((f) => /\/?package\.json$/.test(f.relativePath));
    if (pkgFile && pkgFile.content) {
      let pkg = {};
      try {
        pkg = JSON.parse(pkgFile.content);
      } catch {
        pkg = {};
      }
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      // Detect package manager
      if (paths.some((p) => p === 'pnpm-lock.yaml' || p.endsWith('/pnpm-lock.yaml'))) {
        packageManager = 'pnpm';
      } else if (paths.some((p) => p === 'yarn.lock' || p.endsWith('/yarn.lock'))) {
        packageManager = 'yarn';
      } else if (paths.some((p) => p === 'package-lock.json' || p.endsWith('/package-lock.json'))) {
        packageManager = 'npm';
      }

      // Framework detection
      if (allDeps['react'] || allDeps['react-dom']) frameworks.push('react');
      if (allDeps['next'] || allDeps['next.js']) frameworks.push('nextjs');
      if (allDeps['vue']) frameworks.push('vue');
      if (allDeps['svelte']) frameworks.push('svelte');
      if (allDeps['@angular/core']) frameworks.push('angular');
      if (allDeps['express']) frameworks.push('express');
      if (allDeps['fastify']) frameworks.push('fastify');
      if (allDeps['koa']) frameworks.push('koa');
      if (allDeps['hapi'] || allDeps['@hapi/hapi']) frameworks.push('hapi');
      if (allDeps['mongoose']) frameworks.push('mongoose');
      if (allDeps['prisma'] || allDeps['@prisma/client']) frameworks.push('prisma');
      if (allDeps['typeorm']) frameworks.push('typeorm');
      if (allDeps['nestjs'] || allDeps['@nestjs/core']) frameworks.push('nestjs');
      if (allDeps['graphql']) frameworks.push('graphql');
    }
  } else if (hasRequirementsTxt) {
    projectType = 'python';
    packageManager = 'pip';
    evidence.requirementsTxt = true;
    const reqFile = files.find((f) => /\/?requirements\.txt$/.test(f.relativePath));
    if (reqFile && reqFile.content) {
      const content = reqFile.content.toLowerCase();
      if (content.includes('django')) frameworks.push('django');
      if (content.includes('flask')) frameworks.push('flask');
      if (content.includes('fastapi')) frameworks.push('fastapi');
      if (content.includes('sqlalchemy')) frameworks.push('sqlalchemy');
    }
  } else if (hasPomXml) {
    projectType = 'java';
    packageManager = 'maven';
    frameworks.push('spring');
    evidence.pomXml = true;
  } else if (hasBuildGradle) {
    projectType = 'java';
    packageManager = 'gradle';
    evidence.buildGradle = true;
  } else if (hasGoMod) {
    projectType = 'go';
    packageManager = 'go-modules';
    evidence.goMod = true;
  } else if (hasCargoToml) {
    projectType = 'rust';
    packageManager = 'cargo';
    evidence.cargoToml = true;
  } else if (hasGemfile) {
    projectType = 'ruby';
    packageManager = 'bundler';
    frameworks.push('rails');
    evidence.gemfile = true;
  }

  // ── Tooling detection ───────────────────────────────────────────────────
  const hasTests =
    files.some(
      (f) =>
        /\.(test|spec)\.[jt]sx?$/.test(f.relativePath) ||
        /__tests__/.test(f.relativePath) ||
        /\/tests?\//.test(f.relativePath) ||
        /\/spec\//.test(f.relativePath) ||
        /test_.*\.py$/.test(f.relativePath) ||
        /.*_test\.go$/.test(f.relativePath)
    );

  const hasDocker =
    paths.some((p) => /dockerfile/.test(p) || p === 'docker-compose.yml' || p === 'docker-compose.yaml');

  const hasCICD =
    paths.some(
      (p) =>
        p.includes('.github/workflows') ||
        p === 'jenkinsfile' ||
        p.includes('/jenkinsfile') ||
        p.includes('.circleci/config') ||
        p.includes('.travis.yml') ||
        p.includes('gitlab-ci.yml') ||
        p.includes('.gitlab-ci.yml') ||
        p.includes('bitbucket-pipelines.yml') ||
        p.includes('azure-pipelines.yml')
    );

  const hasDocumentation = paths.some(
    (p) =>
      p === 'readme.md' ||
      p.endsWith('/readme.md') ||
      p === 'architecture.md' ||
      p.endsWith('/architecture.md') ||
      p === 'docs/readme.md'
  );

  return {
    projectType,
    frameworks,
    languages,
    packageManager,
    hasTests,
    hasDocker,
    hasCICD,
    hasDocumentation,
    evidence,
  };
}

// ─── 2. Architecture Analysis ─────────────────────────────────────────────────

export async function runArchitectureAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  // Large files (>500 lines)
  for (const file of files) {
    if ((file.lineCount || 0) > 500) {
      findings.push(
        makeFinding({
          category: 'architecture',
          title: 'Large file detected',
          description: `File \`${file.relativePath}\` has ${file.lineCount} lines, which may indicate it handles too many responsibilities.`,
          severity: 'INFO',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: file.relativePath,
          startLine: 1,
          endLine: file.lineCount,
          evidence: `Line count: ${file.lineCount}`,
          impact: 'Large files are harder to maintain, test, and review.',
          recommendation: 'Consider splitting this file into smaller, focused modules.',
          effort: 'medium',
          commitSha,
        })
      );
    }
  }

  // No test files
  if (!stack.hasTests) {
    findings.push(
      makeFinding({
        category: 'architecture',
        title: 'No test files detected',
        description: 'No test or spec files were found in the repository.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        verificationStatus: 'VERIFIED_STATIC_PATTERN',
        evidence: 'Scanned all repository files; found no *.test.*, *.spec.*, __tests__/ or tests/ directories.',
        impact: 'Without automated tests, regressions may go undetected.',
        recommendation: 'Add unit and integration tests to critical modules.',
        effort: 'high',
        commitSha,
      })
    );
  }

  // Detect deeply-nested directories (>4 levels deep) — possible over-engineering
  const deepPaths = files.filter((f) => (f.relativePath.match(/\//g) || []).length > 4);
  if (deepPaths.length > 3) {
    findings.push(
      makeFinding({
        category: 'architecture',
        title: 'Deeply nested directory structure',
        description: `Found ${deepPaths.length} files more than 4 directory levels deep.`,
        severity: 'INFO',
        confidence: 'MEDIUM',
        verificationStatus: 'VERIFIED_STATIC_PATTERN',
        filePath: deepPaths[0].relativePath,
        evidence: deepPaths
          .slice(0, 3)
          .map((f) => f.relativePath)
          .join(', '),
        impact: 'Deep nesting can make navigation and imports difficult.',
        recommendation: 'Review whether deeply nested folders can be flattened or reorganised.',
        effort: 'low',
        commitSha,
      })
    );
  }

  // Check for a top-level error handler in Express/Node apps
  if (stack.frameworks && stack.frameworks.includes('express')) {
    const serverFiles = files.filter((f) =>
      /(?:server|app|index)\.[jt]sx?$/.test(f.relativePath)
    );
    const hasGlobalErrorHandler = serverFiles.some(
      (f) => f.content && /app\.use\s*\(\s*\(err,\s*req,\s*res,\s*next\)/.test(f.content)
    );
    if (!hasGlobalErrorHandler) {
      findings.push(
        makeFinding({
          category: 'architecture',
          title: 'Missing global error handler in Express app',
          description: 'No 4-argument Express error-handling middleware was detected.',
          severity: 'MEDIUM',
          confidence: 'MEDIUM',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          evidence: 'Searched for app.use((err, req, res, next) => ...) pattern — not found.',
          impact: 'Unhandled errors may expose stack traces or crash the server process.',
          recommendation:
            'Add a global error handler: app.use((err, req, res, next) => { ... }) at the end of your middleware chain.',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 3. Auth Analysis ─────────────────────────────────────────────────────────

export async function runAuthAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  // Only analyse auth if there is evidence the repo handles authentication
  const authFiles = files.filter(
    (f) =>
      f.content &&
      (/auth/i.test(f.relativePath) ||
        /jwt/i.test(f.content) ||
        /bcrypt/i.test(f.content) ||
        /passport/i.test(f.content) ||
        /session/i.test(f.content))
  );

  if (authFiles.length === 0) {
    // No auth code found — skip
    return findings;
  }

  for (const file of authFiles) {
    const content = file.content;

    // Hardcoded JWT secret
    const hardcodedSecret = findInContent(content, /(?:jwt\.sign|jwt_secret)\s*[=:]\s*['"][^'"]{6,}['"]/i);
    if (hardcodedSecret) {
      findings.push(
        makeFinding({
          category: 'authentication',
          title: 'Potential hardcoded JWT secret',
          description: 'A string literal that appears to be a JWT secret was found directly in source code.',
          severity: 'HIGH',
          confidence: 'MEDIUM',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: file.relativePath,
          startLine: hardcodedSecret.lineNumber,
          evidence: hardcodedSecret.excerpt,
          impact: 'Hardcoded secrets committed to source control can be extracted by anyone with repository access.',
          recommendation: 'Move JWT secrets to environment variables and rotate the exposed secret immediately.',
          effort: 'low',
          commitSha,
        })
      );
    }

    // Insecure cookie configuration (httpOnly: false)
    if (/res\.cookie\s*\(/i.test(content) && /httpOnly\s*:\s*false/i.test(content)) {
      const match = findInContent(content, /httpOnly\s*:\s*false/i);
      findings.push(
        makeFinding({
          category: 'authentication',
          title: 'Insecure cookie configuration (httpOnly: false)',
          description: 'A cookie is set with httpOnly: false, allowing client-side scripts to read the cookie value.',
          severity: 'HIGH',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: file.relativePath,
          startLine: match?.lineNumber,
          evidence: match?.excerpt || 'httpOnly: false',
          impact: 'If the application has a Cross-Site Scripting (XSS) vulnerability, an attacker can steal session cookies.',
          recommendation: 'Set httpOnly: true on all sensitive session and authentication cookies.',
          effort: 'low',
          commitSha,
        })
      );
    }

    // MD5 used for password hashing
    if (/md5/i.test(content) && /password/i.test(content)) {
      const match = findInContent(content, /md5\s*\(/i);
      if (match) {
        findings.push(
          makeFinding({
            category: 'authentication',
            title: 'MD5 used in context of password handling',
            description: 'MD5 is not suitable for password hashing due to its speed and lack of salting.',
            severity: 'HIGH',
            confidence: 'MEDIUM',
            verificationStatus: 'VERIFIED_STATIC_PATTERN',
            filePath: file.relativePath,
            startLine: match.lineNumber,
            evidence: match.excerpt,
            impact: 'Passwords hashed with MD5 can be cracked quickly using rainbow tables.',
            recommendation: 'Use bcrypt, argon2, or scrypt for password hashing.',
            effort: 'medium',
            commitSha,
          })
        );
      }
    }

    // JWT token stored in localStorage (in frontend code)
    if (/localStorage\s*\.\s*setItem\s*\(.*token/i.test(content)) {
      const match = findInContent(content, /localStorage\s*\.\s*setItem\s*\(.*token/i);
      if (match) {
        findings.push(
          makeFinding({
            category: 'authentication',
            title: 'JWT stored in localStorage',
            description: 'Storing JWTs in localStorage exposes them to XSS attacks.',
            severity: 'MEDIUM',
            confidence: 'HIGH',
            verificationStatus: 'VERIFIED_STATIC_PATTERN',
            filePath: file.relativePath,
            startLine: match.lineNumber,
            evidence: match.excerpt,
            impact: 'XSS can exfiltrate the token giving attackers full session access.',
            recommendation: 'Store JWTs in HttpOnly, Secure cookies instead of localStorage.',
            effort: 'medium',
            commitSha,
          })
        );
      }
    }

    // Missing password length validation
    if (/password/i.test(content) && !/minlength|min_length|\.length\s*[<>]/i.test(content)) {
      findings.push(
        makeFinding({
          category: 'authentication',
          title: 'Possible missing password length validation',
          description: 'Password fields found but no explicit minimum-length check detected.',
          severity: 'LOW',
          confidence: 'LOW',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          filePath: file.relativePath,
          evidence: 'Pattern search for minlength/min_length/.length comparison returned no results.',
          impact: 'Users may set very short passwords that are trivially brute-forced.',
          recommendation: 'Enforce a minimum password length (recommended ≥ 8 characters).',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 4. API Quality Analysis ──────────────────────────────────────────────────

export async function runAPIQualityAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  const routeFiles = files.filter(
    (f) => f.content && (/route|controller|handler/i.test(f.relativePath) || /router\./i.test(f.content))
  );

  if (routeFiles.length === 0) return findings;

  for (const file of routeFiles) {
    const content = file.content;

    // Missing try-catch in async route handlers
    const asyncHandlerCount = (content.match(/async\s*\(req,\s*res/g) || []).length;
    const tryCatchCount = (content.match(/try\s*{/g) || []).length;
    if (asyncHandlerCount > 0 && tryCatchCount < asyncHandlerCount) {
      findings.push(
        makeFinding({
          category: 'apiQuality',
          title: 'Async route handler(s) without try-catch',
          description: `${file.relativePath} has ${asyncHandlerCount} async handler(s) but only ${tryCatchCount} try-catch block(s).`,
          severity: 'MEDIUM',
          confidence: 'MEDIUM',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: file.relativePath,
          evidence: `async (req, res handlers: ${asyncHandlerCount}, try-catch blocks: ${tryCatchCount}`,
          impact: 'Unhandled promise rejections will crash the route without a useful error response.',
          recommendation: 'Wrap async route handlers in try-catch or use an async error wrapper.',
          effort: 'low',
          commitSha,
        })
      );
    }

    // Missing input validation (no Joi/express-validator/zod usage)
    if (
      !/joi|express-validator|zod|yup|celebrate|ajv/i.test(content) &&
      /(req\.body|req\.query|req\.params)/.test(content)
    ) {
      findings.push(
        makeFinding({
          category: 'apiQuality',
          title: 'No schema validation library detected',
          description: `${file.relativePath} reads from req.body/query/params but no validation library import was found.`,
          severity: 'MEDIUM',
          confidence: 'LOW',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          filePath: file.relativePath,
          evidence: 'No import of joi, zod, express-validator, yup, celebrate, or ajv detected.',
          impact: 'Unvalidated inputs may cause unexpected behaviour or security issues.',
          recommendation: 'Add input validation using zod, joi, or express-validator.',
          effort: 'medium',
          commitSha,
        })
      );
    }

    // Using wildcard CORS
    if (/cors\s*\(\s*\{\s*origin\s*:\s*['"`]\*['"`]/.test(content)) {
      const match = findInContent(content, /cors\s*\(\s*\{\s*origin\s*:\s*['"`]\*['"`]/);
      if (match) {
        findings.push(
          makeFinding({
            category: 'apiQuality',
            title: 'Wildcard CORS origin configured',
            description: 'CORS is configured to allow all origins (*), which may be too permissive.',
            severity: 'MEDIUM',
            confidence: 'HIGH',
            verificationStatus: 'VERIFIED_STATIC_PATTERN',
            filePath: file.relativePath,
            startLine: match.lineNumber,
            evidence: match.excerpt,
            impact: 'Any website can make cross-origin requests to this API with user credentials.',
            recommendation: 'Restrict CORS to known safe origins.',
            effort: 'low',
            commitSha,
          })
        );
      }
    }
  }

  return findings;
}

// ─── 5. Frontend Analysis ─────────────────────────────────────────────────────

export async function runFrontendAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  const isFrontend =
    stack.frameworks &&
    (stack.frameworks.includes('react') ||
      stack.frameworks.includes('vue') ||
      stack.frameworks.includes('angular') ||
      stack.frameworks.includes('svelte') ||
      stack.frameworks.includes('nextjs'));

  if (!isFrontend) return findings;

  const frontendFiles = files.filter((f) =>
    /\.[jt]sx?$/.test(f.relativePath) && !/node_modules/.test(f.relativePath)
  );

  // Very large components
  for (const file of frontendFiles) {
    if ((file.lineCount || 0) > 300 && /component|page|view/i.test(file.relativePath)) {
      findings.push(
        makeFinding({
          category: 'frontendQuality',
          title: 'Large UI component detected',
          description: `Component file \`${file.relativePath}\` has ${file.lineCount} lines, suggesting it may be doing too much.`,
          severity: 'LOW',
          confidence: 'MEDIUM',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: file.relativePath,
          evidence: `Line count: ${file.lineCount}`,
          impact: 'Large components are hard to test and reason about.',
          recommendation: 'Break large components into smaller, single-responsibility sub-components.',
          effort: 'medium',
          commitSha,
        })
      );
    }

    // dangerouslySetInnerHTML usage
    if (file.content && /dangerouslySetInnerHTML/i.test(file.content)) {
      const match = findInContent(file.content, /dangerouslySetInnerHTML/i);
      if (match) {
        findings.push(
          makeFinding({
            category: 'frontendQuality',
            title: 'dangerouslySetInnerHTML usage detected',
            description: 'Using dangerouslySetInnerHTML can introduce XSS vulnerabilities if the content is not sanitised.',
            severity: 'HIGH',
            confidence: 'HIGH',
            verificationStatus: 'VERIFIED_STATIC_PATTERN',
            filePath: file.relativePath,
            startLine: match.lineNumber,
            evidence: match.excerpt,
            impact: 'Injecting unsanitised HTML can allow XSS attacks.',
            recommendation:
              'Sanitise HTML content with DOMPurify before passing it to dangerouslySetInnerHTML, or use a safer alternative.',
            effort: 'medium',
            commitSha,
          })
        );
      }
    }
  }

  // Missing error boundaries (React)
  if (stack.frameworks && stack.frameworks.includes('react')) {
    const hasErrorBoundary = frontendFiles.some(
      (f) => f.content && /ErrorBoundary|componentDidCatch/i.test(f.content)
    );
    if (!hasErrorBoundary) {
      findings.push(
        makeFinding({
          category: 'frontendQuality',
          title: 'No React Error Boundary detected',
          description: 'No ErrorBoundary class component or componentDidCatch was found in the codebase.',
          severity: 'LOW',
          confidence: 'MEDIUM',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          evidence: 'Searched all JSX/TSX files for ErrorBoundary or componentDidCatch.',
          impact: 'An uncaught error in a component subtree will crash the whole React app.',
          recommendation: 'Add an ErrorBoundary component around major routes/sections.',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 6. Database Analysis ─────────────────────────────────────────────────────

export async function runDatabaseAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  const modelFiles = files.filter(
    (f) =>
      f.content &&
      (/model|schema|entity/i.test(f.relativePath) ||
        /mongoose\.Schema|sequelize\.define|@Entity/i.test(f.content))
  );

  if (modelFiles.length === 0) return findings;

  for (const file of modelFiles) {
    const content = file.content;

    // Missing index on commonly queried fields
    if (/mongoose\.Schema/.test(content) && !/\.index\s*\(/.test(content)) {
      findings.push(
        makeFinding({
          category: 'database',
          title: 'Mongoose schema without explicit indexes',
          description: `\`${file.relativePath}\` defines a Mongoose schema but no explicit .index() calls were found.`,
          severity: 'LOW',
          confidence: 'MEDIUM',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          filePath: file.relativePath,
          evidence: 'No .index() or compound index definitions found in schema.',
          impact: 'Queries without indexes perform full collection scans, degrading performance at scale.',
          recommendation:
            'Add appropriate indexes for frequently queried fields (e.g. userId, createdAt, status).',
          effort: 'low',
          commitSha,
        })
      );
    }

    // Missing validation on fields
    if (/mongoose\.Schema/.test(content) && !/(required\s*:\s*true|validate\s*:)/.test(content)) {
      findings.push(
        makeFinding({
          category: 'database',
          title: 'Mongoose schema fields missing required/validate constraints',
          description: `\`${file.relativePath}\` does not appear to define required or validate constraints on schema fields.`,
          severity: 'LOW',
          confidence: 'LOW',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          filePath: file.relativePath,
          evidence: 'No required: true or validate: patterns found.',
          impact: 'Invalid or missing data may be silently persisted.',
          recommendation: 'Add required, enum, min/max, and validate constraints where appropriate.',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 7. Dependency Analysis ───────────────────────────────────────────────────

export async function runDependencyAnalysis(repositoryId, ownerUserId, files = null) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content'
    );
  }

  const findings = [];
  const commitSha = null;

  // ── Node / npm ──────────────────────────────────────────────────────────
  const pkgFile = files.find((f) => /\/?package\.json$/.test(f.relativePath));
  if (pkgFile && pkgFile.content) {
    let pkg = {};
    try {
      pkg = JSON.parse(pkgFile.content);
    } catch {
      findings.push(
        makeFinding({
          category: 'dependencies',
          title: 'package.json is not valid JSON',
          description: `\`${pkgFile.relativePath}\` could not be parsed as JSON.`,
          severity: 'HIGH',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: pkgFile.relativePath,
          evidence: 'JSON.parse threw a SyntaxError.',
          impact: 'npm/yarn/pnpm will refuse to install dependencies.',
          recommendation: 'Fix the JSON syntax error in package.json.',
          effort: 'low',
          commitSha,
        })
      );
    }

    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    // Wildcard versions
    const wildcardDeps = Object.entries(deps).filter(([, v]) => v === '*' || v === 'latest');
    for (const [name, version] of wildcardDeps) {
      findings.push(
        makeFinding({
          category: 'dependencies',
          title: `Wildcard version specifier for "${name}"`,
          description: `Package "${name}" uses "${version}" as its version, which will always install the very latest release.`,
          severity: 'HIGH',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: pkgFile.relativePath,
          evidence: `"${name}": "${version}"`,
          impact: 'Breaking changes in future releases will be pulled in automatically.',
          recommendation: `Pin "${name}" to a specific semver range, e.g. "^${name}@latest_stable_version".`,
          effort: 'low',
          commitSha,
        })
      );
    }

    // No lockfile
    const hasLockfile = files.some(
      (f) =>
        /\/?package-lock\.json$/.test(f.relativePath) ||
        /\/?yarn\.lock$/.test(f.relativePath) ||
        /\/?pnpm-lock\.yaml$/.test(f.relativePath)
    );
    if (!hasLockfile && Object.keys(deps).length > 0) {
      findings.push(
        makeFinding({
          category: 'dependencies',
          title: 'No lockfile found',
          description: 'package.json has dependencies but no package-lock.json, yarn.lock, or pnpm-lock.yaml was found.',
          severity: 'MEDIUM',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: pkgFile.relativePath,
          evidence: 'Scanned all files; no lockfile detected.',
          impact:
            'Without a lockfile, different installs may resolve different dependency versions, causing inconsistent builds.',
          recommendation: 'Commit the lockfile generated by your package manager.',
          effort: 'low',
          commitSha,
        })
      );
    }

    // Empty dependencies
    if (Object.keys(deps).length === 0 && pkg.name) {
      findings.push(
        makeFinding({
          category: 'dependencies',
          title: 'package.json has no listed dependencies',
          description: 'Both dependencies and devDependencies are empty or missing.',
          severity: 'INFO',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: pkgFile.relativePath,
          evidence: 'dependencies: {}, devDependencies: {}',
          impact: 'May indicate an incomplete or misconfigured project manifest.',
          recommendation: 'Verify that all required packages are listed in package.json.',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  // ── Python / pip ────────────────────────────────────────────────────────
  const reqFile = files.find((f) => /\/?requirements\.txt$/.test(f.relativePath));
  if (reqFile && reqFile.content) {
    const lines = reqFile.content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    const unpinned = lines.filter((l) => !/[=><~!]/.test(l));
    if (unpinned.length > 0) {
      findings.push(
        makeFinding({
          category: 'dependencies',
          title: 'Unpinned Python dependencies',
          description: `${unpinned.length} package(s) in requirements.txt have no version constraint.`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: reqFile.relativePath,
          evidence: unpinned.slice(0, 5).join(', '),
          impact:
            'pip will install the latest version, which may introduce breaking changes or vulnerabilities.',
          recommendation: 'Pin all dependencies to exact versions (e.g. requests==2.31.0) and use pip-compile.',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 8. Testing Analysis ──────────────────────────────────────────────────────

export async function runTestingAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  const testFiles = files.filter(
    (f) =>
      /\.(test|spec)\.[jt]sx?$/.test(f.relativePath) ||
      /__tests__/.test(f.relativePath) ||
      /\/tests?\//.test(f.relativePath) ||
      /\/spec\//.test(f.relativePath) ||
      /test_.*\.py$/.test(f.relativePath) ||
      /.*_test\.go$/.test(f.relativePath)
  );

  if (testFiles.length === 0) {
    findings.push(
      makeFinding({
        category: 'testing',
        title: 'No test files found',
        description: 'The repository contains no detectable test files.',
        severity: 'HIGH',
        confidence: 'HIGH',
        verificationStatus: 'VERIFIED_STATIC_PATTERN',
        evidence:
          'Searched for *.test.*, *.spec.*, __tests__/, tests/, spec/, test_*.py, *_test.go — none found.',
        impact: 'Bugs and regressions cannot be caught automatically.',
        recommendation:
          'Add unit tests for core business logic and integration tests for API endpoints.',
        effort: 'high',
        commitSha,
      })
    );
  }

  // Check package.json for test script
  const pkgFile = files.find((f) => /\/?package\.json$/.test(f.relativePath));
  if (pkgFile && pkgFile.content) {
    let pkg = {};
    try {
      pkg = JSON.parse(pkgFile.content);
    } catch {
      pkg = {};
    }
    const scripts = pkg.scripts || {};
    if (!scripts.test || scripts.test === 'echo "Error: no test specified" && exit 1') {
      findings.push(
        makeFinding({
          category: 'testing',
          title: 'No test script configured in package.json',
          description: 'The "test" script in package.json is either missing or set to the default placeholder.',
          severity: 'MEDIUM',
          confidence: 'HIGH',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          filePath: pkgFile.relativePath,
          evidence: `scripts.test = ${JSON.stringify(scripts.test)}`,
          impact: 'CI pipelines running "npm test" will fail or produce no meaningful results.',
          recommendation: 'Set scripts.test to a real test runner command (e.g. "jest", "mocha", "vitest").',
          effort: 'low',
          commitSha,
        })
      );
    }

    // Coverage not configured
    if (
      testFiles.length > 0 &&
      !scripts.coverage &&
      !/coverage|c8|nyc/.test(JSON.stringify(scripts))
    ) {
      findings.push(
        makeFinding({
          category: 'testing',
          title: 'Test coverage not configured',
          description: 'Tests exist but no coverage script or coverage tool configuration was detected.',
          severity: 'LOW',
          confidence: 'MEDIUM',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          filePath: pkgFile.relativePath,
          evidence: 'No coverage, c8, or nyc reference found in scripts.',
          impact: 'Without coverage metrics it is impossible to gauge how much code is exercised by tests.',
          recommendation: 'Configure coverage reporting (e.g. jest --coverage, c8, or nyc).',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 9. Deployment Analysis ───────────────────────────────────────────────────

export async function runDeploymentAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  // No Dockerfile found for a non-trivial project
  if (!stack.hasDocker && files.length > 5) {
    findings.push(
      makeFinding({
        category: 'deployment',
        title: 'No Dockerfile or docker-compose.yml found',
        description: 'The repository has no Docker configuration files.',
        severity: 'LOW',
        confidence: 'MEDIUM',
        verificationStatus: 'NEEDS_MANUAL_REVIEW',
        evidence: 'Searched for Dockerfile, docker-compose.yml, docker-compose.yaml — none found.',
        impact: 'Deployment reproducibility is lower without containerisation.',
        recommendation: 'Consider adding a Dockerfile and docker-compose.yml for consistent deployments.',
        effort: 'medium',
        commitSha,
      })
    );
  }

  // Dockerfile: running as root
  const dockerfiles = getFilesByName(files, /dockerfile/i);
  for (const df of dockerfiles) {
    if (df.content && !/USER\s+(?!root)/i.test(df.content)) {
      findings.push(
        makeFinding({
          category: 'deployment',
          title: 'Dockerfile may run as root',
          description: `\`${df.relativePath}\` does not contain a USER instruction (or sets USER root).`,
          severity: 'MEDIUM',
          confidence: 'MEDIUM',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          filePath: df.relativePath,
          evidence: 'No "USER <non-root>" directive detected in Dockerfile.',
          impact: 'Container escapes are more dangerous when the process runs as root.',
          recommendation:
            'Add a non-root USER directive: RUN addgroup -S app && adduser -S app -G app && USER app',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  // No CI/CD
  if (!stack.hasCICD) {
    findings.push(
      makeFinding({
        category: 'deployment',
        title: 'No CI/CD configuration detected',
        description: 'No GitHub Actions, Jenkins, CircleCI, GitLab CI, or similar pipeline config was found.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        verificationStatus: 'VERIFIED_STATIC_PATTERN',
        evidence:
          'Scanned for .github/workflows/, Jenkinsfile, .circleci/, .travis.yml, .gitlab-ci.yml — none found.',
        impact: 'No automated build, test, or deployment pipeline means manual processes prone to errors.',
        recommendation: 'Add a CI/CD pipeline (e.g. GitHub Actions) to automate testing and deployment.',
        effort: 'medium',
        commitSha,
      })
    );
  }

  // Missing .env.example
  const hasEnvExample = files.some(
    (f) => /\.env\.example$/.test(f.relativePath) || /\.env\.sample$/.test(f.relativePath)
  );
  if (!hasEnvExample) {
    const hasEnvRef = files.some(
      (f) => f.content && /process\.env\.|os\.environ/i.test(f.content)
    );
    if (hasEnvRef) {
      findings.push(
        makeFinding({
          category: 'deployment',
          title: 'No .env.example file found',
          description:
            'The project uses environment variables but no .env.example or .env.sample template was found.',
          severity: 'LOW',
          confidence: 'MEDIUM',
          verificationStatus: 'VERIFIED_STATIC_PATTERN',
          evidence: 'process.env references found; .env.example not present.',
          impact: 'New developers and automated deployments lack documentation of required env vars.',
          recommendation:
            'Create a .env.example listing all required environment variables with placeholder values.',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 10. Performance Analysis ─────────────────────────────────────────────────

export async function runPerformanceAnalysis(repositoryId, ownerUserId, files = null, stack = {}) {
  if (!files) {
    files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
      'relativePath language content lineCount'
    );
  }

  const findings = [];
  const commitSha = null;

  for (const file of files) {
    if (!file.content) continue;
    const content = file.content;

    // Synchronous fs calls in production code (not tests)
    if (
      /readFileSync|writeFileSync|existsSync|mkdirSync/i.test(content) &&
      !/test|spec|__tests__/i.test(file.relativePath)
    ) {
      const match = findInContent(content, /readFileSync|writeFileSync|existsSync|mkdirSync/i);
      if (match) {
        findings.push(
          makeFinding({
            category: 'performance',
            title: 'Synchronous filesystem call in non-test code',
            description: `\`${file.relativePath}\` uses synchronous fs methods which block the Node.js event loop.`,
            severity: 'MEDIUM',
            confidence: 'HIGH',
            verificationStatus: 'VERIFIED_STATIC_PATTERN',
            filePath: file.relativePath,
            startLine: match.lineNumber,
            evidence: match.excerpt,
            impact: 'Blocking the event loop degrades throughput for all concurrent requests.',
            recommendation: 'Replace synchronous fs calls with their async equivalents (fs.promises.*).',
            effort: 'medium',
            commitSha,
          })
        );
      }
    }

    // MongoDB queries without .lean() (Mongoose performance tip)
    if (
      /mongoose|Model\.find|\.find\(/.test(content) &&
      !/.lean\(\)/.test(content) &&
      /\.find\(/.test(content)
    ) {
      findings.push(
        makeFinding({
          category: 'performance',
          title: 'Mongoose queries without .lean()',
          description: `\`${file.relativePath}\` has Mongoose .find() calls without .lean(), which returns full Mongoose documents.`,
          severity: 'INFO',
          confidence: 'LOW',
          verificationStatus: 'NEEDS_MANUAL_REVIEW',
          filePath: file.relativePath,
          evidence: '.find() calls present; .lean() not detected in this file.',
          impact: 'Full Mongoose documents are slower to create and more memory-intensive than plain objects.',
          recommendation:
            'Add .lean() to read-only queries where you do not need Mongoose document methods.',
          effort: 'low',
          commitSha,
        })
      );
    }
  }

  return findings;
}

// ─── 11. Generate Recommendations ────────────────────────────────────────────

export function generateRecommendations(allFindings, stack = {}) {
  const recommendations = [];
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  const effortOrder = { low: 0, medium: 1, high: 2 };

  // Group findings by category
  const byCategory = {};
  for (const f of allFindings) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  let priority = 1;
  for (const [category, catFindings] of Object.entries(byCategory)) {
    // Sort findings within category by severity desc
    const sorted = [...catFindings].sort(
      (a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
    );

    // Take the top findings and produce a recommendation
    const topFindings = sorted.slice(0, 3);
    const topSeverity = topFindings[0]?.severity || 'INFO';
    const topEffort = topFindings[0]?.effort || 'medium';

    const title =
      topFindings.length === 1
        ? topFindings[0].title
        : `Address ${topFindings.length} ${category} issues (most critical: ${topFindings[0].title})`;

    const relevantFiles = [
      ...new Set(topFindings.map((f) => f.filePath).filter(Boolean)),
    ];

    recommendations.push({
      id: randomUUID(),
      category,
      title,
      problem: topFindings.map((f) => `• ${f.title}: ${f.description}`).join('\n'),
      whyItMatters: topFindings.map((f) => f.impact).filter(Boolean).join(' '),
      evidence: topFindings
        .map((f) => (f.evidence ? `${f.filePath || '(project-wide)'}: ${f.evidence}` : ''))
        .filter(Boolean)
        .join('\n'),
      recommendedChange: topFindings.map((f) => `• ${f.recommendation}`).join('\n'),
      expectedBenefit: `Resolving these ${category} issues improves code quality and reduces risk.`,
      effort: topEffort,
      risk: topSeverity === 'CRITICAL' || topSeverity === 'HIGH' ? 'high' : 'low',
      prerequisites: [],
      relevantFiles,
      verificationSteps: [
        `Review the affected files listed under ${category}.`,
        'Apply the recommended changes.',
        'Re-run the codebase audit to confirm findings are resolved.',
      ],
      priority: priority++,
    });
  }

  // Sort final recommendations by severity of top finding
  recommendations.sort((a, b) => a.priority - b.priority);

  return recommendations;
}

// ─── 12. Full Audit Orchestrator ──────────────────────────────────────────────

/**
 * runFullCodebaseAudit
 * Orchestrates all analysis steps for a repository.
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @returns {Promise<{ stack, findings, recommendations, categorySummaries }>}
 */
export async function runFullCodebaseAudit(repositoryId, ownerUserId) {
  // Load all files once
  const files = await RepositoryFile.find({ repositoryId, ownerUserId }).select(
    'relativePath language extension fileSize lineCount content'
  );

  if (files.length === 0) {
    return {
      stack: { projectType: 'unknown', frameworks: [], languages: [], packageManager: null },
      findings: [],
      recommendations: [],
      categorySummaries: {},
    };
  }

  // Step 1: Detect project structure
  const stack = await analyzeProjectStructure(repositoryId, ownerUserId, files);

  // Step 2: Run all analysis passes in parallel for efficiency
  const [
    architectureFindings,
    authFindings,
    apiFindings,
    frontendFindings,
    databaseFindings,
    dependencyFindings,
    testingFindings,
    deploymentFindings,
    performanceFindings,
  ] = await Promise.all([
    runArchitectureAnalysis(repositoryId, ownerUserId, files, stack),
    runAuthAnalysis(repositoryId, ownerUserId, files, stack),
    runAPIQualityAnalysis(repositoryId, ownerUserId, files, stack),
    runFrontendAnalysis(repositoryId, ownerUserId, files, stack),
    runDatabaseAnalysis(repositoryId, ownerUserId, files, stack),
    runDependencyAnalysis(repositoryId, ownerUserId, files),
    runTestingAnalysis(repositoryId, ownerUserId, files, stack),
    runDeploymentAnalysis(repositoryId, ownerUserId, files, stack),
    runPerformanceAnalysis(repositoryId, ownerUserId, files, stack),
  ]);

  const allFindings = [
    ...architectureFindings,
    ...authFindings,
    ...apiFindings,
    ...frontendFindings,
    ...databaseFindings,
    ...dependencyFindings,
    ...testingFindings,
    ...deploymentFindings,
    ...performanceFindings,
  ];

  const recommendations = generateRecommendations(allFindings, stack);

  // Build category summaries
  const countBySeverity = (catFindings) => {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    for (const f of catFindings) counts[f.severity] = (counts[f.severity] || 0) + 1;
    return counts;
  };

  const summarise = (catFindings, label) => {
    if (catFindings.length === 0) return `No ${label} issues detected.`;
    const counts = countBySeverity(catFindings);
    const parts = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([sev, n]) => `${n} ${sev}`)
      .join(', ');
    return `Found ${catFindings.length} ${label} finding(s): ${parts}.`;
  };

  const categorySummaries = {
    architecture: summarise(architectureFindings, 'architecture'),
    authentication: summarise(authFindings, 'authentication'),
    apiQuality: summarise(apiFindings, 'API quality'),
    frontendQuality: summarise(frontendFindings, 'frontend quality'),
    database: summarise(databaseFindings, 'database'),
    dependencies: summarise(dependencyFindings, 'dependency'),
    testing: summarise(testingFindings, 'testing'),
    deployment: summarise(deploymentFindings, 'deployment'),
    performance: summarise(performanceFindings, 'performance'),
  };

  return { stack, findings: allFindings, recommendations, categorySummaries };
}
