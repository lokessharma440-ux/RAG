import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Shield, Layers, FileCode, BookOpen, Zap,
  AlertTriangle, Info, CheckCircle, XCircle, ChevronRight,
  Download, GitPullRequest, RefreshCw, Sparkles, FileText,
  Lock, Database, TestTube2, Rocket, Cpu, Eye, Edit3,
  Copy, Check, ExternalLink, Clock, ArrowLeft, BarChart2,
  AlertCircle, Archive
} from 'lucide-react';
import MarkdownContent from './MarkdownContent.jsx';
import FixPromptModal from './FixPromptModal.jsx';
import './AuditDashboard.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_META = {
  architecture:     { label: 'Architecture',       icon: Layers },
  authentication:   { label: 'Authentication',     icon: Lock },
  apiQuality:       { label: 'API & Backend',      icon: Zap },
  frontendQuality:  { label: 'Frontend Quality',   icon: FileCode },
  database:         { label: 'Database & Data',    icon: Database },
  dependencies:     { label: 'Dependencies',        icon: Archive },
  testing:          { label: 'Testing',             icon: TestTube2 },
  deployment:       { label: 'Deployment',          icon: Rocket },
  performance:      { label: 'Performance',         icon: Cpu },
  documentation:    { label: 'Documentation',       icon: BookOpen },
};

const DOC_TYPE_META = {
  readme:       { label: 'README.md',              path: 'README.md' },
  architecture: { label: 'ARCHITECTURE.md',        path: 'ARCHITECTURE.md' },
  prd:          { label: 'PRD.md',                 path: 'PRD.md' },
  api:          { label: 'API.md',                 path: 'API.md' },
  database:     { label: 'DATABASE_SCHEMA.md',     path: 'DATABASE_SCHEMA.md' },
  security:     { label: 'SECURITY.md',            path: 'SECURITY.md' },
  contributing: { label: 'CONTRIBUTING.md',        path: 'CONTRIBUTING.md' },
  testing:      { label: 'TESTING.md',             path: 'TESTING.md' },
  deployment:   { label: 'DEPLOYMENT.md',          path: 'DEPLOYMENT.md' },
  environment:  { label: 'ENVIRONMENT_VARIABLES.md', path: 'ENVIRONMENT_VARIABLES.md' },
};

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function severityBadgeClass(sev) {
  return (sev || 'info').toLowerCase();
}

function getTopSeverity(findings = []) {
  if (!findings.length) return 'clean';
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
  return sorted[0].severity.toLowerCase();
}

