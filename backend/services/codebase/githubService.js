import fs from 'fs';
import path from 'path';

/**
 * Validates a GitHub repository URL and extracts owner, repository, and optional branch.
 * Accepts:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/branch_name
 *
 * @param {string} urlString
 * @returns {{ valid: boolean, owner?: string, repo?: string, branch?: string, error?: string }}
 */
export function validateGitHubUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'A valid GitHub repository URL string is required.' };
  }

  const cleanUrl = urlString.trim();

  if (cleanUrl.includes('..') || cleanUrl.includes('\\')) {
    return { valid: false, error: 'Path traversal sequences or backslashes are not permitted in repository URLs.' };
  }

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
      return { valid: false, error: 'Only public repositories on github.com are currently supported.' };
    }

    const segments = parsed.pathname.replace(/^\/|\/$/g, '').split('/');
    if (segments.length < 2) {
      return { valid: false, error: 'URL must specify both repository owner and repository name (e.g. https://github.com/owner/repo).' };
    }

    const owner = segments[0].trim();
    let repo = segments[1].trim().replace(/\.git$/, '');

    // Validate alphanumeric and permitted characters
    const ownerRegex = /^[a-zA-Z0-9_-]+$/;
    const repoRegex = /^[a-zA-Z0-9_.-]+$/;

    if (!ownerRegex.test(owner) || !repoRegex.test(repo)) {
      return { valid: false, error: 'Repository owner or name contains invalid characters.' };
    }

    let branch = 'main';
    if (segments.length >= 4 && segments[2] === 'tree') {
      branch = segments.slice(3).join('/');
    }

    return {
      valid: true,
      owner,
      repo,
      branch,
      normalizedUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

/**
 * Fetches repository metadata from GitHub public API.
 * Gracefully falls back if GitHub unauthenticated rate limit is reached.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<{ name: string, description: string, defaultBranch: string, commitSha: string, stars: number }>}
 */
export async function fetchGitHubRepoMetadata(owner, repo) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    'User-Agent': 'DevMind-AI-Codebase-Intelligence/1.0',
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    const res = await fetch(apiUrl, { headers });

    if (res.status === 404) {
      throw new Error(`GitHub repository "${owner}/${repo}" was not found or is private.`);
    }

    if (!res.ok) {
      console.warn(`[GitHub API Notice] GitHub API returned status ${res.status}. Falling back to default head branch.`);
      return {
        name: repo,
        description: `Imported repository ${owner}/${repo}`,
        defaultBranch: 'main',
        commitSha: null,
        stars: 0,
      };
    }

    const data = await res.json();

    // Fetch latest commit SHA on default branch
    let commitSha = null;
    try {
      const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${data.default_branch || 'main'}`, { headers });
      if (commitRes.ok) {
        const commitData = await commitRes.json();
        commitSha = commitData.sha ? commitData.sha.substring(0, 12) : null;
      }
    } catch {
      // Commit SHA fallback
    }

    return {
      name: data.name || repo,
      description: data.description || '',
      defaultBranch: data.default_branch || 'main',
      commitSha,
      stars: data.stargazers_count || 0,
    };
  } catch (err) {
    if (err.message.includes('not found')) {
      throw err;
    }
    return {
      name: repo,
      description: `Imported repository ${owner}/${repo}`,
      defaultBranch: 'main',
      commitSha: null,
      stars: 0,
    };
  }
}

/**
 * Downloads a public repository zipball archive to a local temporary file.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} destDir
 * @returns {Promise<{ archivePath: string, sizeBytes: number }>}
 */
export async function downloadGitHubArchive(owner, repo, branch = 'main', destDir) {
  if (!fs.existsSync(destDir)) {
    await fs.promises.mkdir(destDir, { recursive: true });
  }

  const archiveFileName = `github_${owner}_${repo}_${Date.now()}.zip`;
  const destPath = path.join(destDir, archiveFileName);

  // Try standard branch zipball endpoint
  const candidateUrls = [
    `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`,
    `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/main`,
    `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/master`,
    `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
  ];

  let downloaded = false;
  let lastStatus = 0;

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'DevMind-AI-Codebase-Intelligence/1.0' },
      });

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.promises.writeFile(destPath, buffer);
        downloaded = true;
        break;
      }
      lastStatus = res.status;
    } catch {
      // Try next candidate URL
    }
  }

  if (!downloaded) {
    throw new Error(`Failed to download repository archive from GitHub (Status: ${lastStatus || 'network error'}). Verify the repository and branch exist.`);
  }

  const stats = await fs.promises.stat(destPath);
  return {
    archivePath: destPath,
    sizeBytes: stats.size,
  };
}
