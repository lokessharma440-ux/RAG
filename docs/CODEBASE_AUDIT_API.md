# DevMind AI — Codebase Auditor REST API Reference

**Base URL:** `/api/codebases`  
**Authentication:** Required on all endpoints (HTTP-only JWT cookie or `Authorization: Bearer <token>`)  
**Format:** `application/json`  

---

## 1. Codebase Analysis Endpoints

### 1.1 Initiate Codebase Audit

Triggers an asynchronous multi-category static analysis audit of an indexed repository.

- **Method:** `POST`
- **Route:** `/:repositoryId/analyze`
- **Rate Limit:** 20 requests / hour per user/IP
- **Headers:** `Content-Type: application/json`
- **Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Codebase audit initiated successfully.",
  "data": {
    "analysisId": "6720da59e4b0123456789abc",
    "status": "pending"
  }
}
```

### 1.2 Get Latest Analysis

Retrieves the most recent audit results for a repository.

- **Method:** `GET`
- **Route:** `/:repositoryId/analysis`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "_id": "6720da59e4b0123456789abc",
    "repositoryId": "6720d910e4b0123456789aaa",
    "commitSha": "3f82a19b456c",
    "analysisVersion": "1.0",
    "status": "completed",
    "detectedStack": {
      "projectType": "node",
      "frameworks": ["express", "react", "mongoose"],
      "languages": ["javascript", "json"],
      "packageManager": "npm",
      "hasTests": true,
      "hasDocker": false,
      "hasCICD": true,
      "hasDocumentation": true
    },
    "summary": "Completed audit for devmind-app (node stack). Identified 12 findings...",
    "categorySummaries": {
      "architecture": "Found 1 architecture finding(s): 1 MEDIUM.",
      "authentication": "Found 2 authentication finding(s): 1 HIGH, 1 MEDIUM.",
      "apiQuality": "No API quality issues detected."
    },
    "findings": [...],
    "recommendations": [...],
    "startedAt": "2026-10-29T05:00:00.000Z",
    "completedAt": "2026-10-29T05:00:08.000Z"
  }
}
```

### 1.3 Lightweight Polling Status

Retrieves real-time execution status and progress percentage.

- **Method:** `GET`
- **Route:** `/:repositoryId/analysis/status`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "analysisId": "6720da59e4b0123456789abc",
    "status": "running",
    "percentage": 60,
    "message": "Scanning architecture, security patterns, dependencies, and code quality...",
    "startedAt": "2026-10-29T05:00:00.000Z"
  }
}
```

### 1.4 Get Analysis History

Lists previous audit runs for the repository.

- **Method:** `GET`
- **Route:** `/:repositoryId/analysis/history`
- **Response (200 OK):**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "6720da59e4b0123456789abc",
      "commitSha": "3f82a19b456c",
      "status": "completed",
      "startedAt": "2026-10-29T05:00:00.000Z",
      "completedAt": "2026-10-29T05:00:08.000Z",
      "findingsCount": 12,
      "recommendationsCount": 7,
      "createdAt": "2026-10-29T05:00:00.000Z"
    }
  ]
}
```

---

## 2. Findings & Recommendations Endpoints

### 2.1 Filterable Findings

Retrieves findings from the latest completed audit with filtering and pagination.

