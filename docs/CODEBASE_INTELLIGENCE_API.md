# DevMind AI: Codebase Intelligence API Reference

## Overview
All endpoints for the DevMind AI Codebase Intelligence platform are mounted under the base route:
```
/api/codebases
```

### Authentication & Authorization
* **Session Mechanism:** JSON Web Token (JWT) transmitted via secure, HTTP-only cookie (`auth_token`).
* **Header Authorization:** Alternatively supports `Authorization: Bearer <token>`.
* **Tenant Isolation:** Every request is strictly scoped to the authenticated user (`req.user._id`). Request body `userId` parameters are untrusted and ignored. Attempting to access another tenant's repository yields an immediate `404 Not Found` or `403 Forbidden`.

---

## 1. Repository Management

### 1.1 Import GitHub Repository
Ingests a public GitHub repository by URL, downloads its source tarball/zip archive, discovers supported files, generates 384-dimensional vector embeddings, and builds relationship indexes.

* **Endpoint:** `POST /api/codebases/github`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "repoUrl": "https://github.com/octocat/Hello-World",
  "branch": "master"
}
```
* **Success Response (`201 Created`):**
```json
{
  "success": true,
  "message": "Repository imported and queued for indexing",
  "data": {
    "_id": "671e21bfa982bc401e8a0001",
    "name": "Hello-World",
    "sourceType": "github",
    "sourceUrl": "https://github.com/octocat/Hello-World",
    "defaultBranch": "master",
    "status": "READY",
    "totalFiles": 12,
    "indexedFiles": 12,
    "totalChunks": 28,
    "languages": ["javascript", "json", "markdown"],
    "createdAt": "2026-10-27T10:00:00.000Z"
  }
}
```

---

### 1.2 Upload ZIP Repository
Uploads a local repository archive (`.zip`). Enforces multi-layered archive security (path traversal protection, max 50MB archive, max 100MB uncompressed, 20x max expansion ratio, and max 2500 entries).

* **Endpoint:** `POST /api/codebases/upload`
* **Content-Type:** `multipart/form-data`
* **Form Fields:**
  * `zipFile` (Binary file, `.zip` only)
  * `name` (String, optional custom repository name)
* **Success Response (`201 Created`):**
```json
{
  "success": true,
  "message": "ZIP archive extracted and indexed successfully",
  "data": {
    "_id": "671e21bfa982bc401e8a0002",
    "name": "my-express-api",
    "sourceType": "zip",
    "status": "READY",
    "totalFiles": 24,
    "indexedFiles": 24,
    "totalChunks": 65
  }
}
```

---

### 1.3 List Repositories
Lists all repositories owned by the authenticated tenant.

* **Endpoint:** `GET /api/codebases`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "671e21bfa982bc401e8a0001",
      "name": "Hello-World",
      "sourceType": "github",
      "status": "READY",
      "indexedFiles": 12,
      "totalChunks": 28,
      "lastIndexedAt": "2026-10-27T10:00:05.000Z"
    }
  ]
}
```

---

### 1.4 Get Repository Details & Ingestion Status
Fetches metadata, verified file counts, indexing state, and commit SHA for a specific repository.

* **Endpoint:** `GET /api/codebases/:id`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "_id": "671e21bfa982bc401e8a0001",
    "name": "Hello-World",
    "sourceType": "github",
    "sourceUrl": "https://github.com/octocat/Hello-World",
    "defaultBranch": "master",
    "indexedCommitSha": "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    "status": "READY",
    "statusMessage": "Repository indexing completed successfully",
    "totalFiles": 12,
    "indexedFiles": 12,
    "failedFiles": 0,
    "totalChunks": 28,
    "languages": ["javascript", "json", "markdown"]
  }
}
```

---

### 1.5 Cascade Delete Repository
Deletes the repository record and cascade removes all associated `RepositoryFiles`, `CodeChunks`, and `CodeRelationships` from MongoDB.

* **Endpoint:** `DELETE /api/codebases/:id`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "message": "Repository and all associated indexed data deleted successfully"
}
```

---

### 1.6 Re-Index Repository
Triggers incremental re-indexing using SHA-256 content hashes to avoid re-embedding unchanged files.

* **Endpoint:** `POST /api/codebases/:id/reindex`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "message": "Repository re-indexing completed successfully",
  "data": {
    "status": "READY",
    "indexedFiles": 12,
    "totalChunks": 28
  }
}
```

---

## 2. File Explorer & Code Viewer

### 2.1 List Repository Files
Retrieves all discovered and indexed files with relative path, programming language, size, and total line count.

* **Endpoint:** `GET /api/codebases/:id/files`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "count": 12,
  "data": [
    {
      "_id": "671e21bfa982bc401e8a0010",
      "relativePath": "src/controllers/authController.js",
      "language": "javascript",
      "extension": ".js",
      "fileSize": 1820,
      "lineCount": 64
    }
  ]
}
```

---

### 2.2 Get File Content & Citation Range
Returns full source code with redacted sensitive secrets and exact line-range bounds for the Code Viewer.

