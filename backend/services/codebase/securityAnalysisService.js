import { RepositoryFile } from '../../models/RepositoryFile.js';

const SECURITY_RULES = [
  {
    id: 'SEC-001',
    title: 'Unsafe Dynamic Code Execution',
    severity: 'Critical',
    confidence: 'Confirmed',
    regex: /\b(eval\s*\(|new\s+Function\s*\(|vm\.runInContext|child_process\.exec\s*\()/g,
    riskExplanation: 'Executing dynamically constructed code strings can lead to arbitrary Remote Code Execution (RCE) if user input is passed.',
    conditions: 'Occurs when unvalidated user input or external data reaches the execution call.',
    remediation: 'Avoid dynamic code execution entirely. Replace with safe AST parsers or predefined static mappings.',
  },
  {
    id: 'SEC-002',
    title: 'Potential NoSQL / Query Injection',
    severity: 'High',
    confidence: 'Probable',
    regex: /\$(?:where|regex\s*:\s*req\.(?:body|query))/gi,
    riskExplanation: 'Using unchecked user objects or $where operators in MongoDB queries allows attackers to bypass authentication or execute arbitrary JavaScript on the database.',
    conditions: 'Occurs when raw request body parameters are passed directly to Mongoose filter queries without schema type coercion.',
    remediation: 'Sanitize query inputs, reject object operators ($ne, $where), and strictly validate data types.',
  },
  {
    id: 'SEC-003',
    title: 'Potential Arbitrary File Path Traversal',
    severity: 'High',
    confidence: 'Probable',
    regex: /fs\.(?:readFile|createReadStream|unlink|rm)\s*\([^)]*req\.(?:query|params|body)/gi,
    riskExplanation: 'Directly interpolating client-supplied file paths into filesystem operations allows directory traversal (e.g. "../../../etc/passwd").',
    conditions: 'User controls filename or file path parameter without path.resolve() / boundary check.',
    remediation: 'Validate input against an alphanumeric allowlist, resolve path canonicalization, and verify it starts with the designated upload directory.',
  },
  {
    id: 'SEC-004',
    title: 'Overly Permissive CORS Configuration',
    severity: 'Medium',
    confidence: 'Confirmed',
    regex: /cors\s*\(\s*{\s*origin\s*:\s*['"]\*['"]\s*,\s*credentials\s*:\s*true/gi,
    riskExplanation: 'Configuring wildcard CORS origin ("*") alongside credentials allows cross-origin attackers to steal authenticated session cookies.',
    conditions: 'Attacker hosts malicious website that triggers credentialed cross-origin requests.',
    remediation: 'Explicitly specify allowed origins and enforce strict same-site cookies.',
  },
  {
    id: 'SEC-005',
    title: 'Insecure Cookie Storage (Missing httpOnly)',
    severity: 'Medium',
    confidence: 'Confirmed',
    regex: /res\.cookie\s*\([^)]*httpOnly\s*:\s*false/gi,
    riskExplanation: 'Cookies created without httpOnly: true can be read by malicious JavaScript in case of Cross-Site Scripting (XSS).',
    conditions: 'XSS vulnerability present on the page.',
    remediation: 'Always set httpOnly: true, secure: true (in production), and sameSite: "strict" or "lax".',
  },
  {
    id: 'SEC-006',
    title: 'Hardcoded Secret or Credentials in Code',
    severity: 'High',
    confidence: 'Probable',
    regex: /(?:jwt_secret|api_key|password|db_pass)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,
    riskExplanation: 'Committing hardcoded secrets into version control exposes credentials to unauthorized parties and makes key rotation difficult.',
    conditions: 'Repository is accessed by unauthorized users or leaked publicly.',
    remediation: 'Move all secrets to environment variables (.env) and access via process.env.',
  },
];

/**
 * Scans repository files using deterministic security rules and produces structured, evidence-backed findings.
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @returns {Promise<Array<Object>>} Structured findings
 */
export async function runSecurityAudit(repositoryId, ownerUserId) {
  const files = await RepositoryFile.find({ repositoryId, ownerUserId }).select('relativePath content language');
  const findings = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    for (const rule of SECURITY_RULES) {
      // Test regex across file
      const matches = file.content.matchAll(rule.regex);

      for (const match of matches) {
        const matchIndex = match.index;
        // Compute line number
        const lineNumber = file.content.substring(0, matchIndex).split('\n').length;
        const startLine = Math.max(1, lineNumber - 1);
        const endLine = Math.min(lines.length, lineNumber + 2);
        const excerpt = lines.slice(startLine - 1, endLine).join('\n');

        findings.push({
          id: `${rule.id}-${file.relativePath}-${lineNumber}`,
          ruleId: rule.id,
          title: rule.title,
          severity: rule.severity,
          confidence: rule.confidence,
          filePath: file.relativePath,
          startLine,
          endLine,
          codeExcerpt: excerpt,
          riskExplanation: rule.riskExplanation,
          conditions: rule.conditions,
          remediation: rule.remediation,
        });
      }
    }
  }

  return findings;
}