function countBySeverity(findings = []) {
  return findings.reduce((acc, f) => {
    const s = (f.severity || 'INFO').toUpperCase();
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SeverityTag({ severity }) {
  return (
    <span className={`audit-severity-tag ${severityBadgeClass(severity)}`}>
      {severity || 'INFO'}
    </span>
  );
}

function StatusPill({ status }) {
  const label = status || 'idle';
  return (
    <span className={`audit-status-pill ${label}`}>
      {label === 'running' && <Sparkles size={10} className="spin" />}
      {label === 'completed' && <CheckCircle size={10} />}
      {label === 'failed' && <XCircle size={10} />}
      {['pending', 'not_analyzed', 'idle'].includes(label) && <Clock size={10} />}
      {label.replace(/_/g, ' ')}
    </span>
  );
}

function LoadingState({ message = 'Loading...' }) {
  return (
    <div className="audit-loading-state">
      <Sparkles size={24} className="spin text-cyan" />
      <p>{message}</p>
    </div>
  );
}

function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="audit-empty-state">
      <div className="audit-empty-state-icon">
        <Icon size={22} />
      </div>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

// ─── Finding Detail Panel ─────────────────────────────────────────────────────

function FindingDetailPanel({ finding, onViewFile, onClose, onOpenFixPrompt }) {
  if (!finding) return null;
  return (
    <div className="audit-detail-panel">
      <div className="audit-detail-header">
        <div style={{ flex: 1 }}>
          <div className="audit-detail-tags" style={{ marginBottom: 8 }}>
            <SeverityTag severity={finding.severity} />
            <span className="audit-category-tag">{finding.category}</span>
            <span className={`audit-verification-tag ${finding.verificationStatus || 'NEEDS_MANUAL_REVIEW'}`}>
              {(finding.verificationStatus || 'NEEDS_MANUAL_REVIEW').replace(/_/g, ' ')}
            </span>
            <span className="audit-effort-tag">effort: {finding.effort || 'medium'}</span>
          </div>
          <div className="audit-detail-title">{finding.title}</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="audit-editor-btn" style={{ flexShrink: 0 }}>
            ✕
          </button>
        )}
      </div>

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <button
          type="button"
          className="audit-analyze-btn primary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => onOpenFixPrompt && onOpenFixPrompt([finding], 'single_issue')}
        >
          <Zap size={13} /> Generate AI Fix Prompt
        </button>
      </div>

      <div className="audit-detail-section">
        <div className="audit-detail-section-label">Description</div>
        <div className="audit-detail-section-text">{finding.description}</div>
      </div>

      {finding.filePath && (
        <div className="audit-detail-section">
          <div className="audit-detail-section-label">Source Location</div>
          <span
            className="audit-detail-filepath-link"
            onClick={() => onViewFile && onViewFile(finding.filePath, finding.startLine, finding.endLine)}
          >
            <FileCode size={12} />
            {finding.filePath}
            {finding.startLine ? ` :${finding.startLine}${finding.endLine ? `–${finding.endLine}` : ''}` : ''}
          </span>
        </div>
      )}

      {finding.evidence && (
        <div className="audit-detail-section">
          <div className="audit-detail-section-label">Evidence</div>
          <pre className="audit-evidence-block">{finding.evidence}</pre>
        </div>
      )}

      {finding.impact && (
        <div className="audit-detail-section">
          <div className="audit-detail-section-label">Impact</div>
          <div className="audit-detail-section-text">{finding.impact}</div>
        </div>
      )}

      {finding.recommendation && (
        <div className="audit-detail-section">
          <div className="audit-detail-section-label">Recommendation</div>
          <div className="audit-detail-section-text">{finding.recommendation}</div>
        </div>
      )}
    </div>
  );
}

// ─── Findings Tab ────────────────────────────────────────────────────────────

function FindingsTab({ findings = [], onViewFile, showToast, onOpenFixPrompt }) {
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [selectedFindingIds, setSelectedFindingIds] = useState(new Set());
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterVerification, setFilterVerification] = useState('ALL');
  const [sortBy, setSortBy] = useState('severity');

  const categories = ['ALL', ...new Set(findings.map(f => f.category).filter(Boolean))];

  const filtered = findings
    .filter(f => filterSeverity === 'ALL' || f.severity === filterSeverity)
    .filter(f => filterCategory === 'ALL' || f.category === filterCategory)
    .filter(f => filterVerification === 'ALL' || f.verificationStatus === filterVerification)
    .sort((a, b) => {
      if (sortBy === 'severity') return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '');
      return 0;
    });

  const counts = countBySeverity(findings);

  const toggleSelectFinding = (e, fId) => {
    e.stopPropagation();
    setSelectedFindingIds(prev => {
      const next = new Set(prev);
      if (next.has(fId)) next.delete(fId);
      else next.add(fId);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    if (selectedFindingIds.size === filtered.length && filtered.length > 0) {
      setSelectedFindingIds(new Set());
    } else {
      setSelectedFindingIds(new Set(filtered.map(f => f.id)));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Floating / Sticky Bulk Action Bar */}
      {selectedFindingIds.size > 0 && (
        <div className="audit-bulk-action-bar">
          <div className="audit-bulk-count">
            <CheckCircle size={14} className="text-cyan" />
            <span><strong>{selectedFindingIds.size}</strong> issues selected</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="audit-analyze-btn primary"
              onClick={() => {
                const selected = findings.filter(f => selectedFindingIds.has(f.id));
                onOpenFixPrompt && onOpenFixPrompt(selected, selected.length === 1 ? 'single_issue' : 'related_issues');
              }}
            >
              <Zap size={13} /> Generate Fix Prompt for ({selectedFindingIds.size}) Selected Issues
            </button>
            <button
              type="button"
              className="audit-editor-btn"
              onClick={() => setSelectedFindingIds(new Set())}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Severity summary bars */}
      <div style={{ padding: '14px 16px', background: 'var(--bg-panel)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-md)' }}>
        <div className="audit-severity-bars">
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map(sev => (
            <div key={sev} className="audit-severity-row">
              <span className={`audit-severity-label ${sev.toLowerCase()}`}>{sev}</span>
              <div className="audit-severity-bar-bg">
                <div
                  className={`audit-severity-bar-fill ${sev.toLowerCase()}`}
                  style={{ width: findings.length > 0 ? `${((counts[sev] || 0) / findings.length) * 100}%` : '0%' }}
                />
              </div>
              <span className="audit-severity-count">{counts[sev] || 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="audit-filters-bar">
        <button
          type="button"
          className="audit-editor-btn"
          onClick={handleSelectAllFiltered}
          title="Select or deselect all visible findings"
        >
          {selectedFindingIds.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All Filtered'}
        </button>
        <span className="audit-filter-label">Filter:</span>
        <select className="audit-filter-select" value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
          <option value="ALL">All Severities</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map(s => (
            <option key={s} value={s}>{s} ({counts[s] || 0})</option>
          ))}
        </select>
        <select className="audit-filter-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'All Categories' : (CATEGORY_META[c]?.label || c)}</option>)}
        </select>
        <select className="audit-filter-select" value={filterVerification} onChange={e => setFilterVerification(e.target.value)}>
          <option value="ALL">All Verification States</option>
          <option value="VERIFIED_STATIC_PATTERN">Verified Static Pattern</option>
          <option value="NEEDS_MANUAL_REVIEW">Needs Manual Review</option>
          <option value="TOOL_CONFIRMED">Tool Confirmed</option>
        </select>
        <select className="audit-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="severity">Sort by Severity</option>
          <option value="category">Sort by Category</option>
        </select>
        <span className="audit-filter-label" style={{ marginLeft: 'auto' }}>{filtered.length} findings</span>
      </div>

      {/* List + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedFinding ? '1fr 1fr' : '1fr', gap: 16 }}>
        <div className="audit-findings-list">
          {filtered.length === 0 ? (
            <EmptyState icon={CheckCircle} title="No findings match your filters" description="Adjust the filters above to see more results." />
          ) : (
            filtered.map(f => (
              <div
                key={f.id || f._id || `${f.filePath}-${f.startLine}`}
                className={`audit-finding-item ${severityBadgeClass(f.severity)} ${selectedFinding?.id === f.id ? 'active' : ''}`}
                onClick={() => setSelectedFinding(selectedFinding?.id === f.id ? null : f)}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', paddingRight: 8 }}
                  onClick={e => toggleSelectFinding(e, f.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedFindingIds.has(f.id)}
                    onChange={() => {}}
                    style={{ cursor: 'pointer', accentColor: 'var(--cyan-400)', width: 15, height: 15 }}
                  />
                </div>
                <div className="audit-finding-main">
                  <div className="audit-finding-top">
                    <SeverityTag severity={f.severity} />
                    <span className="audit-category-tag">{CATEGORY_META[f.category]?.label || f.category}</span>
                    {f.confidence && <span className="audit-confidence-tag">conf: {f.confidence}</span>}
                    <button
                      type="button"
                      className="audit-quick-fix-btn"
                      onClick={e => {
                        e.stopPropagation();
                        onOpenFixPrompt && onOpenFixPrompt([f], 'single_issue');
                      }}
                      title="Generate AI Fix Prompt for this issue"
                    >
                      <Zap size={10} /> Fix Prompt
                    </button>
                  </div>
                  <div className="audit-finding-title">{f.title}</div>
                  {f.filePath && (
                    <div
                      className="audit-finding-path"
                      onClick={e => { e.stopPropagation(); onViewFile && onViewFile(f.filePath, f.startLine, f.endLine); }}
                    >
                      <FileCode size={11} />
                      {f.filePath}{f.startLine ? `:${f.startLine}` : ''}
                    </div>
                  )}
                  <div className="audit-finding-desc">{f.description}</div>
                </div>
                <ChevronRight size={14} className="audit-finding-expand" />
              </div>
            ))
          )}
        </div>

        {selectedFinding && (
          <FindingDetailPanel
            finding={selectedFinding}
            onViewFile={onViewFile}
            onClose={() => setSelectedFinding(null)}
            onOpenFixPrompt={onOpenFixPrompt}
          />
        )}
      </div>
    </div>
  );
}

// ─── Recommendations Tab ─────────────────────────────────────────────────────

function RecommendationsTab({ recommendations = [] }) {
  const [filterEffort, setFilterEffort] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');

  const categories = ['ALL', ...new Set(recommendations.map(r => r.category).filter(Boolean))];
  const filtered = recommendations
    .filter(r => filterEffort === 'ALL' || r.effort === filterEffort)
    .filter(r => filterCategory === 'ALL' || r.category === filterCategory)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  const effortColor = { low: 'low', medium: 'medium', high: 'high' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="audit-filters-bar">
        <span className="audit-filter-label">Filter:</span>
        <select className="audit-filter-select" value={filterEffort} onChange={e => setFilterEffort(e.target.value)}>
          <option value="ALL">All Efforts</option>
          <option value="low">Low Effort</option>
          <option value="medium">Medium Effort</option>
          <option value="high">High Effort</option>
        </select>
        <select className="audit-filter-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'All Categories' : (CATEGORY_META[c]?.label || c)}</option>)}
        </select>
        <span className="audit-filter-label" style={{ marginLeft: 'auto' }}>{filtered.length} recommendations</span>
      </div>

      <div className="audit-recommendations-list">
        {filtered.length === 0 ? (
          <EmptyState icon={Sparkles} title="No recommendations" description="No recommendations match your current filters." />
        ) : (
          filtered.map((rec, idx) => (
            <div key={rec.id || idx} className="audit-rec-card">
              <div className="audit-rec-header">
                <div className="audit-rec-priority">
                  <div className={`audit-priority-dot ${effortColor[rec.effort] || 'medium'}`} />
                  Priority #{rec.priority ?? idx + 1} · {CATEGORY_META[rec.category]?.label || rec.category}
                </div>
                <div className="audit-detail-tags">
                  <span className="audit-effort-tag">effort: {rec.effort || 'medium'}</span>
                  <span className="audit-effort-tag">risk: {rec.risk || 'medium'}</span>
                </div>
              </div>
              <div className="audit-rec-title">{rec.title}</div>
              <div className="audit-rec-problem">{rec.problem}</div>

              {rec.whyItMatters && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  <strong style={{ color: 'var(--text-muted)' }}>Why it matters:</strong> {rec.whyItMatters}
                </div>
              )}

              {rec.recommendedChange && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  <strong style={{ color: 'var(--text-muted)' }}>Recommended change:</strong> {rec.recommendedChange}
                </div>
              )}

              {rec.expectedBenefit && (
                <div style={{ fontSize: 12, color: 'var(--emerald-400)', marginBottom: 8 }}>
                  ✓ {rec.expectedBenefit}
                </div>
              )}

              {rec.relevantFiles && rec.relevantFiles.length > 0 && (
                <div className="audit-rec-files">
                  {rec.relevantFiles.map((f, fi) => (
                    <span key={fi} className="audit-rec-file-chip">{f}</span>
                  ))}
                </div>
              )}

              <div className="audit-rec-meta" style={{ marginTop: 8 }}>
                {rec.verificationSteps && rec.verificationSteps.length > 0 && (
                  <span className="audit-rec-meta-item">
                    <CheckCircle size={10} /> {rec.verificationSteps.length} verification step{rec.verificationSteps.length !== 1 ? 's' : ''}
                  </span>
                )}
                {rec.prerequisites && rec.prerequisites.length > 0 && (
                  <span className="audit-rec-meta-item">
                    <AlertCircle size={10} /> {rec.prerequisites.length} prerequisite{rec.prerequisites.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Documentation Tab ───────────────────────────────────────────────────────

function DocumentationTab({ repositoryId, codebase, analysis, showToast }) {
  const [inventory, setInventory] = useState([]);
  const [generatedDocs, setGeneratedDocs] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [generatingType, setGeneratingType] = useState(null);
  const [editorView, setEditorView] = useState('preview'); // 'edit' | 'preview'
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingBundle, setDownloadingBundle] = useState(false);
  const [selectedForBundle, setSelectedForBundle] = useState(new Set());
  const [prStatus, setPrStatus] = useState(null);
  const [prData, setPrData] = useState({ githubToken: '', prTitle: '', targetBranch: codebase?.defaultBranch || 'main' });
  const [creatingPr, setCreatingPr] = useState(false);
  const [showPrForm, setShowPrForm] = useState(false);
  const [copiedDoc, setCopiedDoc] = useState(false);

  const selectedDoc = generatedDocs.find(d => d._id === selectedDocId);

  const fetchInventory = useCallback(async () => {
    if (!repositoryId) return;
    setLoadingInventory(true);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/documentation/inventory`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setInventory(data.data);
      }
    } catch (err) {
      console.error('Failed to load documentation inventory:', err);
    } finally {
      setLoadingInventory(false);
    }
  }, [repositoryId]);

  const fetchGeneratedDocs = useCallback(async () => {
    if (!repositoryId) return;
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/documentation/generated`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setGeneratedDocs(data.data);
        if (data.data.length > 0 && !selectedDocId) {
          setSelectedDocId(data.data[0]._id);
          setEditedContent(data.data[0].generatedContent || '');
        }
      }
    } catch (err) {
      console.error('Failed to load generated documents:', err);
    }
  }, [repositoryId]);

  useEffect(() => {
    fetchInventory();
    fetchGeneratedDocs();
  }, [fetchInventory, fetchGeneratedDocs]);

  useEffect(() => {
    if (selectedDoc) {
      setEditedContent(selectedDoc.generatedContent || '');
      setHasUnsavedEdits(false);
    }
  }, [selectedDocId]);

  const handleGenerate = async (documentType) => {
    if (hasUnsavedEdits) {
      if (!window.confirm('You have unsaved edits. Generating a new document will not affect them. Continue?')) return;
    }
    setGeneratingType(documentType);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/documentation/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success && data.data) {
        showToast(`Generated ${DOC_TYPE_META[documentType]?.label || documentType}`);
        await fetchGeneratedDocs();
        if (data.data.documentId) {
          setSelectedDocId(data.data.documentId);
        }
        await fetchInventory();
      } else {
        showToast(data.message || 'Generation failed');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setGeneratingType(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedDocId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/documentation/generated/${selectedDocId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedContent }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        showToast('Document saved');
        setHasUnsavedEdits(false);
        await fetchGeneratedDocs();
      } else {
        showToast(data.message || 'Save failed');
      }
    } catch (err) {
      showToast(`Save error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadSingle = async () => {
    if (!selectedDocId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/documentation/generated/${selectedDocId}/download`, {
        credentials: 'include',
      });
      if (!res.ok) {
        showToast('Download failed');
        return;
      }
      const blob = await res.blob();
      const filename = selectedDoc?.documentPath || 'document.md';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${filename}`);
    } catch (err) {
      showToast(`Download error: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadBundle = async () => {
    const ids = selectedForBundle.size > 0 ? Array.from(selectedForBundle) : generatedDocs.map(d => d._id);
    if (ids.length === 0) {
      showToast('No documents to download');
      return;
    }
    setDownloadingBundle(true);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/documentation/download-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: ids }),
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.message || 'Bundle download failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `devmind-docs-${repositoryId.slice(-6)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ZIP bundle (${ids.length} files)`);
    } catch (err) {
      showToast(`Bundle error: ${err.message}`);
    } finally {
      setDownloadingBundle(false);
    }
  };

  const handleCreatePR = async (e) => {
    e.preventDefault();
    if (!prData.githubToken.trim()) {
      showToast('GitHub Personal Access Token is required to create pull requests.');
      return;
    }
    const ids = selectedForBundle.size > 0 ? Array.from(selectedForBundle) : generatedDocs.map(d => d._id);
    if (ids.length === 0) {
      showToast('No documents selected for pull request.');
      return;
    }
    if (!window.confirm(`Create a new GitHub pull request with ${ids.length} document(s)? This will create a new branch and PR — it will NOT push to the default branch.`)) return;

    setCreatingPr(true);
    setPrStatus({ type: 'pending', message: 'Creating branch and opening pull request...' });

    try {
      const res = await fetch(`/api/codebases/${repositoryId}/github/pull-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds: ids,
          targetBranch: prData.targetBranch || codebase?.defaultBranch || 'main',
          prTitle: prData.prTitle || 'docs: add AI-generated documentation from DevMind AI',
          githubToken: prData.githubToken,
        }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success && data.data?.pullRequestUrl) {
        setPrStatus({ type: 'success', message: `Pull request created successfully!`, url: data.data.pullRequestUrl, branch: data.data.generatedBranch });
        showToast('Pull request created!');
        setShowPrForm(false);
      } else {
        setPrStatus({ type: 'error', message: data.message || 'Failed to create pull request.' });
      }
    } catch (err) {
      setPrStatus({ type: 'error', message: `Error: ${err.message}` });
    } finally {
      setCreatingPr(false);
      // Clear token from memory immediately
      setPrData(prev => ({ ...prev, githubToken: '' }));
    }
  };

  const toggleBundleSelect = (id) => {
    setSelectedForBundle(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyDocContent = () => {
    navigator.clipboard.writeText(selectedDoc?.generatedContent || '');
    setCopiedDoc(true);
    showToast('Copied to clipboard');
    setTimeout(() => setCopiedDoc(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Documentation Inventory */}
      <div>
        <div className="audit-section-heading">
          <div className="audit-section-title">
            <BookOpen size={15} /> Documentation Inventory
          </div>
          <button type="button" className="audit-editor-btn" onClick={fetchInventory} disabled={loadingInventory}>
            <RefreshCw size={12} className={loadingInventory ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {loadingInventory ? (
          <LoadingState message="Scanning repository for documentation..." />
        ) : inventory.length === 0 ? (
          <EmptyState icon={BookOpen} title="No inventory yet" description="Run an analysis first to build the documentation inventory." />
        ) : (
          <div className="audit-doc-inventory">
            {inventory.map((item, idx) => {
              const hasDoc = generatedDocs.find(d => d.documentType === item.docType);
              return (
                <div key={idx} className="audit-doc-item">
                  <div className="audit-doc-icon">
                    <FileText size={14} />
                  </div>
                  <div className="audit-doc-details">
                    <div className="audit-doc-path">{item.documentPath || DOC_TYPE_META[item.docType]?.path || item.docType}</div>
                    {item.evidence && <div className="audit-doc-evidence">{item.evidence}</div>}
                    {item.recommendedAction && <div className="audit-doc-evidence" style={{ color: 'var(--purple-400)', marginTop: 2 }}>→ {item.recommendedAction}</div>}
                  </div>
                  <span className={`audit-doc-status ${item.status || 'NEEDS_MANUAL_REVIEW'}`}>
                    {(item.status || 'NEEDS_MANUAL_REVIEW').replace(/_/g, ' ')}
                  </span>
                  <div className="audit-doc-action">
                    {hasDoc ? (
                      <button
                        type="button"
                        className="audit-doc-generate-btn view"
                        onClick={() => { setSelectedDocId(hasDoc._id); document.getElementById('generated-docs-section')?.scrollIntoView({ behavior: 'smooth' }); }}
                      >
                        <Eye size={11} /> View
                      </button>
                    ) : (
                      item.status !== 'NOT_APPLICABLE' && (
                        <button
                          type="button"
                          className="audit-doc-generate-btn generate"
                          onClick={() => handleGenerate(item.docType)}
                          disabled={generatingType === item.docType}
                        >
                          {generatingType === item.docType ? (
                            <><Sparkles size={11} className="spin" /> Generating...</>
                          ) : (
                            <><Sparkles size={11} /> Generate</>
                          )}
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Generated Documents Workspace */}
      <div id="generated-docs-section">
        <div className="audit-section-heading">
          <div className="audit-section-title">
            <Edit3 size={15} /> Generated Documents
            <span className="audit-section-count">{generatedDocs.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {generatedDocs.length > 0 && (
              <>
                <button
                  type="button"
                  className="audit-editor-btn"
                  onClick={handleDownloadBundle}
                  disabled={downloadingBundle}
                >
                  {downloadingBundle ? (
                    <><Sparkles size={12} className="spin" /> Bundling...</>
                  ) : (
                    <><Archive size={12} /> Download ZIP {selectedForBundle.size > 0 ? `(${selectedForBundle.size})` : `(all)`}</>
                  )}
                </button>
                <button
                  type="button"
                  className="audit-editor-btn primary"
                  onClick={() => setShowPrForm(!showPrForm)}
                >
                  <GitPullRequest size={12} /> Create PR
                </button>
              </>
            )}
          </div>
        </div>

        {/* PR Status */}
        {prStatus && (
          <div className={`audit-pr-status-area ${prStatus.type}`} style={{ marginBottom: 12 }}>
            {prStatus.type === 'success' && <CheckCircle size={14} style={{ display: 'inline', marginRight: 6 }} />}
            {prStatus.type === 'error' && <XCircle size={14} style={{ display: 'inline', marginRight: 6 }} />}
            {prStatus.type === 'pending' && <Sparkles size={14} className="spin" style={{ display: 'inline', marginRight: 6 }} />}
            {prStatus.message}
            {prStatus.url && (
              <div style={{ marginTop: 6 }}>
                <a href={prStatus.url} target="_blank" rel="noopener noreferrer" className="audit-pr-link">
                  <ExternalLink size={11} style={{ display: 'inline', marginRight: 3 }} />
                  {prStatus.url}
                </a>
              </div>
            )}
            {prStatus.branch && (
              <div style={{ fontSize: 11, marginTop: 4, color: 'inherit', opacity: 0.8, fontFamily: 'var(--font-mono)' }}>
                Branch: {prStatus.branch}
              </div>
            )}
          </div>
        )}

        {/* PR Form */}
        {showPrForm && (
          <div className="audit-pr-panel" style={{ marginBottom: 16 }}>
            <div className="audit-pr-title">
              <GitPullRequest size={16} /> Create GitHub Pull Request
            </div>
            <div className="audit-pr-desc">
              This will create a new branch in your repository and open a pull request with the selected documentation files.
              It will <strong>never</strong> push directly to your default branch.
              Your GitHub token is used only for this request and is never stored.
            </div>
            <form className="audit-pr-form" onSubmit={handleCreatePR}>
              <div className="audit-pr-input-group">
                <label className="audit-pr-input-label">GitHub Personal Access Token (required)</label>
                <input
                  type="password"
                  className="audit-pr-input"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={prData.githubToken}
                  onChange={e => setPrData(p => ({ ...p, githubToken: e.target.value }))}
                  required
                />
                <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  Needs <code>repo</code> scope. Token is never stored — used only for this request.
                </span>
              </div>
              <div className="audit-pr-input-group">
                <label className="audit-pr-input-label">Target Branch (base for PR)</label>
                <input
                  type="text"
                  className="audit-pr-input"
                  value={prData.targetBranch}
                  onChange={e => setPrData(p => ({ ...p, targetBranch: e.target.value }))}
                  placeholder="main"
                />
              </div>
              <div className="audit-pr-input-group">
                <label className="audit-pr-input-label">PR Title (optional)</label>
                <input
                  type="text"
                  className="audit-pr-input"
                  value={prData.prTitle}
                  onChange={e => setPrData(p => ({ ...p, prTitle: e.target.value }))}
                  placeholder="docs: add AI-generated documentation from DevMind AI"
                />
              </div>
              <div className="audit-pr-input-group">
                <label className="audit-pr-input-label">Documents to include</label>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {selectedForBundle.size > 0
                    ? `${selectedForBundle.size} selected document(s)`
                    : `All ${generatedDocs.length} generated document(s)`}
                  <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>(select from list to narrow)</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="audit-analyze-btn primary" disabled={creatingPr || !prData.githubToken.trim()}>
                  {creatingPr ? <><Sparkles size={13} className="spin" /> Creating PR...</> : <><GitPullRequest size={13} /> Create Pull Request</>}
                </button>
                <button type="button" className="audit-analyze-btn secondary" onClick={() => setShowPrForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {generatedDocs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents generated yet"
            description="Use the inventory above to generate documentation files from your repository's source code."
          />
        ) : (
          <div className="audit-docs-workspace">
            {/* Left: doc list */}
            <div className="audit-docs-list-panel">
              <div className="audit-docs-list-header">Documents ({generatedDocs.length})</div>
              <div className="audit-docs-list-items">
                {generatedDocs.map(doc => (
                  <div
                    key={doc._id}
                    className={`audit-doc-list-item ${selectedDocId === doc._id ? 'active' : ''}`}
                    onClick={() => {
                      if (hasUnsavedEdits && selectedDocId !== doc._id) {
                        if (!window.confirm('You have unsaved edits. Switch documents anyway?')) return;
                        setHasUnsavedEdits(false);
                      }
                      setSelectedDocId(doc._id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedForBundle.has(doc._id)}
                      onChange={e => { e.stopPropagation(); toggleBundleSelect(doc._id); }}
                      style={{ flexShrink: 0 }}
                    />
                    <span className="audit-doc-list-name">{doc.documentPath || DOC_TYPE_META[doc.documentType]?.path || doc.documentType}</span>
                    {doc.userEdited && <span className="audit-doc-list-badge edited">edited</span>}
                    {doc.publicationStatus === 'published' && <span className="audit-doc-list-badge published">published</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: editor */}
            <div className="audit-editor-panel">
              {selectedDoc ? (
                <>
                  <div className="audit-editor-toolbar">
                    <div className="audit-editor-filename">
                      <FileText size={13} />
                      {selectedDoc.documentPath || 'document.md'}
                      {hasUnsavedEdits && <span style={{ color: 'var(--amber-400)', fontSize: 10, marginLeft: 6 }}>● unsaved</span>}
                    </div>
                    <div className="audit-editor-actions">
                      <div className="audit-editor-view-toggle">
                        <button
                          type="button"
                          className={`audit-editor-view-btn ${editorView === 'preview' ? 'active' : ''}`}
                          onClick={() => setEditorView('preview')}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          className={`audit-editor-view-btn ${editorView === 'edit' ? 'active' : ''}`}
                          onClick={() => setEditorView('edit')}
                        >
                          Edit
                        </button>
                      </div>
                      <button type="button" className="audit-editor-btn" onClick={copyDocContent}>
                        {copiedDoc ? <Check size={12} /> : <Copy size={12} />}
                        {copiedDoc ? 'Copied' : 'Copy'}
                      </button>
                      {hasUnsavedEdits && (
                        <button type="button" className="audit-editor-btn success" onClick={handleSaveEdit} disabled={saving}>
                          {saving ? <><Sparkles size={12} className="spin" /> Saving...</> : <><Check size={12} /> Save</>}
                        </button>
                      )}
                      <button type="button" className="audit-editor-btn primary" onClick={handleDownloadSingle} disabled={downloading}>
                        {downloading ? <Sparkles size={12} className="spin" /> : <Download size={12} />}
                        Download
                      </button>
                      <button
                        type="button"
                        className="audit-editor-btn"
                        onClick={() => handleGenerate(selectedDoc.documentType)}
                        disabled={generatingType === selectedDoc.documentType}
                        title="Regenerate this document"
                      >
                        <RefreshCw size={12} className={generatingType === selectedDoc.documentType ? 'spin' : ''} />
                        Regenerate
                      </button>
                    </div>
                  </div>

                  {editorView === 'edit' ? (
                    <textarea
                      className="audit-editor-textarea"
                      value={editedContent}
                      onChange={e => { setEditedContent(e.target.value); setHasUnsavedEdits(true); }}
                      spellCheck={false}
                    />
                  ) : (
                    <div className="audit-editor-preview">
                      <MarkdownContent content={selectedDoc.generatedContent || ''} />
                    </div>
                  )}

                  {selectedDoc.validationWarnings && selectedDoc.validationWarnings.length > 0 && (
                    <div className="audit-editor-warnings">
                      {selectedDoc.validationWarnings.map((w, wi) => (
                        <div key={wi} className="audit-editor-warning">
                          <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <EmptyState icon={FileText} title="Select a document" description="Click a document in the list to preview or edit it." />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────

function HistoryTab({ repositoryId, currentAnalysisId, onSelectAnalysis }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/codebases/${repositoryId}/analysis/history`, { credentials: 'include' });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setHistory(data.data);
        }
      } catch (err) {
        console.error('Failed to load analysis history:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [repositoryId]);

  if (loading) return <LoadingState message="Loading analysis history..." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {history.length === 0 ? (
        <EmptyState icon={Clock} title="No analysis history" description="Run your first analysis to start tracking history." />
      ) : (
        <div className="audit-history-list">
          {history.map(item => (
            <div
              key={item._id}
              className={`audit-history-item ${item._id === currentAnalysisId ? 'active' : ''}`}
              onClick={() => onSelectAnalysis && onSelectAnalysis(item._id)}
            >
              <StatusPill status={item.status} />
              <div className="audit-history-date">{formatDate(item.startedAt)}</div>
              {item.commitSha && <span className="audit-history-sha">#{item.commitSha.slice(0, 7)}</span>}
              <span className="audit-history-count">
                {item.findingsCount != null ? `${item.findingsCount} findings` : '—'}
              </span>
              {item.completedAt && (
                <span className="audit-history-count">{formatDate(item.completedAt)}</span>
              )}
              <ChevronRight size={14} style={{ color: 'var(--text-dim)', marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Overview Section ────────────────────────────────────────────────────────

function OverviewSection({ analysis, codebase, onOpenFixPrompt, onOpenComparison }) {
  if (!analysis || analysis.status !== 'completed') return null;

  const findings = analysis.findings || [];
  const counts = countBySeverity(findings);
  const stack = analysis.detectedStack || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Metric grid */}
      <div className="audit-overview-grid">
        <div className="audit-metric-card">
          <div className="audit-metric-label">Total Findings</div>
          <div className="audit-metric-value">{findings.length}</div>
          <div className="audit-metric-sub">across all categories</div>
        </div>
        <div className="audit-metric-card">
          <div className="audit-metric-label">Critical</div>
          <div className="audit-metric-value critical">{counts.CRITICAL || 0}</div>
          <div className="audit-metric-sub">{counts.CRITICAL ? 'Requires immediate fix' : 'No critical risks'}</div>
        </div>
        <div className="audit-metric-card">
          <div className="audit-metric-label">High</div>
          <div className="audit-metric-value high">{counts.HIGH || 0}</div>
          <div className="audit-metric-sub">{counts.HIGH ? 'Prioritize review' : 'No high risks'}</div>
        </div>
        <div className="audit-metric-card">
          <div className="audit-metric-label">Medium</div>
          <div className="audit-metric-value medium">{counts.MEDIUM || 0}</div>
          <div className="audit-metric-sub">Improvement opportunities</div>
        </div>
        <div className="audit-metric-card">
          <div className="audit-metric-label">Low / Info</div>
          <div className="audit-metric-value low">{(counts.LOW || 0) + (counts.INFO || 0)}</div>
          <div className="audit-metric-sub">Best practice notices</div>
        </div>
        <div className="audit-metric-card">
          <div className="audit-metric-label">Recommendations</div>
          <div className="audit-metric-value emerald">{(analysis.recommendations || []).length}</div>
          <div className="audit-metric-sub">Actionable fixes</div>
        </div>
        <div className="audit-metric-card">
          <div className="audit-metric-label">Files Indexed</div>
          <div className="audit-metric-value">{codebase?.stats?.indexedFiles || '—'}</div>
          <div className="audit-metric-sub">Analyzed commit</div>
        </div>
        <div className="audit-metric-card">
          <div className="audit-metric-label">Analysis Date</div>
          <div className="audit-metric-value date">{formatDate(analysis.completedAt)}</div>
          <div className="audit-metric-sub">Status: {analysis.status || 'completed'}</div>
        </div>
      </div>

      {/* AI Fix Prompt Quick Actions Banner */}
      <div className="audit-fix-prompts-banner">
        <div className="audit-fix-banner-left">
          <div className="audit-fix-banner-title">
            <Zap size={16} className="text-cyan" />
            <span>AI Fix Prompt Generator</span>
          </div>
          <div className="audit-fix-banner-desc">
            Generate grounded, actionable prompts for external AI coding agents (Antigravity, Cursor, Claude Code, Gemini CLI) to fix discovered issues.
          </div>
        </div>
        <div className="audit-fix-banner-actions">
          {findings.some(f => ['CRITICAL', 'HIGH'].includes(f.severity)) && (
            <button
              type="button"
              className="audit-fix-action-btn high"
              onClick={() => onOpenFixPrompt && onOpenFixPrompt(findings.filter(f => ['CRITICAL', 'HIGH'].includes(f.severity)), 'security')}
            >
              <Zap size={12} /> Fix Critical / High Issues ({findings.filter(f => ['CRITICAL', 'HIGH'].includes(f.severity)).length})
            </button>
          )}
          <button
            type="button"
            className="audit-fix-action-btn primary"
            onClick={() => onOpenFixPrompt && onOpenFixPrompt(findings, 'full_project')}
          >
            <Sparkles size={12} /> Full Project Fix Plan
          </button>
          <button
            type="button"
            className="audit-fix-action-btn secondary"
            onClick={onOpenComparison}
          >
            <RefreshCw size={12} /> Compare After Fixes
          </button>
        </div>
      </div>

      {/* Stack info */}
      {Object.keys(stack).length > 0 && (
        <div style={{ padding: '14px 16px', background: 'var(--bg-panel)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-md)' }}>
          <div className="audit-section-title" style={{ marginBottom: 10 }}>
            <Layers size={14} /> Detected Technology Stack
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stack.projectType && <span className="audit-badge stack">{stack.projectType}</span>}
            {stack.packageManager && <span className="audit-badge neutral">{stack.packageManager}</span>}
            {Array.isArray(stack.frameworks) && stack.frameworks.map((f, i) => <span key={i} className="audit-badge lang">{f}</span>)}
            {Array.isArray(stack.languages) && stack.languages.map((l, i) => <span key={i} className="audit-badge lang">{l}</span>)}
            {stack.hasTests && <span className="audit-badge branch">✓ Tests</span>}
            {stack.hasDocker && <span className="audit-badge branch">✓ Docker</span>}
            {stack.hasCICD && <span className="audit-badge branch">✓ CI/CD</span>}
            {stack.hasDocumentation && <span className="audit-badge branch">✓ Docs</span>}
          </div>
        </div>
      )}

      {/* Summary */}
      {analysis.summary && (
        <div style={{ padding: '14px 16px', background: 'var(--bg-panel)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-md)' }}>
          <div className="audit-section-title" style={{ marginBottom: 8 }}>
            <BarChart2 size={14} /> Analysis Summary
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{analysis.summary}</div>
        </div>
      )}

      {/* Category cards */}
      <div>
        <div className="audit-section-heading">
          <div className="audit-section-title"><Shield size={14} /> Category Breakdown</div>
        </div>
        <div className="audit-categories-grid">
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const catFindings = findings.filter(f => f.category === key);
            const topSev = catFindings.length > 0 ? getTopSeverity(catFindings) : 'clean';
            const Icon = meta.icon;
            return (
              <div key={key} className="audit-category-card">
                <div className="audit-category-header">
                  <div className="audit-category-name">
                    <Icon size={13} /> {meta.label}
                  </div>
                  <span className={`audit-category-badge ${catFindings.length === 0 ? 'clean' : topSev}`}>
                    {catFindings.length === 0 ? 'Clean' : `${catFindings.length} issue${catFindings.length !== 1 ? 's' : ''}`}
                  </span>
                </div>
                {catFindings.length === 0 ? (
                  <div className="audit-category-desc">No issues detected in this category.</div>
                ) : (
                  <div className="audit-category-desc">
                    Top: {catFindings.filter(f => ['CRITICAL', 'HIGH'].includes(f.severity)).length} critical/high,{' '}
                    {catFindings.filter(f => f.severity === 'MEDIUM').length} medium
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Prompts Tab ─────────────────────────────────────────────────────────────

function PromptsTab({
  repositoryId,
  prompts = [],
  loading,
  onRefresh,
  onOpenPrompt,
  onOpenComparison,
  onNewPrompt,
  showToast,
}) {
  const handleDelete = async (promptId) => {
    if (!window.confirm('Delete this fix prompt?')) return;
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/fix-prompts/${promptId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        showToast('Fix prompt deleted');
        onRefresh();
      } else {
        showToast(data.message || 'Failed to delete');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleDownloadPrompt = (promptId, format = 'md') => {
    window.open(`/api/codebases/${repositoryId}/fix-prompts/${promptId}/download?format=${format}`, '_blank');
    showToast(`Downloading as ${format.toUpperCase()}`);
  };

  const handleCopyPrompt = async (prompt) => {
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/fix-prompts/${prompt._id}`, { credentials: 'include' });
      const json = await res.json();
      if (json.success && json.data) {
        const text = json.data.isUserEdited && json.data.userEditedPrompt
          ? json.data.userEditedPrompt
          : json.data.generatedPrompt;
        navigator.clipboard.writeText(text);
        showToast('Prompt copied to clipboard');
      }
    } catch {
      showToast('Copy failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="audit-section-heading">
        <div className="audit-section-title">
          <Zap size={15} /> Generated AI Fix Prompts
          <span className="audit-section-count">{prompts.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="audit-editor-btn"
            onClick={onOpenComparison}
          >
            <RefreshCw size={12} /> Compare Analysis After Fixes
          </button>
          <button
            type="button"
            className="audit-editor-btn primary"
            onClick={onNewPrompt}
          >
            <Zap size={12} /> New Fix Prompt
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading generated fix prompts..." />
      ) : prompts.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No Fix Prompts Generated Yet"
          description="Select any finding from the Findings tab and click 'Generate AI Fix Prompt' to create tailored instructions for Antigravity, Cursor, Claude Code, or Gemini CLI."
          action={
            <button type="button" className="audit-analyze-btn primary" onClick={onNewPrompt}>
              <Zap size={13} /> Generate First Fix Prompt
            </button>
          }
        />
      ) : (
        <div className="audit-prompts-grid">
          {prompts.map((p) => (
            <div key={p._id} className="audit-prompt-card">
              <div className="audit-prompt-card-header">
                <div className="audit-prompt-title">{p.title}</div>
                <span className={`audit-prompt-status-pill ${p.status?.toLowerCase() || 'generated'}`}>
                  {p.status?.replace(/_/g, ' ') || 'GENERATED'}
                </span>
              </div>

              <div className="audit-prompt-badges">
                <span className="audit-badge branch">{p.targetAgent || 'generic'}</span>
                <span className="audit-badge neutral">{p.mode?.replace(/_/g, ' ')}</span>
                <span className="audit-badge sha">
                  {p.selectedFindingIds?.length || 0} issue{(p.selectedFindingIds?.length || 0) !== 1 ? 's' : ''}
                </span>
                {p.promptTokensEst > 0 && (
                  <span className="audit-badge stack">~{p.promptTokensEst} tokens</span>
                )}
                {p.isStale && (
                  <span className="audit-badge" style={{ borderColor: 'var(--amber-400)', color: 'var(--amber-400)' }}>
                    ⚠ Stale Analysis
                  </span>
                )}
                {p.isUserEdited && (
                  <span className="audit-badge" style={{ borderColor: 'var(--purple-400)', color: 'var(--purple-400)' }}>
                    ✓ Edited
                  </span>
                )}
              </div>

              <div className="audit-prompt-date">
                Created {formatDate(p.createdAt)}
              </div>

              <div className="audit-prompt-card-actions">
                <button
                  type="button"
                  className="audit-prompt-btn view"
                  onClick={() => onOpenPrompt(p)}
                >
                  <Eye size={12} /> View &amp; Edit
                </button>
                <button
                  type="button"
                  className="audit-prompt-btn"
                  onClick={() => handleCopyPrompt(p)}
                  title="Copy full prompt text"
                >
                  <Copy size={12} /> Copy
                </button>
                <button
                  type="button"
                  className="audit-prompt-btn"
                  onClick={() => handleDownloadPrompt(p._id, 'md')}
                  title="Download Markdown"
                >
                  <Download size={12} /> .MD
                </button>
                <button
                  type="button"
                  className="audit-prompt-btn"
                  onClick={() => handleDownloadPrompt(p._id, 'txt')}
                  title="Download TXT"
                >
                  <Download size={12} /> .TXT
                </button>
                <button
                  type="button"
                  className="audit-prompt-btn delete"
                  onClick={() => handleDelete(p._id)}
                  title="Delete prompt"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Post-Fix Comparison Modal ───────────────────────────────────────────────

function ComparisonModal({ repositoryId, onClose, showToast }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    const fetchComparison = async () => {
      try {
        const res = await fetch(`/api/codebases/${repositoryId}/analysis/compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'include',
        });
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
        } else {
          showToast(json.message || 'Comparison unavailable');
        }
      } catch (err) {
        showToast(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchComparison();
  }, [repositoryId]);

  return (
    <div className="fix-modal-backdrop" onClick={onClose}>
      <div className="fix-modal-container" style={{ maxHeight: 720 }} onClick={e => e.stopPropagation()}>
        <div className="fix-modal-header">
          <div className="fix-modal-title-group">
            <div className="fix-modal-title">
              <RefreshCw size={18} className="text-cyan" />
              <span>Post-Fix Verification &amp; Comparison</span>
            </div>
            <span className="fix-modal-subtitle">
              Verify which issues were resolved by your external coding agent
            </span>
          </div>
          <button type="button" className="fix-modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="fix-content-area" style={{ padding: '24px 28px' }}>
          {loading ? (
            <LoadingState message="Analyzing audit diff..." />
          ) : !data || !data.comparisonAvailable ? (
            <EmptyState
              icon={Clock}
              title="Only One Analysis Run Exists"
              description="To compare fixes, run an AI coding agent to modify your code, re-index or re-analyze the repository, and return here to inspect resolved findings."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Metrics Grid */}
              <div className="audit-overview-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="audit-metric-card">
                  <div className="audit-metric-label">Fix Rate</div>
                  <div className="audit-metric-value emerald">{data.metrics.fixRatePercentage}%</div>
                  <div className="audit-metric-sub">Resolved issues</div>
                </div>
                <div className="audit-metric-card">
                  <div className="audit-metric-label">Resolved</div>
                  <div className="audit-metric-value emerald">{data.metrics.resolvedCount}</div>
                  <div className="audit-metric-sub">No longer present</div>
                </div>
                <div className="audit-metric-card">
                  <div className="audit-metric-label">Still Present</div>
                  <div className="audit-metric-value medium">{data.metrics.stillPresentCount}</div>
                  <div className="audit-metric-sub">Requires further fixes</div>
                </div>
                <div className="audit-metric-card">
                  <div className="audit-metric-label">New Findings</div>
                  <div className="audit-metric-value low">{data.metrics.newFindingsCount}</div>
                  <div className="audit-metric-sub">Detected in new run</div>
                </div>
              </div>

              {/* Resolved List */}
              {data.resolvedFindings.length > 0 && (
                <div>
                  <h4 style={{ color: 'var(--emerald-400)', fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle size={14} /> Resolved Issues ({data.resolvedFindings.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.resolvedFindings.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(52, 211, 153, 0.08)', border: '1px solid rgba(52, 211, 153, 0.25)', borderRadius: 'var(--radius-sm)' }}>
                        <span style={{ color: 'var(--emerald-400)', fontWeight: 700, fontSize: 12 }}>✓</span>
                        <span style={{ color: '#fff', fontSize: 12.5, fontWeight: 600 }}>{f.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{f.id}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{f.filePath}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Still Present List */}
              {data.stillPresentFindings.length > 0 && (
                <div>
                  <h4 style={{ color: 'var(--amber-400)', fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} /> Still Present ({data.stillPresentFindings.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.stillPresentFindings.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.25)', borderRadius: 'var(--radius-sm)' }}>
                        <span style={{ color: 'var(--amber-400)', fontWeight: 700, fontSize: 12 }}>⚠</span>
                        <span style={{ color: '#fff', fontSize: 12.5, fontWeight: 600 }}>{f.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{f.id}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{f.filePath}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New Findings List */}
              {data.newFindings.length > 0 && (
                <div>
                  <h4 style={{ color: 'var(--cyan-400)', fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Info size={14} /> New Findings in Latest Commit ({data.newFindings.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.newFindings.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(34, 211, 238, 0.08)', border: '1px solid rgba(34, 211, 238, 0.25)', borderRadius: 'var(--radius-sm)' }}>
                        <span style={{ color: 'var(--cyan-400)', fontWeight: 700, fontSize: 12 }}>+</span>
                        <span style={{ color: '#fff', fontSize: 12.5, fontWeight: 600 }}>{f.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{f.id}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{f.filePath}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="fix-modal-footer">
          <button type="button" className="fix-btn-action secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AuditDashboard({
  codebase,
  onBack,
  showToast,
  onViewFile,
  initialTab = 'overview',
  showBackBtn = false
}) {
  const [analysis, setAnalysis] = useState(null);
  const [analysisId, setAnalysisId] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState({ status: 'idle' });
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab || 'overview');
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [fixModalState, setFixModalState] = useState({
    isOpen: false,
    findings: [],
    mode: 'single_issue',
    existingPrompt: null,
  });
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const repositoryId = codebase?._id;

  // ── Fetch saved fix prompts ──
  const fetchSavedPrompts = useCallback(async () => {
    if (!repositoryId) return;
    setLoadingPrompts(true);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/fix-prompts`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setSavedPrompts(data.data);
      } else {
        setSavedPrompts([]);
      }
    } catch {
      setSavedPrompts([]);
    } finally {
      setLoadingPrompts(false);
    }
  }, [repositoryId]);

  useEffect(() => {
    fetchSavedPrompts();
  }, [fetchSavedPrompts]);

  // ── Fetch latest analysis ──
  const fetchAnalysis = useCallback(async () => {
    if (!repositoryId) return;
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/analysis`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.data) {
        setAnalysis(data.data);
        setAnalysisId(data.data._id);
        setAnalysisStatus({ status: data.data.status });
      } else {
        setAnalysis(null);
        setAnalysisStatus({ status: 'not_analyzed' });
      }
    } catch {
      setAnalysisStatus({ status: 'not_analyzed' });
    } finally {
      setLoadingAnalysis(false);
    }
  }, [repositoryId]);

  useEffect(() => { fetchAnalysis(); }, [fetchAnalysis]);

  // ── Poll if running ──
  useEffect(() => {
    if (!['running', 'pending'].includes(analysisStatus.status)) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/codebases/${repositoryId}/analysis/status`, { credentials: 'include' });
        const data = await res.json();
        if (data.success && data.data) {
          if (data.data.status === 'completed' || data.data.status === 'failed') {
            setAnalysisStatus({ status: data.data.status });
            await fetchAnalysis();
          } else {
            setAnalysisStatus({ status: data.data.status, percentage: data.data.percentage, message: data.data.message });
          }
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [analysisStatus.status, repositoryId, fetchAnalysis]);

  // ── Trigger Analysis ──
  const triggerAnalysis = async () => {
    if (!repositoryId) return;
    if (codebase?.status !== 'ready') {
      showToast('Repository must be fully indexed before analysis. Wait for indexing to complete.');
      return;
    }
    setTriggering(true);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/analyze`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        showToast('Analysis started. This may take a moment...');
        setAnalysisStatus({ status: 'pending' });
        setAnalysis(prev => prev ? { ...prev, status: 'pending' } : null);
        setActiveTab('overview');
      } else {
        showToast(data.message || 'Failed to start analysis');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setTriggering(false);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart2 },
    { id: 'findings', label: 'Findings', icon: AlertTriangle, count: (analysis?.findings || []).length },
    { id: 'recommendations', label: 'Recommendations', icon: Sparkles, count: (analysis?.recommendations || []).length },
    { id: 'prompts', label: 'Fix Prompts', icon: Zap, count: savedPrompts.length },
    { id: 'documentation', label: 'Documentation', icon: BookOpen },
    { id: 'history', label: 'History', icon: Clock },
  ];

  const isRunning = ['running', 'pending'].includes(analysisStatus.status);
  const hasResults = analysis?.status === 'completed';

  return (
    <div className="audit-dashboard">
      {/* Repo Header */}
      <div className="audit-repo-header">
        <div className="audit-repo-meta">
          {showBackBtn && (
            <button
              type="button"
              className="audit-back-btn"
              onClick={onBack}
            >
              <ArrowLeft size={13} /> Back to Codebase
            </button>
          )}
          <div className="audit-repo-name">
            <GitBranch size={18} className="text-cyan" />
            {codebase?.name || 'Repository'}
          </div>
          <div className="audit-repo-url">{codebase?.sourceUrl || codebase?.sourceType || '—'}</div>
          <div className="audit-repo-badges">
            {codebase?.defaultBranch && <span className="audit-badge branch"><GitBranch size={10} /> {codebase.defaultBranch}</span>}
            {codebase?.indexedCommitSha && <span className="audit-badge sha">#{codebase.indexedCommitSha.slice(0, 7)}</span>}
            {(codebase?.stats?.languages || []).slice(0, 4).map((l, i) => (
              <span key={i} className="audit-badge lang">{l.name}</span>
            ))}
          </div>
        </div>

        <div className="audit-header-actions-col">
          <div className="audit-header-actions-row">
            <StatusPill status={analysisStatus.status} />
            <button
              type="button"
              className={`audit-analyze-btn ${hasResults ? 'secondary' : 'primary'}`}
              onClick={triggerAnalysis}
              disabled={triggering || isRunning || codebase?.status !== 'ready'}
            >
              {triggering || isRunning ? (
                <><Sparkles size={13} className="spin" /> {isRunning ? 'Analyzing...' : 'Starting...'}</>
              ) : hasResults ? (
                <><RefreshCw size={13} /> Re-analyze</>
              ) : (
                <><Sparkles size={13} /> Start Analysis</>
              )}
            </button>
          </div>
          {codebase?.status !== 'ready' && (
            <span className="audit-indexing-warning">
              ⚠ Repository must be fully indexed first
            </span>
          )}
        </div>
      </div>

      {/* Analysis Progress Banner */}
      {isRunning && (
        <div className="audit-progress-banner">
          <div className="audit-progress-header">
            <Sparkles size={14} className="spin" />
            AI Codebase Audit In Progress
          </div>
          <div className="audit-progress-bar-bg">
            <div className="audit-progress-bar-fill" style={{ width: `${analysisStatus.percentage || 30}%` }} />
          </div>
          {analysisStatus.message && (
            <div className="audit-progress-msg">{analysisStatus.message}</div>
          )}
        </div>
      )}

      {/* Loading State */}
      {loadingAnalysis && <LoadingState message="Loading analysis results..." />}

      {/* Not analyzed state */}
      {!loadingAnalysis && !hasResults && !isRunning && (
        <div className="audit-not-ready">
          <div className="audit-not-ready-icon">
            <Sparkles size={28} className="text-cyan" />
          </div>
          <h3>No Analysis Yet</h3>
          <p>
            Click <strong>Start Analysis</strong> to perform a comprehensive AI-powered audit of this repository.
            The system will analyze architecture, authentication, API quality, dependencies, testing, deployment, and more.
          </p>
          {analysis?.status === 'failed' && (
            <div style={{ fontSize: 12, color: 'var(--rose-400)', marginTop: 8 }}>
              ⚠ Last analysis failed: {analysis.errorMessage}
            </div>
          )}
        </div>
      )}

      {/* Dashboard with results */}
      {!loadingAnalysis && (hasResults || activeTab === 'documentation' || activeTab === 'history' || activeTab === 'prompts') && (
        <>
          {/* Tabs */}
          <div className="audit-tabs">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`audit-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={13} />
                  {tab.label}
                  {tab.count != null && tab.count > 0 && (
                    <span className="audit-tab-count">{tab.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {activeTab === 'overview' && (
            hasResults
              ? <OverviewSection
                  analysis={analysis}
                  codebase={codebase}
                  onOpenFixPrompt={(findings, mode) => setFixModalState({ isOpen: true, findings, mode, existingPrompt: null })}
                  onOpenComparison={() => setComparisonModalOpen(true)}
                />
              : <EmptyState icon={BarChart2} title="Run an analysis to see results" />
          )}

          {activeTab === 'findings' && (
            hasResults
              ? <FindingsTab
                  findings={analysis?.findings || []}
                  onViewFile={onViewFile}
                  showToast={showToast}
                  onOpenFixPrompt={(findings, mode) => setFixModalState({ isOpen: true, findings, mode, existingPrompt: null })}
                />
              : <EmptyState icon={AlertTriangle} title="Run an analysis to see findings" />
          )}

          {activeTab === 'recommendations' && (
            hasResults
              ? <RecommendationsTab recommendations={analysis?.recommendations || []} />
              : <EmptyState icon={Sparkles} title="Run an analysis to see recommendations" />
          )}

          {activeTab === 'prompts' && (
            <PromptsTab
              repositoryId={repositoryId}
              prompts={savedPrompts}
              loading={loadingPrompts}
              onRefresh={fetchSavedPrompts}
              onOpenPrompt={(p) => setFixModalState({ isOpen: true, findings: [], mode: p.mode, existingPrompt: p })}
              onOpenComparison={() => setComparisonModalOpen(true)}
              onNewPrompt={() => setFixModalState({ isOpen: true, findings: analysis?.findings || [], mode: 'related_issues', existingPrompt: null })}
              showToast={showToast}
            />
          )}

          {activeTab === 'documentation' && (
            <DocumentationTab
              repositoryId={repositoryId}
              codebase={codebase}
              analysis={analysis}
              showToast={showToast}
            />
          )}

          {activeTab === 'history' && (
            <HistoryTab
              repositoryId={repositoryId}
              currentAnalysisId={analysisId}
              onSelectAnalysis={(id) => {
                // TODO: load specific analysis version
                showToast('Analysis version loading coming soon');
              }}
            />
          )}
        </>
      )}

      {/* Fix Prompt Modal */}
      {fixModalState.isOpen && (
        <FixPromptModal
          repositoryId={repositoryId}
          findings={fixModalState.findings}
          selectedFindings={fixModalState.findings}
          initialMode={fixModalState.mode}
          existingPrompt={fixModalState.existingPrompt}
          onClose={() => setFixModalState({ isOpen: false, findings: [], mode: 'single_issue', existingPrompt: null })}
          onSaved={() => fetchSavedPrompts()}
          onPromptSaved={() => fetchSavedPrompts()}
          showToast={showToast}
        />
      )}

      {/* Post-Fix Comparison Modal */}
      {comparisonModalOpen && (
        <ComparisonModal
          repositoryId={repositoryId}
          onClose={() => setComparisonModalOpen(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