- **Method:** `GET`
- **Route:** `/:repositoryId/findings`
- **Query Parameters:**
  - `severity`: `CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `INFO` | `ALL`
  - `category`: `architecture` | `authentication` | `apiQuality` | `frontendQuality` | `database` | `dependencies` | `testing` | `deployment` | `performance` | `ALL`
  - `verificationStatus`: `VERIFIED_STATIC_PATTERN` | `TOOL_CONFIRMED` | `NEEDS_MANUAL_REVIEW` | `ALL`
  - `search`: String search in title, description, or file path
  - `page`: Integer (default 1)
  - `limit`: Integer (default 50)
- **Response (200 OK):**
```json
{
  "success": true,
  "total": 12,
  "page": 1,
  "limit": 50,
  "count": 12,
  "data": [
    {
      "id": "f8a9e2d1-4321-4b12-9c10-1a2b3c4d5e6f",
      "category": "authentication",
      "title": "Insecure cookie configuration (httpOnly: false)",
      "description": "A cookie is set with httpOnly: false, allowing client-side scripts to read the cookie value.",
      "severity": "HIGH",
      "confidence": "HIGH",
      "verificationStatus": "VERIFIED_STATIC_PATTERN",
      "filePath": "server.js",
      "startLine": 12,
      "endLine": null,
      "evidence": "res.cookie('token', token, { httpOnly: false });",
      "impact": "If the application has an XSS vulnerability, an attacker can steal session cookies.",
      "recommendation": "Set httpOnly: true on all sensitive session and authentication cookies.",
      "effort": "low",
      "references": []
    }
  ]
}
```

### 2.2 Prioritized Recommendations

Retrieves actionable recommendations ordered by priority.

- **Method:** `GET`
- **Route:** `/:repositoryId/recommendations`
- **Query Parameters:**
  - `category`: Category string
  - `effort`: `low` | `medium` | `high`
- **Response (200 OK):**
```json
{
  "success": true,
  "count": 7,
  "data": [
    {
      "id": "rec-1a2b3c4d",
      "category": "authentication",
      "title": "Enforce HttpOnly and Secure flags on session cookies",
      "problem": "Session cookies are accessible to client-side JavaScript, exposing them to XSS attacks.",
      "whyItMatters": "XSS vulnerabilities can be upgraded to full account takeover if session tokens can be read.",
      "recommendedChange": "Update cookie configuration in authentication middleware to specify httpOnly: true, secure: process.env.NODE_ENV === 'production', and sameSite: 'strict'.",
      "expectedBenefit": "Prevents token theft via XSS.",
      "effort": "low",
      "risk": "low",
      "relevantFiles": ["server.js"],
      "verificationSteps": ["Inspect Set-Cookie header in login response to verify HttpOnly is present."],
      "priority": 1
    }
  ]
}
```

---

## 3. Documentation Endpoints

### 3.1 Documentation Inventory

Scans repository files and reports documentation gaps and code/doc drift.

- **Method:** `GET`
- **Route:** `/:repositoryId/documentation/inventory`
- **Response (200 OK):**
```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "docType": "architecture",
      "documentPath": "ARCHITECTURE.md",
      "status": "MISSING",
      "evidence": "No file matching /architecture\\.md/ found.",
      "recommendedAction": "Generate ARCHITECTURE.md — System architecture and component overview.",
      "priority": 2
    },
    {
      "docType": "readme",
      "documentPath": "README.md",
      "status": "PRESENT_BUT_INCOMPLETE",
      "evidence": "README is short (120 chars) and missing standard sections (install, usage).",
      "recommendedAction": "Expand README.md with installation and usage instructions.",
      "priority": 1
    }
  ]
}
```

### 3.2 Generate Document

Generates a grounded markdown file using the LLM provider abstraction.

- **Method:** `POST`
- **Route:** `/:repositoryId/documentation/generate`
- **Request Body:**
```json
{
  "documentType": "architecture"
}
```
- **Valid Types:** `readme`, `architecture`, `prd`, `api`, `database`, `security`, `contributing`, `testing`, `deployment`, `environment`
- **Response (201 Created):**
```json
{
  "success": true,
  "message": "Generated \"ARCHITECTURE.md\" successfully.",
  "data": {
    "documentId": "6720db10e4b0123456789abd",
    "documentPath": "ARCHITECTURE.md",
    "documentType": "architecture",
    "content": "# System Architecture\n\n## Component Overview...",
    "references": ["server.js:1-40", "package.json"],
    "validationWarnings": [],
    "createdAt": "2026-10-29T05:02:00.000Z"
  }
}
```

### 3.3 List Generated Documents

- **Method:** `GET`
- **Route:** `/:repositoryId/documentation/generated`

### 3.4 Update Generated Document (User In-Place Edit)

- **Method:** `PATCH`
- **Route:** `/:repositoryId/documentation/generated/:documentId`
- **Request Body:**
```json
{
  "content": "# Modified Documentation Content\n\nEdited by user."
}
```

### 3.5 Download Single File

- **Method:** `GET`
- **Route:** `/:repositoryId/documentation/generated/:documentId/download`
- **Headers:** `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="ARCHITECTURE.md"`

### 3.6 Download Documentation ZIP Bundle

Packages selected or all generated documentation into a sanitised ZIP archive with `MANIFEST.json`.

- **Method:** `POST`
- **Route:** `/:repositoryId/documentation/download-bundle`
- **Request Body (optional):**
```json
{
  "documentIds": ["6720db10e4b0123456789abd", "6720db20e4b0123456789abe"]
}
```
- **Headers:** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="devmind_docs_repo_1730178000.zip"`

---

## 4. GitHub Pull Request Publishing

### 4.1 Create Pull Request

Creates a dedicated feature branch and opens a Pull Request on GitHub.

- **Method:** `POST`
- **Route:** `/:repositoryId/github/pull-request`
- **Request Body:**
```json
{
  "documentIds": ["6720db10e4b0123456789abd"],
  "targetBranch": "main",
  "prTitle": "docs: add AI-generated architecture documentation",
  "prBody": "Automated documentation generated by DevMind AI Codebase Auditor.",
  "githubToken": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```
- **Safety Policy:**
  - Token is used strictly transiently and is never stored in MongoDB or logs.
  - Never modifies the target branch directly.
  - Branch format: `devmind/docs-update-YYYY-MM-DD-<rand>`.
- **Response (201 Created):**
```json
{
  "success": true,
  "message": "Pull Request successfully created at https://github.com/owner/repo/pull/42",
  "data": {
    "pullRequestUrl": "https://github.com/owner/repo/pull/42",
    "pullRequestNumber": 42,
    "generatedBranch": "devmind/docs-update-2026-10-29-a1b2c3",
    "targetBranch": "main",
    "publishedCount": 1
  }
}
```

### 4.2 List Publications

- **Method:** `GET`
- **Route:** `/:repositoryId/github/publications`
