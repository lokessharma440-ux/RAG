import React, { useState, useEffect } from 'react';
import {
  Zap, Copy, Check, Download, RefreshCw, Edit3, Eye,
  AlertTriangle, CheckCircle, X, Shield, FileText,
  Terminal, Sparkles, Cpu, Clock, Layers
} from 'lucide-react';
import MarkdownContent from './MarkdownContent.jsx';
import './FixPromptModal.css';

const AGENTS = [
  { id: 'generic', label: 'Generic AI Coding Agent', icon: Cpu },
  { id: 'antigravity', label: 'Google Antigravity', icon: Sparkles },
  { id: 'cursor', label: 'Cursor Composer', icon: Terminal },
  { id: 'claude_code', label: 'Claude Code CLI', icon: Layers },
  { id: 'gemini_cli', label: 'Gemini CLI', icon: Zap },
];

const MODES = [
  { id: 'single_issue', label: 'Single Issue Fix' },
  { id: 'related_issues', label: 'Related Issues Fix' },
  { id: 'security', label: 'Security Hardening' },
  { id: 'test_generation', label: 'Test Generation' },
  { id: 'full_project', label: 'Full Project Improvement' },
  { id: 'documentation', label: 'Documentation Fix' },
];

export default function FixPromptModal({
  repositoryId,
  findings = [],
  selectedFindings = [],
  initialMode = 'single_issue',
  existingPrompt = null,
  onClose,
  showToast,
  onSaved,
  onPromptSaved,
}) {
  const initialFindings = (findings && findings.length ? findings : selectedFindings) || [];
  const [targetAgent, setTargetAgent] = useState(existingPrompt?.targetAgent || 'generic');
  const [mode, setMode] = useState(existingPrompt?.mode || (initialFindings.length > 1 ? 'related_issues' : initialMode));
  const [customInstructions, setCustomInstructions] = useState('');
  const [activeFindings, setActiveFindings] = useState(initialFindings);

  const [promptData, setPromptData] = useState(existingPrompt || null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [savingEdits, setSavingEdits] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const handleGenerate = async (overrideMode, overrideAgent, overrideFindings) => {
    const currentM = overrideMode || mode;
    const currentA = overrideAgent || targetAgent;
    const currentF = overrideFindings !== undefined ? overrideFindings : activeFindings;

    setGenerating(true);
    setGenerateError(null);
    try {
      const ids = currentF.map((f) => f.id || f._id).filter(Boolean);
      const res = await fetch(`/api/codebases/${repositoryId}/fix-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: currentM,
          targetAgent: currentA,
          findingIds: ids,
          customInstructions,
        }),
        credentials: 'include',
      });

      const json = await res.json();
      if (json.success && json.data) {
        setPromptData(json.data);
        setEditedText(json.data.userEditedPrompt || json.data.generatedPrompt);
        setIsEditing(false);
        showToast('AI Fix Prompt generated');
        if (onSaved) onSaved(json.data);
        if (onPromptSaved) onPromptSaved(json.data);
      } else {
        const msg = json.message || 'Prompt generation failed';
        setGenerateError(msg);
        showToast(msg);
      }
    } catch (err) {
      const msg = `Error: ${err.message}`;
      setGenerateError(msg);
      showToast(msg);
    } finally {
      setGenerating(false);
    }
  };

  // Initialize on open
  useEffect(() => {
    if (existingPrompt) {
      setPromptData(existingPrompt);
      setEditedText(existingPrompt.isUserEdited && existingPrompt.userEditedPrompt
        ? existingPrompt.userEditedPrompt
        : existingPrompt.generatedPrompt);
    } else {
      handleGenerate(mode, targetAgent, initialFindings);
    }
  }, []);

  const handleCopy = () => {
    const textToCopy = isEditing ? editedText : (promptData?.userEditedPrompt || promptData?.generatedPrompt || editedText);
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    showToast('Copied fix prompt to clipboard');
    setTimeout(() => setCopied(false), 2200);

    // Update status in background to COPIED
    if (promptData?._id) {
      fetch(`/api/codebases/${repositoryId}/fix-prompts/${promptData._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COPIED' }),
        credentials: 'include',
      }).catch(() => {});
    }
  };

  const handleDownload = async (format = 'md') => {
    if (!promptData?._id) return;
    try {
      window.open(`/api/codebases/${repositoryId}/fix-prompts/${promptData._id}/download?format=${format}`, '_blank');
      showToast(`Downloading as ${format.toUpperCase()}`);
    } catch (err) {
      showToast('Download failed');
    }
  };

  const handleSaveEdit = async () => {
    if (!promptData?._id) return;
    setSavingEdits(true);
    try {
      const res = await fetch(`/api/codebases/${repositoryId}/fix-prompts/${promptData._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEditedPrompt: editedText }),
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setPromptData(json.data);
        setIsEditing(false);
        showToast('Custom prompt edits saved');
        if (onPromptSaved) onPromptSaved(json.data);
      } else {
        showToast(json.message || 'Failed to save edits');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setSavingEdits(false);
    }
  };

  const removeFinding = (findingId) => {
    const updated = activeFindings.filter((f) => f.id !== findingId);
    setActiveFindings(updated);
    if (updated.length === 0) {
      showToast('No findings remaining.');
    }
  };

  const currentDisplayPrompt = isEditing
    ? editedText
    : (promptData?.isUserEdited && promptData?.userEditedPrompt
      ? promptData.userEditedPrompt
      : promptData?.generatedPrompt || editedText);

  return (
    <div className="fix-modal-backdrop" onClick={onClose}>
      <div className="fix-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="fix-modal-header">
          <div className="fix-modal-title-group">
            <div className="fix-modal-title">
              <Zap size={18} className="text-cyan" />
              <span>AI Fix Prompt Generator</span>
            </div>
            <span className="fix-modal-subtitle">
              Grounded, step-by-step instructions for external AI coding agents
            </span>
          </div>

          <button type="button" className="fix-modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Configuration Toolbar */}
        <div className="fix-config-bar">
          <div className="fix-config-group">
            <label className="fix-config-label">Target Agent:</label>
            <div className="fix-agent-pills">
              {AGENTS.map((ag) => {
                const Icon = ag.icon;
                return (
                  <button
                    key={ag.id}
                    type="button"
                    className={`fix-agent-pill ${targetAgent === ag.id ? 'active' : ''}`}
                    onClick={() => {
                      setTargetAgent(ag.id);
                      if (!isEditing) {
                        handleGenerate(mode, ag.id, activeFindings);
                      }
                    }}
                  >
                    <Icon size={12} />
                    <span>{ag.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fix-config-group">
            <label className="fix-config-label">Prompt Mode:</label>
            <select
              className="fix-select-input"
              value={mode}
              onChange={(e) => {
                const newMode = e.target.value;
                setMode(newMode);
                if (!isEditing) {
                  handleGenerate(newMode, targetAgent, activeFindings);
                }
              }}
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Findings Chips List */}
        {activeFindings.length > 0 && (
          <div className="fix-findings-bar">
            <span className="fix-findings-label">
              Selected Issues ({activeFindings.length}):
            </span>
            <div className="fix-findings-chips">
              {activeFindings.map((f) => (
                <span key={f.id} className={`fix-finding-chip ${f.severity?.toLowerCase() || 'medium'}`}>
                  <strong>{f.id}</strong> {f.title}
                  <button
                    type="button"
                    className="fix-chip-remove"
                    onClick={() => removeFinding(f.id)}
                    title="Remove issue from prompt"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Error Alert Banner */}
        {generateError && (
          <div style={{
            margin: '10px 20px 0',
            padding: '10px 14px',
            background: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            borderRadius: 'var(--radius-sm)',
            color: '#f43f5e',
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> {generateError}
            </span>
            <button
              type="button"
              className="fix-btn-action secondary"
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={() => handleGenerate(mode, targetAgent, activeFindings)}
            >
              Retry
            </button>
          </div>
        )}

        {/* Meta & Quality Badges */}
        {promptData && (
          <div className="fix-meta-bar">
            <div className="fix-meta-badges">
              {promptData.isStale && (
                <span className="fix-badge-stale">
                  <AlertTriangle size={11} /> Stale Analysis Warning Active
                </span>
              )}
              <span className="fix-badge-valid">
                <CheckCircle size={11} /> Quality Score:{' '}
                {promptData.validationReport?.score || 100}/100
              </span>
              <span className="fix-badge-neutral">
                Est. {promptData.promptTokensEst || Math.ceil((currentDisplayPrompt.length || 0) / 4)} tokens
              </span>
              {promptData.isUserEdited && (
                <span className="fix-badge-edited">
                  <Edit3 size={11} /> Developer Edited
                </span>
              )}
              <span className="fix-badge-status">
                Status: {promptData.status || 'GENERATED'}
              </span>
            </div>

            <div className="fix-view-toggle">
              <button
                type="button"
                className={`fix-toggle-btn ${!isEditing ? 'active' : ''}`}
                onClick={() => setIsEditing(false)}
              >
                <Eye size={12} /> Preview
              </button>
              <button
                type="button"
                className={`fix-toggle-btn ${isEditing ? 'active' : ''}`}
                onClick={() => {
                  setEditedText(currentDisplayPrompt);
                  setIsEditing(true);
                }}
              >
                <Edit3 size={12} /> Edit
              </button>
            </div>
          </div>
        )}

        {/* Prompt Content Area */}
        <div className="fix-content-area">
          {generating ? (
            <div className="fix-loading-box">
              <Sparkles size={28} className="spin text-cyan" />
              <h4>Synthesizing Grounded AI Fix Prompt...</h4>
              <p>Extracting source code evidence, ordering dependencies, and formatting for {targetAgent}...</p>
            </div>
          ) : isEditing ? (
            <div className="fix-editor-wrapper">
              <textarea
                className="fix-prompt-textarea"
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                placeholder="Edit prompt text..."
              />
              <div className="fix-editor-footer">
                <span className="fix-editor-count">
                  {editedText.length} characters • {editedText.split('\n').length} lines
                </span>
                <button
                  type="button"
                  className="fix-btn-action primary"
                  onClick={handleSaveEdit}
                  disabled={savingEdits}
                >
                  <Check size={12} /> {savingEdits ? 'Saving...' : 'Save Custom Edits'}
                </button>
              </div>
            </div>
          ) : currentDisplayPrompt ? (
            <div className="fix-preview-wrapper">
              <MarkdownContent content={currentDisplayPrompt} />
            </div>
          ) : (
            <div className="fix-empty-box">
              <FileText size={28} />
              <h4>No prompt generated yet</h4>
              <p>Click below to build an actionable fix prompt for this repository.</p>
              <button
                type="button"
                className="fix-btn-action primary"
                onClick={() => handleGenerate(mode, targetAgent, activeFindings)}
                disabled={generating}
                style={{ marginTop: 14 }}
              >
                <Zap size={13} /> Generate Fix Prompt
              </button>
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <div className="fix-modal-footer">
          <div className="fix-footer-left">
            <button
              type="button"
              className="fix-btn-action primary"
              onClick={() => handleGenerate(mode, targetAgent, activeFindings)}
              disabled={generating}
            >
              <Zap size={13} className={generating ? 'spin' : ''} />
              <span>{generating ? 'Generating Prompt...' : promptData ? 'Regenerate Prompt' : 'Generate Fix Prompt'}</span>
            </button>
          </div>

          <div className="fix-footer-right">
            <button
              type="button"
              className="fix-btn-action download"
              onClick={() => handleDownload('txt')}
              disabled={!promptData?._id}
              title="Download as plain text (.txt)"
            >
              <Download size={13} />
              <span>Download .TXT</span>
            </button>

            <button
              type="button"
              className="fix-btn-action download"
              onClick={() => handleDownload('md')}
              disabled={!promptData?._id}
              title="Download as Markdown (.md)"
            >
              <Download size={13} />
              <span>Download .MD</span>
            </button>

            <button
              type="button"
              className={`fix-btn-action copy ${copied ? 'copied' : 'primary'}`}
              onClick={handleCopy}
              disabled={!currentDisplayPrompt}
            >
              {copied ? (
                <>
                  <Check size={14} />
                  <span>Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  <span>Copy Fix Prompt</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

