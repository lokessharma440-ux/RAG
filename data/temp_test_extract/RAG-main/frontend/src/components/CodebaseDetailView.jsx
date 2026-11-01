import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  FileCode,
  Bot,
  Layers,
  Shield,
  BookOpen,
  Search,
  Copy,
  Check,
  Send,
  Sparkles,
  ChevronRight,
  GitBranch,
  Code,
} from 'lucide-react';
import MarkdownContent from './MarkdownContent.jsx';
import AuditDashboard from './AuditDashboard.jsx';
import './CodebaseDetailView.css';

export default function CodebaseDetailView({
  codebaseId,
  onBack,
  showToast,
  currentUser: _currentUser,
}) {
  const [codebase, setCodebase] = useState(null);
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'chat' | 'deps' | 'security' | 'docs'
  const [_loading, setLoading] = useState(true);

  // Files & Viewer State
  const [files, setFiles] = useState([]);
  const [fileSearch, setFileSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [highlightRange, setHighlightRange] = useState(null); // { startLine, endLine }
  const [loadingContent, setLoadingContent] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Chat State
  const [messages, setMessages] = useState([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const chatBottomRef = useRef(null);

  // Dependencies & Impact State
  const [dependencyGraph, setDependencyGraph] = useState(null);
  const [impactTarget, setImpactTarget] = useState('');
  const [impactReport, setImpactReport] = useState(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  // Security Audit State
  const [securityFindings, setSecurityFindings] = useState([]);
  const [loadingSecurity, setLoadingSecurity] = useState(false);

  // Documentation State
  const [docType, setDocType] = useState('architecture');
  const [generatedDoc, setGeneratedDoc] = useState('');
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [copiedDoc, setCopiedDoc] = useState(false);

  // Fetch Codebase Details
  const fetchDetails = async () => {
    try {
      const res = await fetch(`/api/codebases/${codebaseId}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.data) {
        setCodebase(data.data);
      }
    } catch (err) {
      console.error('Failed to load codebase:', err);
    }
  };

  // Fetch Files
  const fetchFiles = async () => {
    try {
      const res = await fetch(`/api/codebases/${codebaseId}/files`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setFiles(data.data);
        if (data.data.length > 0 && !selectedFile) {
          loadFileContent(data.data[0].relativePath);
        }
      }
    } catch (err) {
      console.error('Failed to load files:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load Content for Viewer
  const loadFileContent = async (filePath, range = null) => {
    setLoadingContent(true);
    setSelectedFile(filePath);
    setHighlightRange(range);
    try {
      const res = await fetch(`/api/codebases/${codebaseId}/files/content?path=${encodeURIComponent(filePath)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success && data.data) {
        setFileContent(data.data.content);
      } else {
        setFileContent('// File content unavailable.');
      }
    } catch {
      setFileContent('// Failed to load file content.');
    } finally {
      setLoadingContent(false);
    }
  };

  // Fetch Dependencies
  const fetchDependencies = async () => {
    try {
      const res = await fetch(`/api/codebases/${codebaseId}/dependencies`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.data) {
        setDependencyGraph(data.data);
      }
    } catch (err) {
      console.error('Failed to load dependencies:', err);
    }
  };

  // Fetch Security Audit
  const fetchSecurityAudit = async () => {
    setLoadingSecurity(true);
    try {
      const res = await fetch(`/api/codebases/${codebaseId}/security-analysis`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setSecurityFindings(data.data);
      }
    } catch (err) {
      console.error('Failed to run security audit:', err);
    } finally {
      setLoadingSecurity(false);
    }
  };

  useEffect(() => {
    fetchDetails();
    fetchFiles();
  }, [codebaseId]);

  // Auto-poll if indexing is in-flight
  useEffect(() => {
    if (!codebase) return;
    const isIndexing = ['queued', 'fetching', 'extracting', 'discovering_files', 'parsing', 'chunking', 'embedding', 'indexing'].includes(codebase.status);
    if (!isIndexing) return;

    const interval = setInterval(() => {
      fetchDetails();
      fetchFiles();
    }, 2500);

    return () => clearInterval(interval);
  }, [codebase?.status, codebaseId]);

  useEffect(() => {
    if (activeTab === 'deps' && !dependencyGraph) fetchDependencies();
    if (activeTab === 'security' && securityFindings.length === 0) fetchSecurityAudit();
  }, [activeTab]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Handle Codebase Chat
  const handleSendMessage = async (customPrompt) => {
    const query = (customPrompt || inputQuery).trim();
    if (!query || isGenerating) return;

    setInputQuery('');

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsGenerating(true);

    try {
      const res = await fetch(`/api/codebases/${codebaseId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to generate answer.');
      }

      const botMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: data.data.answer || data.data.reply || '',
        sources: data.data.sources || [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      const errorMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        text: `Unable to complete query: ${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Run Impact Analysis
  const handleRunImpact = async (e) => {
    e.preventDefault();
    if (!impactTarget.trim()) return;

    setLoadingImpact(true);
    try {
      const res = await fetch(`/api/codebases/${codebaseId}/impact?target=${encodeURIComponent(impactTarget.trim())}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success && data.data) {
        setImpactReport(data.data);
      } else {
        showToast(data.message || 'Impact analysis failed.');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setLoadingImpact(false);
    }
  };

  // Generate Documentation
  const handleGenerateDoc = async () => {
    setGeneratingDoc(true);
    try {
      const res = await fetch(`/api/codebases/${codebaseId}/documentation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success && data.data?.documentation) {
        setGeneratedDoc(data.data.documentation);
      } else {
        showToast(data.message || 'Documentation generation failed.');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setGeneratingDoc(false);
    }
  };

  // Clickable Citation Handler
  const handleCitationClick = (citation) => {
    // citation format: "path/to/file.js:10-25"
    const [filePath, rangeStr] = citation.split(':');
    let range = null;
    if (rangeStr) {
      const [start, end] = rangeStr.split('-').map((n) => parseInt(n, 10));
      if (!isNaN(start)) {
        range = { startLine: start, endLine: end || start };
      }
    }

    setActiveTab('files');
    loadFileContent(filePath, range);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(fileContent);
    setCopiedCode(true);
    showToast('Source copied to clipboard');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyDoc = () => {
    navigator.clipboard.writeText(generatedDoc);
    setCopiedDoc(true);
    showToast('Markdown documentation copied');
    setTimeout(() => setCopiedDoc(false), 2000);
  };

  const filteredFileList = files.filter((f) =>
    f.relativePath.toLowerCase().includes(fileSearch.toLowerCase())
  );

  return (
    <div className="dev-codebase-detail-page">
      {/* Top Bar Navigation */}
      <div className="dev-detail-topbar">
        <button type="button" className="dev-back-link" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>Back to Codebases</span>
        </button>

        <div className="dev-detail-meta-group">
          <div className="dev-detail-repo-name">
            <GitBranch size={16} className="text-cyan" />
            <span className="font-bold">{codebase?.name || 'Repository'}</span>
            {codebase?.indexedCommitSha && (
              <span className="dev-detail-sha font-mono">
                #{codebase.indexedCommitSha.substring(0, 7)}
              </span>
            )}
          </div>
          <span className={`dev-status-pill font-mono ${codebase?.status || 'ready'}`}>
            {codebase?.status || 'ready'}
          </span>
        </div>
      </div>

      {/* Live Indexing Banner if in-flight */}
      {codebase && ['queued', 'fetching', 'extracting', 'discovering_files', 'parsing', 'chunking', 'embedding', 'indexing'].includes(codebase.status) && (
        <div className="dev-detail-indexing-banner">
          <div className="dev-indexing-banner-header">
            <Sparkles size={14} className="spin text-cyan" />
            <span className="font-bold">Indexing in Progress ({codebase.progress?.percentage || 15}%)</span>
            <span className="dev-indexing-stage font-mono">{codebase.status.toUpperCase()}</span>
          </div>
          <p className="dev-indexing-banner-msg">
            {codebase.progress?.message || 'Extracting source files and computing 384-d vector embeddings...'}
          </p>
          <div className="dev-indexing-progress-bar">
            <div
              className="dev-indexing-progress-fill"
              style={{ width: `${codebase.progress?.percentage || 15}%` }}
            />
          </div>
        </div>
      )}

      {/* Workspace Tabs */}
      <div className="dev-detail-tabs">
        <button
          type="button"
          className={`dev-detail-tab ${activeTab === 'auditor' ? 'active' : ''}`}
          onClick={() => setActiveTab('auditor')}
        >
          <Sparkles size={14} className="text-cyan" />
          AI Auditor
        </button>
        <button
          type="button"
          className={`dev-detail-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          <FileCode size={14} />
          Code Explorer
        </button>
        <button
          type="button"
          className={`dev-detail-tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          <Bot size={14} />
          Q&amp;A Chat
        </button>
        <button
          type="button"
          className={`dev-detail-tab ${activeTab === 'deps' ? 'active' : ''}`}
          onClick={() => setActiveTab('deps')}
        >
          <Layers size={14} />
          Dependencies &amp; Impact
        </button>
        <button
          type="button"
          className={`dev-detail-tab ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <Shield size={14} />
          Security Audit
          {securityFindings.length > 0 && (
            <span className="dev-tab-counter font-mono">{securityFindings.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`dev-detail-tab ${activeTab === 'docs' ? 'active' : ''}`}
          onClick={() => setActiveTab('docs')}
        >
          <BookOpen size={14} />
          Documentation
        </button>
      </div>

      {/* Tab 0: AI Codebase Auditor Dashboard */}
      {activeTab === 'auditor' && (
        <AuditDashboard
          codebase={codebase}
          showToast={showToast}
          initialTab="overview"
          onViewFile={(filePath, startLine, endLine) => {
            setActiveTab('files');
            loadFileContent(filePath, startLine ? { startLine, endLine: endLine || startLine } : null);
          }}
        />
      )}

      {/* Tab 1: Code Explorer & Viewer */}
      {activeTab === 'files' && (
        <div className="dev-files-workspace">
          {/* Left File Tree Sidebar */}
          <div className="dev-file-tree-pane">
            <div className="dev-file-search-wrap">
              <Search size={13} className="text-gray" />
              <input
                type="text"
                className="dev-file-search-input"
                placeholder="Search files..."
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
              />
            </div>
            <div className="dev-file-list">
              {filteredFileList.length === 0 ? (
                <div className="dev-files-empty-state">
                  <FileCode size={24} className="text-gray" />
                  <span>
                    {codebase && ['queued', 'fetching', 'extracting', 'discovering_files', 'parsing', 'chunking', 'embedding', 'indexing'].includes(codebase.status)
                      ? 'Discovering source files...'
                      : 'No indexed source files found.'}
                  </span>
                </div>
              ) : (
                filteredFileList.map((file) => {
                  const isSelected = selectedFile === file.relativePath;
                  return (
                    <div
                      key={file._id}
                      className={`dev-file-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => loadFileContent(file.relativePath)}
                    >
                      <FileCode size={13} className="dev-file-icon" />
                      <span className="dev-file-path" title={file.relativePath}>
                        {file.relativePath}
                      </span>
                      <span className="dev-file-lines font-mono">{file.lineCount}L</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Source Code Viewer */}
          <div className="dev-source-viewer-pane">
            <div className="dev-viewer-header">
              <div className="dev-viewer-filename font-mono">
                <span>{selectedFile || 'Select a file'}</span>
                {highlightRange && (
                  <span className="dev-citation-highlight-tag">
                    Highlighted lines {highlightRange.startLine}-{highlightRange.endLine}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="dev-code-copy-btn"
                onClick={copyCode}
                title="Copy full source"
                disabled={!selectedFile || !fileContent}
              >
                {copiedCode ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
                <span>{copiedCode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="dev-viewer-body">
              {loadingContent ? (
                <div className="dev-viewer-loading">
                  <Sparkles size={14} className="spin text-cyan" style={{ marginRight: 8 }} />
                  Loading {selectedFile}...
                </div>
              ) : selectedFile && fileContent ? (
                <div className="dev-code-lines-wrap">
                  {fileContent.split('\n').map((line, idx) => {
                    const lineNum = idx + 1;
                    const isHighlighted =
                      highlightRange &&
                      lineNum >= highlightRange.startLine &&
                      lineNum <= highlightRange.endLine;

                    return (
                      <div
                        key={idx}
                        className={`dev-code-line-row ${isHighlighted ? 'highlighted' : ''}`}
                      >
                        <span className="dev-code-lineno font-mono">{lineNum}</span>
                        <pre className="dev-code-linetext font-mono">
                          <code>{line || ' '}</code>
                        </pre>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="dev-viewer-empty-placeholder">
                  <FileCode size={38} className="dev-placeholder-icon" />
                  <h4 className="dev-placeholder-title">Select a file to inspect</h4>
                  <p className="dev-placeholder-desc">
                    Choose any source file from the repository tree on the left to view syntax-highlighted code,
                    line numbers, and grounded citation ranges.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Codebase Q&A Chat */}
      {activeTab === 'chat' && (
        <div className="dev-codebase-chat-workspace">
          <div className="dev-chat-scrollarea">
            {messages.length === 0 ? (
              <div className="dev-chat-empty-state">
                <div className="dev-chat-empty-icon">
                  <Code size={26} />
                </div>
                <h2 className="dev-chat-empty-title">Codebase Q&amp;A Assistant</h2>
                <p className="dev-chat-empty-subtitle">
                  Ask questions grounded strictly in "{codebase?.name || 'this repository'}".
                  Answers cite exact original file lines and are synthesized with Google Gemini.
                </p>
                <div className="dev-chat-prompts-grid">
                  {[
                    'Explain the high-level architecture of this codebase',
                    'How does user authentication and session management work?',
                    'List all API routes and their controller handlers',
                    'Where are errors handled and security policies enforced?',
                  ].map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="dev-suggested-prompt-card"
                      onClick={() => handleSendMessage(p)}
                    >
                      <span>{p}</span>
                      <ChevronRight size={13} className="prompt-arrow" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="dev-messages-list">
                {messages.map((msg) => (
                  <div key={msg.id} className={`dev-message-row ${msg.role}`}>
                    {msg.role === 'user' ? (
                      <div className="dev-user-message-bubble">
                        <p className="dev-user-message-text">{msg.text}</p>
                        <span className="dev-message-time">{msg.timestamp}</span>
                      </div>
                    ) : (
                      <div className="dev-assistant-card">
                        <div className="dev-assistant-card-header">
                          <div className="dev-assistant-badge font-mono">
                            <Sparkles size={13} style={{ marginRight: 4 }} />
                            <span>DevMind AI</span>
                          </div>
                        </div>

                        <div className="dev-assistant-card-body">
                          <MarkdownContent content={msg.text} />
                        </div>

                        {/* Grounded Code Citations */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="dev-sources-section">
                            <div className="dev-sources-header font-mono">
                              <span>GROUNDED CITATIONS ({msg.sources.length}) — CLICK TO VIEW</span>
                            </div>
                            <div className="dev-citations-grid">
                              {msg.sources.map((src, sIdx) => (
                                <button
                                  key={sIdx}
                                  type="button"
                                  className="dev-citation-chip font-mono"
                                  onClick={() => handleCitationClick(src.citation)}
                                  title={`Open ${src.citation} in code viewer`}
                                >
                                  <FileCode size={11} />
                                  <span>{src.citation}</span>
                                  {src.symbolName && (
                                    <span className="dev-citation-symbol">({src.symbolName})</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {isGenerating && (
                  <div className="dev-message-row assistant">
                    <div className="dev-assistant-card generating">
                      <div className="dev-generating-pulse">
                        <Sparkles size={14} className="spin text-cyan" />
                        <span>Searching 384-d code vector space and generating grounded answer...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>
            )}
          </div>

          <div className="dev-chat-input-bar">
            <textarea
              className="dev-chat-textarea"
              placeholder={`Ask a question about ${codebase?.name || 'this codebase'}...`}
              rows={1}
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <button
              type="button"
              className="dev-chat-send-btn"
              onClick={() => handleSendMessage()}
              disabled={isGenerating || !inputQuery.trim()}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: Cross-File Dependencies & Impact Analysis */}
      {activeTab === 'deps' && (
        <div className="dev-deps-workspace">
          {/* Impact Analysis Tool */}
          <div className="dev-impact-card">
            <h3 className="dev-panel-title">Downstream Change Impact Analyzer</h3>
            <p className="dev-panel-desc">
              Enter any file path or exported function name to trace all dependent modules,
              downstream API routes, and affected services.
            </p>
            <form onSubmit={handleRunImpact} className="dev-impact-form">
              <input
                type="text"
                className="dev-modal-input"
                placeholder="e.g. authController or routes/authRoutes.js"
                value={impactTarget}
                onChange={(e) => setImpactTarget(e.target.value)}
              />
              <button
                type="submit"
                className="dev-btn-solid"
                disabled={loadingImpact || !impactTarget.trim()}
              >
                {loadingImpact ? 'Analyzing Impact...' : 'Analyze Impact'}
              </button>
            </form>

            {impactReport && (
              <div className="dev-impact-report">
                <div className="dev-impact-summary">
                  <span className={`dev-risk-pill font-mono ${impactReport.riskLevel.toLowerCase()}`}>
                    Risk: {impactReport.riskLevel}
                  </span>
                  <span>{impactReport.summary}</span>
                </div>
                {impactReport.affectedFiles.length > 0 && (
                  <div className="dev-impact-section">
                    <span className="dev-impact-label font-mono">DIRECTLY AFFECTED FILES:</span>
                    <ul className="dev-impact-list font-mono">
                      {impactReport.affectedFiles.map((af, afIdx) => (
                        <li key={afIdx} onClick={() => { setActiveTab('files'); loadFileContent(af); }}>
                          {af} →
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {impactReport.affectedRoutes.length > 0 && (
                  <div className="dev-impact-section">
                    <span className="dev-impact-label font-mono">AFFECTED EXPOSED ROUTES:</span>
                    <ul className="dev-impact-list font-mono">
                      {impactReport.affectedRoutes.map((ar, arIdx) => (
                        <li key={arIdx}>
                          <strong>{ar.route}</strong> (in {ar.file}:{ar.line})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Relationship Graph List */}
          <div className="dev-relationships-card">
            <h3 className="dev-panel-title">
              Indexed Relationships ({dependencyGraph?.totalRelationships || 0})
            </h3>
            <div className="dev-relationships-table-wrap">
              <table className="dev-markdown-table font-mono">
                <thead>
                  <tr>
                    <th>Source File</th>
                    <th>Relationship</th>
                    <th>Target / Symbol</th>
                    <th>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {(dependencyGraph?.edges || []).slice(0, 100).map((edge, eIdx) => (
                    <tr key={eIdx}>
                      <td onClick={() => { setActiveTab('files'); loadFileContent(edge.source); }} className="clickable-cell">
                        {edge.source}
                      </td>
                      <td>
                        <span className="dev-rel-pill">{edge.type}</span>
                      </td>
                      <td>{edge.target || edge.symbol}</td>
                      <td>{edge.lineNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Security Audit */}
      {activeTab === 'security' && (
        <div className="dev-security-workspace">
          <div className="dev-security-header-card">
            <div className="dev-panel-title-row">
              <Shield size={20} className="text-cyan" />
              <h3 className="dev-panel-title">Static Security &amp; Vulnerability Audit</h3>
            </div>
            <p className="dev-panel-desc">
              Deterministic static analysis of repository source files. Detects dangerous dynamic execution,
              injection patterns, hardcoded credentials, and insecure cookie configurations with line-accurate evidence.
            </p>
          </div>

          {loadingSecurity ? (
            <div className="dev-loading-card font-mono">Running security audit scan...</div>
          ) : securityFindings.length === 0 ? (
            <div className="dev-security-empty font-mono">
              <Check size={20} className="text-emerald" style={{ marginRight: 8 }} />
              <span>No critical static security anti-patterns detected in indexed files.</span>
            </div>
          ) : (
            <div className="dev-security-findings-list">
              {securityFindings.map((finding) => (
                <div key={finding.id} className={`dev-finding-card ${finding.severity.toLowerCase()}`}>
                  <div className="dev-finding-header">
                    <span className={`dev-severity-tag font-mono ${finding.severity.toLowerCase()}`}>
                      {finding.severity}
                    </span>
                    <h4 className="dev-finding-title">{finding.title}</h4>
                    <span className="dev-finding-path font-mono" onClick={() => { setActiveTab('files'); loadFileContent(finding.filePath, { startLine: finding.startLine, endLine: finding.endLine }); }}>
                      {finding.filePath}:{finding.startLine} →
                    </span>
                  </div>

                  <p className="dev-finding-explanation">{finding.riskExplanation}</p>

                  <div className="dev-finding-excerpt">
                    <pre className="font-mono">
                      <code>{finding.codeExcerpt}</code>
                    </pre>
                  </div>

                  <div className="dev-finding-remediation">
                    <strong>Remediation:</strong> {finding.remediation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Documentation Generator & Management Studio */}
      {activeTab === 'docs' && (
        <AuditDashboard
          codebase={codebase}
          showToast={showToast}
          initialTab="documentation"
          onViewFile={(filePath, startLine, endLine) => {
            setActiveTab('files');
            loadFileContent(filePath, startLine ? { startLine, endLine: endLine || startLine } : null);
          }}
        />
      )}
    </div>
  );
}
