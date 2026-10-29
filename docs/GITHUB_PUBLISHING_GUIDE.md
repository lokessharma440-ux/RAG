# DevMind AI — GitHub Publishing Security & Operations Guide

---

## 1. Overview & Safety Invariants

DevMind AI enables developers to publish approved, AI-generated or revised documentation directly to GitHub without ever requiring manual file copy-pasting.

To maintain security and prevent accidental disruption to production code, the publishing engine is bounded by the following rules:

1. **Never Touch Default Branches:** The system **never** directly pushes commits to `main`, `master`, or any designated default branch.
2. **Dedicated Feature Branches:** All publications create a distinct, isolated branch named:
   ```
   devmind/docs-update-YYYY-MM-DD-<6-char-random-hex>
   ```
3. **Explicit User Authorization:** A Pull Request is opened against the base branch, giving the developer complete control to review diffs and merge on GitHub.
4. **Transient Token Storage:** User-provided GitHub Personal Access Tokens (PAT) are used in-memory for the API call and are **never stored** in MongoDB, cached on disk, or logged.

---

## 2. Publishing Workflow

```
[Developer clicks "Create PR" in Cosmic Dashboard]
                   ↓
[Prompt for GitHub PAT with 'repo' scope]
                   ↓
[Fetch target branch head commit SHA]
                   ↓
[Create dedicated branch: devmind/docs-update-YYYY-MM-DD-<rand>]
                   ↓
[Commit approved documentation files to dedicated branch]
                   ↓
[Open Pull Request via GitHub REST API]
                   ↓
[Return Pull Request URL & clear token from memory]
```

---

## 3. GitHub Token Configuration

To publish documentation back to GitHub, generate a Personal Access Token:

1. Go to **GitHub Settings → Developer Settings → Personal access tokens → Tokens (classic)** (or Fine-grained tokens).
2. Generate a token with the following minimum scope:
   - `repo`: Full control of private repositories (or public repository access for public repos).
3. Copy the token into the DevMind AI **Create Pull Request** dialog in the Cosmic Dashboard.
4. The token is transmitted over TLS directly to the DevMind AI backend, used to execute the GitHub API calls, and discarded immediately after the response is sent.

---

## 4. Conflict Handling & Resolution

Before pushing each file, the publisher checks if the target file already exists on the remote branch:
- If the file exists, DevMind AI retrieves its existing Git blob SHA and passes it in the `PUT /repos/:owner/:repo/contents/:path` request.
- If remote changes have occurred since analysis, GitHub will reject the update with a 409 Conflict.
- DevMind AI reports the conflict directly in the dashboard UI, advising the user to pull the latest repository changes and re-run analysis.

---

## 5. Offline & Non-GitHub Fallback

For developers working without GitHub credentials or auditing private local repositories imported via ZIP archives:
- **Download Markdown:** Download individual `.md` files directly.
- **Download ZIP Bundle:** Export all approved documentation files packaged with a `MANIFEST.json`.