* **Endpoint:** `GET /api/codebases/:id/files/content?path=src/controllers/authController.js`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "relativePath": "src/controllers/authController.js",
    "language": "javascript",
    "lineCount": 64,
    "content": "const jwt = require('jsonwebtoken');\n\nexports.login = async (req, res) => {\n  ..."
  }
}
```

---

## 3. Codebase Q&A (RAG Engine)

### 3.1 Grounded Codebase Chat
Executes hybrid retrieval (vector similarity + exact symbol-name match + file-path boost) and generates a truthful answer using the LLM provider abstraction.

* **Endpoint:** `POST /api/codebases/:id/chat`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "query": "How does user authentication and session management work in this codebase?"
}
```
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "answer": "Authentication is managed via JSON Web Tokens (JWT). When a user logs in, `authController.js` validates credentials and signs a token with `process.env.JWT_SECRET`. The token is stored in an HTTP-only cookie by `authMiddleware.js`, which verifies incoming requests.",
    "sources": [
      {
        "citation": "src/controllers/authController.js:15-32",
        "relativePath": "src/controllers/authController.js",
        "startLine": 15,
        "endLine": 32,
        "symbolName": "login",
        "chunkType": "function",
        "score": 0.842
      },
      {
        "citation": "src/middleware/authMiddleware.js:8-25",
        "relativePath": "src/middleware/authMiddleware.js",
        "startLine": 8,
        "endLine": 25,
        "symbolName": "protectRoute",
        "chunkType": "function",
        "score": 0.791
      }
    ]
  }
}
```

---

## 4. Dependencies & Impact Analysis

### 4.1 Dependency Graph
Retrieves cross-file relationship nodes and edges extracted during repository indexing.

* **Endpoint:** `GET /api/codebases/:id/dependencies`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "totalNodes": 12,
    "totalRelationships": 26,
    "nodes": [
      { "id": "src/routes/authRoutes.js", "label": "authRoutes.js", "type": "route" },
      { "id": "src/controllers/authController.js", "label": "authController.js", "type": "controller" }
    ],
    "edges": [
      {
        "source": "src/routes/authRoutes.js",
        "target": "src/controllers/authController.js",
        "type": "imports",
        "symbol": "login",
        "lineNumber": 4
      }
    ]
  }
}
```

---

### 4.2 Downstream Impact Analysis
Traces what modules, API endpoints, or database models are affected if a specific file or symbol changes.

* **Endpoint:** `GET /api/codebases/:id/impact?target=authController`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "target": "authController",
    "riskLevel": "HIGH",
    "summary": "Target \"authController\" is imported by 2 dependent files and tied to 3 exposed API routes.",
    "affectedFiles": [
      "src/routes/authRoutes.js",
      "src/server.js"
    ],
    "affectedRoutes": [
      { "route": "POST /api/auth/login", "file": "src/routes/authRoutes.js", "line": 12 },
      { "route": "POST /api/auth/register", "file": "src/routes/authRoutes.js", "line": 18 }
    ]
  }
}
```

---

## 5. Security & Documentation

### 5.1 Static Security Audit
Runs deterministic pattern analysis across all indexed files to flag dangerous patterns (eval, dynamic imports, injection vulnerabilities, unauthenticated routes, and insecure cookie configs).

* **Endpoint:** `POST /api/codebases/:id/security-analysis`
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "SEC-001",
      "severity": "CRITICAL",
      "title": "Arbitrary Code Execution via eval()",
      "filePath": "src/utils/calculator.js",
      "startLine": 14,
      "endLine": 14,
      "codeExcerpt": "const result = eval(expression);",
      "riskExplanation": "Direct execution of dynamic JavaScript code allows remote code execution if input is user-supplied.",
      "remediation": "Replace dynamic eval() with a safe math expression parser or static lookup."
    }
  ]
}
```

---

### 5.2 Synthesize Documentation
Generates grounded Markdown documentation using verified codebase evidence.

* **Endpoint:** `POST /api/codebases/:id/documentation`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "docType": "architecture" // 'architecture' | 'api' | 'models' | 'setup'
}
```
* **Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "docType": "architecture",
    "documentation": "# Architecture Overview\n\n## Core Services\n- **Backend:** Express.js REST API...\n- **Storage:** MongoDB models for User and Document...\n- **Authentication:** JWT HTTP-only cookies..."
  }
}
```

---

## 6. Error Response Convention
All error responses adhere to the standard MERN RAG API format:
```json
{
  "success": false,
  "error": "Error message explanation",
  "correlationId": "corr-1730018400000-abc123"
}
```
* `400 Bad Request`: Validation failure (e.g., malformed GitHub URL or unsupported archive).
* `401 Unauthorized`: Missing or invalid session JWT cookie.
* `404 Not Found`: Repository not found or belongs to another user.
* `429 Too Many Requests`: Rate limit reached.
* `500 Internal Server Error`: Safe sanitized error message with request correlation ID.
