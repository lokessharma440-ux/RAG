# DevMind AI — Documentation Generation Technical Guide

---

## 1. Overview

The DevMind AI Documentation Generation Engine reverse-engineers technical documentation directly from repository source code, AST symbols, route configurations, data models, and manifest files.

The engine supports 10 distinct document types:

| Document Type | Standard File Path | Target Information |
| :--- | :--- | :--- |
| `readme` | `README.md` | High-level project summary, setup instructions, prerequisites, and run commands. |
| `architecture` | `ARCHITECTURE.md` | Module structure, request flows, service boundaries, data pipelines, and Mermaid diagrams. |
| `prd` | `PRD.md` | Reverse-engineered Product Requirements Document inferred from code implementations. |
| `api` | `API.md` | Endpoint inventory, HTTP methods, controllers, parameters, and authentication requirements. |
| `database` | `DATABASE_SCHEMA.md` | Collections, schemas, relationships, indices, and validation rules. |
| `security` | `SECURITY.md` | Authentication controls, session models, input validation, and security guidelines. |
| `contributing` | `CONTRIBUTING.md` | Developer workflow, linting, testing expectations, and contribution conventions. |
| `testing` | `TESTING.md` | Test frameworks, available suites, test commands, and detected coverage gaps. |
| `deployment` | `DEPLOYMENT.md` | Verified build commands, Docker configuration, and environment setup. |
| `environment` | `ENVIRONMENT_VARIABLES.md` | Environment variable names, purpose, and defaults (no secret values). |

---

## 2. Reverse-Engineered PRD Rules

A key requirement in DevMind AI is the handling of Product Requirements Documents:

> **CRITICAL RULE:** A PRD contains product requirements and intended behavior, which cannot always be inferred with certainty from source code.

When no author-approved PRD exists in the repository, DevMind AI automatically generates a **Reverse-Engineered PRD** adhering to these strict rules:

1. **Mandatory Header:** The document begins with an explicit notice:
   ```markdown
   # Reverse-Engineered PRD — Inferred From Existing Implementation

   > **NOTICE**: This Product Requirements Document was automatically reverse-engineered from source code evidence. It describes inferred functionality and does not represent an author-approved product specification.
   ```
2. **Explicit Separation of Confirmed vs. Inferred:**
   - **Confirmed Features:** Grounded in registered routes, models, and UI components.
   - **Inferred Intent:** Clearly labeled with `[INFERRED]`.
   - **Open Questions:** Highlights areas where business logic is ambiguous and requires human product-owner clarification.

---

## 3. Workflow & In-Place Editing

```
[Repository Files]
        ↓
[Context Selection & Filtering]
        ↓
[Prompt Injection Guard Injection]
        ↓
[LLM Provider Generation (Gemini / Mock)]
        ↓
[Quality Validation & Warnings]
        ↓
[Save to GeneratedDocument in MongoDB]
        ↓
[Interactive Cosmic Split-View Editor]
        ↓
[User In-Place Edits Saved (userEdited: true)]
        ↓
[One-Click Markdown Download / ZIP Bundle / GitHub PR]
```

1. **Generation:** Users select any missing or incomplete document from the inventory dashboard and click **Generate**.
2. **Review:** The document appears in the Cosmic Review Workspace with side-by-side markdown and rendered HTML preview.
3. **Edit:** Users can click **Edit**, make custom amendments, and click **Save**. The document is updated in MongoDB and tagged as `userEdited: true`.
4. **Export:** Users can download the file directly, export all approved documents as a ZIP bundle, or open an automated GitHub PR.
