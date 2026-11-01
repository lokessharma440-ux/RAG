import fs from 'fs';
import path from 'path';

/**
 * RAG Security Attack Simulator Test Runner & Metric Collector
 */
export class SecurityTestRunner {
  constructor(options = {}) {
    this.environment = options.environment || 'local_test';
    this.target = options.target || 'http://localhost:5000/api';
    this.results = [];
    this.startTime = Date.now();
  }

  /**
   * Records a security test case outcome.
   */
  record({
    testId,
    category,
    description,
    severity = 'HIGH', // CRITICAL, HIGH, MEDIUM, LOW, INFO
    syntheticUser,
    documentScope,
    payload,
    expectedBehavior,
    actualResult,
    status, // 'PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR'
    deterministic = true,
    evidence = '',
    error = null,
  }) {
    this.results.push({
      testId,
      category,
      description,
      severity,
      syntheticUser: syntheticUser || 'synthetic_attacker',
      documentScope: documentScope || [],
      payload: typeof payload === 'string' ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 300),
      expectedBehavior,
      actualResult: typeof actualResult === 'string' ? actualResult.slice(0, 300) : JSON.stringify(actualResult).slice(0, 300),
      status,
      deterministic,
      evidence: evidence ? evidence.slice(0, 500) : '',
      error: error ? error.message : null,
      timestamp: new Date().toISOString(),
    });

    const statusSymbol = status === 'PASS' ? '✔' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${statusSymbol} [${status}] [${testId}] ${description}`);
  }

  /**
   * Computes standardized security evaluation metrics with strict, unambiguous denominators.
   */
  computeMetrics() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.status === 'PASS').length;
    const failed = this.results.filter((r) => r.status === 'FAIL').length;
    const inconclusive = this.results.filter((r) => r.status === 'INCONCLUSIVE').length;
    const errors = this.results.filter((r) => r.status === 'ERROR').length;

    // 1. Attack Success Rate: Prohibited security bypasses achieved / Total attack attempts
    // (A failed security test means the attack succeeded against the system)
    const attackAttempts = this.results.filter((r) =>
      ['DIRECT_PROMPT_INJECTION', 'INDIRECT_PROMPT_INJECTION', 'CROSS_USER_ISOLATION', 'CACHE_POISONING_ATTACK'].includes(r.category)
    );
    const successfulAttacks = attackAttempts.filter((r) => r.status === 'FAIL').length;
    const attackSuccessRate = attackAttempts.length > 0 ? (successfulAttacks / attackAttempts.length) * 100 : 0;

    // 2. Sensitive Information Leakage Rate
    const secretTests = this.results.filter((r) => r.category === 'SYNTHETIC_SECRET_LEAKAGE');
    const secretLeaks = secretTests.filter((r) => r.status === 'FAIL').length;
    const leakageRate = secretTests.length > 0 ? (secretLeaks / secretTests.length) * 100 : 0;

    // 3. Cross-User Isolation Violation Rate
    const isolationTests = this.results.filter((r) => r.category === 'CROSS_USER_ISOLATION');
    const isolationViolations = isolationTests.filter((r) => r.status === 'FAIL').length;
    const isolationViolationRate = isolationTests.length > 0 ? (isolationViolations / isolationTests.length) * 100 : 0;

    // 4. Unauthorized Retrieval Rate
    const retrievalTests = this.results.filter((r) => r.category === 'RETRIEVAL_CITATION_SECURITY');
    const retrievalBypasses = retrievalTests.filter((r) => r.status === 'FAIL').length;
    const unauthorizedRetrievalRate = retrievalTests.length > 0 ? (retrievalBypasses / retrievalTests.length) * 100 : 0;

    // 5. Overall Security Test Pass Rate
    const securityPassRate = total > 0 ? (passed / total) * 100 : 0;

    return {
      total,
      passed,
      failed,
      inconclusive,
      errors,
      attackAttempts: attackAttempts.length,
      successfulAttacks,
      attackSuccessRate: attackSuccessRate.toFixed(1) + '%',
      sensitiveLeakageRate: leakageRate.toFixed(1) + '%',
      isolationViolationRate: isolationViolationRate.toFixed(1) + '%',
      unauthorizedRetrievalRate: unauthorizedRetrievalRate.toFixed(1) + '%',
      securityPassRate: securityPassRate.toFixed(1) + '%',
      durationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Generates machine-readable JSON and human-readable Markdown security report.
   */
  generateReports(outputDir) {
    const metrics = this.computeMetrics();

    // 1. JSON Report
    const jsonPath = path.join(outputDir, 'rag-security-results.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          environment: this.environment,
          target: this.target,
          executedAt: new Date().toISOString(),
          metrics,
          results: this.results,
        },
        null,
        2
      )
    );

    // 2. Markdown Human-Readable Report
    const mdPath = path.join(outputDir, 'RAG_SECURITY_AUDIT_REPORT.md');
    let md = `# RAG SECURITY AUDIT REPORT: DEVMIND AI

**Environment:** \`${this.environment}\` (Synthetic Local Sandbox)  
**Executed At:** ${new Date().toUTCString()}  
**Target:** DevMind AI Document RAG Pipeline, Cache & Query Rewriter  
**Total Test Cases:** ${metrics.total}  

---

## 1. Executive Summary & Core Security Metrics

| Metric | Measured Value | Definition & Denominator |
| :--- | :---: | :--- |
| **Security Test Pass Rate** | **${metrics.securityPassRate}** | Passed tests (${metrics.passed}) / Total test cases (${metrics.total}) |
| **Attack Success Rate** | **${metrics.attackSuccessRate}** | Successful attacks (${metrics.successfulAttacks}) / Total attack attempts (${metrics.attackAttempts}) |
| **Sensitive Leakage Rate** | **${metrics.sensitiveLeakageRate}** | Synthetic secret disclosures / Total secret leakage test attempts |
| **Cross-User Violation Rate** | **${metrics.isolationViolationRate}** | Unauthorized tenant data reads / Total cross-user isolation tests |
| **Unauthorized Retrieval Rate** | **${metrics.unauthorizedRetrievalRate}** | Out-of-scope chunk inclusions / Total retrieval authorization tests |
| **Inconclusive / Errors** | **${metrics.inconclusive + metrics.errors}** | Network timeouts, schema errors, or non-deterministic variance |

---

## 2. Test Category Breakdown

| Category | Total | Pass | Fail | Inconclusive | Error |
| :--- | :---: | :---: | :---: | :---: | :---: |
`;

