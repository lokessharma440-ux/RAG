import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  Upload,
  Plus,
  Search,
  Trash2,
  ArrowRight,
  Code2,
  X,
  Sparkles,
} from 'lucide-react';
import './CodebasesView.css';

export default function CodebasesView({
  codebases: propCodebases = [],
  onRefresh,
  onSelectCodebase,
  currentUser,
  onOpenAuth,
  showToast,
}) {
  const [localCodebases, setLocalCodebases] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTab, setImportTab] = useState('github'); // 'github' | 'zip'

  // GitHub Form
  const [githubUrl, setGithubUrl] = useState('');
  const [githubBranch, setGithubBranch] = useState('main');
  const [importing, setImporting] = useState(false);

  // ZIP Form
  const [selectedFile, setSelectedFile] = useState(null);
  const [zipRepoName, setZipRepoName] = useState('');

  // Fetch Codebases
  const fetchCodebases = async () => {
    try {
      const res = await fetch('/api/codebases', { credentials: 'include' });
      if (res.status === 401) {
        setLocalCodebases([]);
        return;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setLocalCodebases(data.data);
      }
    } catch (err) {
      console.error('Failed to load codebases:', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchCodebases();
    } else {
      setLocalCodebases([]);
    }
  }, [currentUser]);

  const activeCodebases = propCodebases.length > 0 ? propCodebases : localCodebases;

  // Poll in-progress indexing jobs
  useEffect(() => {
    const hasPendingJobs = activeCodebases.some((c) =>
      ['queued', 'fetching', 'extracting', 'discovering_files', 'parsing', 'chunking', 'embedding', 'indexing'].includes(c.status)
    );
    if (!hasPendingJobs || !currentUser) return;

    const interval = setInterval(() => {
      fetchCodebases();
    }, 2500);

    return () => clearInterval(interval);
  }, [activeCodebases, currentUser]);

  const triggerRefresh = () => {
    fetchCodebases();
    if (typeof onRefresh === 'function') {
      try {
        onRefresh();
      } catch (e) {
        console.error('onRefresh callback error:', e);
      }
    }
  };

  const filteredCodebases = activeCodebases.filter((c) => {
    const q = searchQuery.toLowerCase();
    const name = (c.name || '').toLowerCase();
    const desc = (c.description || '').toLowerCase();
    const lang = (c.stats?.languages || []).map((l) => l.name).join(' ').toLowerCase();
    return name.includes(q) || desc.includes(q) || lang.includes(q);
  });

  const handleGitHubSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth('login');
      showToast('Please sign in to import repositories.');
      return;
    }
    if (!githubUrl.trim()) {
      showToast('Please enter a GitHub repository URL.');
      return;
    }

    setImporting(true);
    try {
      const res = await fetch('/api/codebases/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: githubUrl.trim(), branch: githubBranch.trim() || 'main' }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to import repository.');
      }
      showToast(`Import initiated for "${data.data.name}"`);
      setIsImportModalOpen(false);
      setGithubUrl('');
      triggerRefresh();
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleZipSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth('login');
      showToast('Please sign in to upload codebases.');
      return;
    }
    if (!selectedFile) {
      showToast('Please select a ZIP file to upload.');
      return;
    }

    setImporting(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    if (zipRepoName.trim()) {
      formData.append('name', zipRepoName.trim());
    }

    try {
      const res = await fetch('/api/codebases/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to upload ZIP.');
      }
      showToast(`Uploaded "${data.data.name}". Indexing started.`);
      setIsImportModalOpen(false);
      setSelectedFile(null);
      setZipRepoName('');
      triggerRefresh();
    } catch (err) {
      showToast(`Upload failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (e, id, name) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete repository "${name}" and all its vector indexes?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/codebases/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Deleted "${name}"`);
        triggerRefresh();
      } else {
        showToast(data.message || 'Delete failed.');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  };

  return (
    <div className="dev-codebases-page">
      {/* Header */}
      <div className="dev-codebases-header">
        <div className="dev-codebases-header-left">
          <h1 className="dev-page-title">Codebase Intelligence</h1>
          <p className="dev-page-subtitle">
            Index software repositories from GitHub or ZIP archives. Understand system architecture,
            cross-file dependencies, API routes, and query code with grounded semantic retrieval.
          </p>
        </div>
        <div className="dev-codebases-header-actions">
          <button
            type="button"
            className="dev-btn-solid"
            onClick={() => {
              if (!currentUser) {
                onOpenAuth('login');
                showToast('Please sign in to import repositories.');
              } else {
                setIsImportModalOpen(true);
              }
            }}
          >
            <Plus size={14} style={{ marginRight: 6 }} />
            Import Repository
          </button>
        </div>
      </div>

      {/* Search Bar Row */}
      <div className="dev-search-container">
        <div className="dev-search-bar">
          <Search size={16} className="dev-search-icon" />
          <input
            type="text"
            className="dev-search-input"
            placeholder="Search codebases by name, language, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="dev-search-meta-row">
          <span className="dev-count-text">
            {filteredCodebases.length} {filteredCodebases.length === 1 ? 'repository' : 'repositories'} indexed
          </span>
        </div>
      </div>

      {/* Codebases Grid */}
      {filteredCodebases.length === 0 ? (
        <div className="dev-codebases-empty">
          <div className="dev-codebases-empty-icon">
            <Code2 size={28} />
          </div>
          <h3 className="dev-codebases-empty-title">No Codebases Indexed Yet</h3>
          <p className="dev-codebases-empty-desc">
            Import a public GitHub repository or upload a project ZIP file to start analyzing
            architecture, tracing cross-file dependencies, and executing grounded code queries.
          </p>
          <button
            type="button"
            className="dev-btn-solid"
            onClick={() => {
              if (!currentUser) {
                onOpenAuth('login');
              } else {
                setIsImportModalOpen(true);
              }
            }}
          >
            <Plus size={14} style={{ marginRight: 6 }} />
            Import Your First Codebase
          </button>
        </div>
      ) : (
        <div className="dev-codebases-grid">
          {filteredCodebases.map((cb) => {
            const isReady = cb.status === 'ready';
            const isIndexing = ['queued', 'fetching', 'extracting', 'discovering_files', 'parsing', 'chunking', 'embedding', 'indexing'].includes(cb.status);
            const isFailed = cb.status === 'failed';
            const topLanguage = cb.stats?.languages?.[0]?.name || 'Code';

            return (
              <div
                key={cb._id}
                className="dev-codebase-card"
                onClick={() => onSelectCodebase(cb._id)}
                role="button"
                tabIndex={0}
              >
                <div className="dev-card-top-row">
                  <div className="dev-codebase-title-wrap">
                    <GitBranch size={16} className="dev-repo-icon" />
                    <h3 className="dev-card-project-title" title={cb.name}>
                      {cb.name}
                    </h3>
                  </div>
                  <div className="dev-badge-group">
                    <span className="dev-card-badge font-mono uppercase">
                      {cb.sourceType}
                    </span>
                    <span className={`dev-status-pill font-mono ${cb.status}`}>
                      {cb.status}
                    </span>
                  </div>
                </div>

                <p className="dev-card-description">
                  {cb.description || (isReady ? `Indexed ${cb.stats?.totalFiles || 0} files and ${cb.stats?.totalChunks || 0} vector chunks ready for architecture analysis.` : cb.progress?.message || 'Processing repository...')}
                </p>

                {/* Progress Bar for In-Flight Indexing */}
                {isIndexing && (
                  <div className="dev-indexing-progress-wrap">
                    <div className="dev-indexing-progress-bar">
                      <div
                        className="dev-indexing-progress-fill"
                        style={{ width: `${cb.progress?.percentage || 15}%` }}
                      />
                    </div>
                    <span className="dev-indexing-progress-msg font-mono">
                      {cb.progress?.message || 'Indexing in progress...'} ({cb.progress?.percentage || 0}%)
                    </span>
                  </div>
                )}

                {/* Error message if indexing failed */}
                {isFailed && (
                  <div className="dev-indexing-progress-wrap" style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
                    <span className="dev-indexing-progress-msg font-mono" style={{ color: '#991b1b' }}>
                      Failed: {cb.errorMessage || cb.progress?.message || 'Processing aborted.'}
                    </span>
                  </div>
                )}

                <div className="dev-card-meta-row">
                  <div className="dev-card-lang-indicator">
                    <span className="dev-lang-dot" style={{ backgroundColor: '#2563eb' }} />
                    <span className="dev-lang-name capitalize">{topLanguage}</span>
                  </div>

                  {isReady && (
                    <>
                      <span className="dev-meta-stat font-mono">
                        ★ {cb.stats?.totalFiles || 0} files
                      </span>
                      <span className="dev-meta-stat font-mono">
                        {cb.stats?.totalChunks || 0} chunks
                      </span>
                    </>
                  )}

                  {cb.indexedCommitSha && (
                    <span className="dev-meta-sha font-mono">
                      #{cb.indexedCommitSha.substring(0, 7)}
                    </span>
                  )}
                </div>

                <div className="dev-card-actions-row">
                  <button
                    type="button"
                    className="dev-btn-outline"
                    onClick={(e) => handleDelete(e, cb._id, cb.name)}
                    title="Delete repository index"
                  >
                    <Trash2 size={13} style={{ marginRight: 4 }} />
                    Delete
                  </button>

                  <button
                    type="button"
                    className="dev-btn-solid"
                    disabled={!isReady}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCodebase(cb._id);
                    }}
                  >
                    <Sparkles size={13} style={{ marginRight: 6 }} className="text-cyan" />
                    <span>Audit &amp; Explore</span>
                    <ArrowRight size={13} style={{ marginLeft: 6 }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="dev-modal-backdrop" onClick={() => setIsImportModalOpen(false)}>
          <div className="dev-import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dev-modal-header">
              <div className="dev-modal-title-row">
                <Code2 size={18} className="text-cyan" />
                <h3 className="dev-modal-title">Import Codebase to DevMind AI</h3>
              </div>
              <button
                type="button"
                className="dev-modal-close"
                onClick={() => setIsImportModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            {/* Tab Switcher */}
            <div className="dev-modal-tabs">
              <button
                type="button"
                className={`dev-modal-tab ${importTab === 'github' ? 'active' : ''}`}
                onClick={() => setImportTab('github')}
              >
                <GitBranch size={14} style={{ marginRight: 6 }} />
                Public GitHub URL
              </button>
              <button
                type="button"
                className={`dev-modal-tab ${importTab === 'zip' ? 'active' : ''}`}
                onClick={() => setImportTab('zip')}
              >
                <Upload size={14} style={{ marginRight: 6 }} />
                Upload ZIP Archive
              </button>
            </div>

            {/* GitHub Form */}
            {importTab === 'github' && (
              <form onSubmit={handleGitHubSubmit} className="dev-modal-form">
                <p className="dev-modal-desc">
                  Provide a public GitHub repository URL. The system will download the archive stream,
                  filter ignored files, extract semantic symbols, and compute 384-d local MiniLM vector embeddings.
                </p>
                <div className="dev-modal-field">
                  <label className="dev-modal-label">GitHub Repository URL *</label>
                  <input
                    type="url"
                    className="dev-modal-input"
                    placeholder="https://github.com/facebook/react"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    required
                  />
                </div>
                <div className="dev-modal-field">
                  <label className="dev-modal-label">Default Branch</label>
                  <input
                    type="text"
                    className="dev-modal-input"
                    placeholder="main"
                    value={githubBranch}
                    onChange={(e) => setGithubBranch(e.target.value)}
                  />
                </div>
                <div className="dev-modal-actions">
                  <button
                    type="button"
                    className="dev-btn-outline"
                    onClick={() => setIsImportModalOpen(false)}
                    disabled={importing}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="dev-btn-solid"
                    disabled={importing || !githubUrl.trim()}
                  >
                    {importing ? 'Initiating Import...' : 'Import & Index Repository'}
                  </button>
                </div>
              </form>
            )}

            {/* ZIP Upload Form */}
            {importTab === 'zip' && (
              <form onSubmit={handleZipSubmit} className="dev-modal-form">
                <p className="dev-modal-desc">
                  Upload a ZIP archive of your source code (max 25MB). Protected with multi-layered
                  zip-bomb, path traversal, and heuristic secret detection safeguards.
                </p>
                <div className="dev-modal-field">
                  <label className="dev-modal-label">Repository Name (Optional)</label>
                  <input
                    type="text"
                    className="dev-modal-input"
                    placeholder="MyProject"
                    value={zipRepoName}
                    onChange={(e) => setZipRepoName(e.target.value)}
                  />
                </div>
                <div className="dev-modal-field">
                  <label className="dev-modal-label">Select .zip Archive *</label>
                  <input
                    type="file"
                    accept=".zip"
                    className="dev-file-input"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    required
                  />
                </div>
                <div className="dev-modal-actions">
                  <button
                    type="button"
                    className="dev-btn-outline"
                    onClick={() => setIsImportModalOpen(false)}
                    disabled={importing}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="dev-btn-solid"
                    disabled={importing || !selectedFile}
                  >
                    {importing ? 'Uploading & Indexing...' : 'Upload & Start Indexing'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