    const categories = [...new Set(this.results.map((r) => r.category))];
    for (const cat of categories) {
      const items = this.results.filter((r) => r.category === cat);
      const p = items.filter((r) => r.status === 'PASS').length;
      const f = items.filter((r) => r.status === 'FAIL').length;
      const inc = items.filter((r) => r.status === 'INCONCLUSIVE').length;
      const err = items.filter((r) => r.status === 'ERROR').length;
      md += `| **${cat}** | ${items.length} | ${p} | ${f} | ${inc} | ${err} |\n`;
    }

    md += `\n---

## 3. Detailed Security Findings & Evidence

`;

    for (const res of this.results) {
      const icon = res.status === 'PASS' ? '✔' : res.status === 'FAIL' ? '❌' : '⚠️';
      md += `### ${icon} [${res.testId}] ${res.description}\n`;
      md += `- **Category:** \`${res.category}\` | **Severity:** \`${res.severity}\`\n`;
      md += `- **Status:** **${res.status}** (${res.deterministic ? 'Deterministic' : 'Model-dependent'})\n`;
      md += `- **Expected Behavior:** ${res.expectedBehavior}\n`;
      md += `- **Controlled Payload:** \`${res.payload.replace(/\n/g, ' ')}\`\n`;
      md += `- **Actual Outcome:** ${res.actualResult.replace(/\n/g, ' ')}\n`;
      if (res.evidence) {
        md += `- **Evidence:** ${res.evidence}\n`;
      }
      md += `\n`;
    }

    md += `---

## 4. Remediation Recommendations & Safety Boundaries

1. **System Prompt / Excerpt Boundary Integrity:**
   - Always wrap retrieved document excerpts in strict isolation tokens (\`--- BEGIN CONTEXT ---\` / \`--- END CONTEXT ---\`) and declare all document text as untrusted raw data.
2. **Deterministic Data Layer Enforcements:**
   - Multi-tenant security must NEVER rely on LLM alignment alone. The Mongoose query filter \`{ userId, status: 'ready' }\` must always enforce boundary limits at the database driver level.
3. **Semantic Cache Scope Pinning:**
   - Cache keys must incorporate the SHA-256 hash of active authorized document IDs and modification timestamps. User B must never share cache keys with User A.
4. **Query Rewriting Constraints:**
   - The query rewriter must never alter the user's permission scope or invent document target IDs.

---
*Generated by DevMind AI Automated RAG Red-Team Simulator.*
`;

    fs.writeFileSync(mdPath, md);
    return { jsonPath, mdPath, metrics };
  }
}

