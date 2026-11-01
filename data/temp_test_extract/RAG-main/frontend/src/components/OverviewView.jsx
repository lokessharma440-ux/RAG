import React from 'react';
import { FileText, Bot, UserCheck, LogIn, Upload, Code2 } from 'lucide-react';
import './OverviewView.css';

export default function OverviewView({
  currentUser,
  documents = [],
  messages = [],
  onOpenAuth,
  onLogout,
  onNavigate,
}) {
  const readyDocs = documents.filter((d) => d.status === 'ready');
  const totalChunks = documents.reduce((sum, d) => sum + (d.chunkCount ?? d.chunksCount ?? 0), 0);
  const userQueries = messages.filter((m) => m.role === 'user').length;
  const userHandle = currentUser?.email ? currentUser.email.split('@')[0] : 'user';

  return (
    <div className="dev-overview-page">
      <div className="dev-page-header">
        <h1 className="dev-page-title">Overview</h1>
        <p className="dev-page-subtitle">
          Manage your document vault, run AI-driven retrieval queries, and inspect vector indexes.
        </p>
      </div>

      {/* User Session Banner */}
      {currentUser ? (
        <div className="dev-connected-card">
          <div className="dev-connected-left">
            <div className="dev-connected-avatar font-mono">
              {userHandle.substring(0, 2).toUpperCase()}
            </div>
            <div className="dev-connected-meta">
              <span className="dev-connected-title">Signed in as {currentUser.email}</span>
              <span className="dev-connected-sub">
                Private vault active • Multi-tenant document isolation
              </span>
            </div>
          </div>
          <div className="dev-connected-actions">
            <button
              type="button"
              className="dev-btn-solid"
              onClick={() => onNavigate('documents')}
            >
              <FileText size={14} style={{ marginRight: 6 }} />
              View documents
            </button>
            <button
              type="button"
              className="dev-btn-outline"
              onClick={onLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="dev-connected-card">
          <div className="dev-connected-left">
            <div className="dev-unconnected-icon">
              <LogIn size={20} />
            </div>
            <div className="dev-connected-meta">
              <span className="dev-connected-title">Sign in to access your document vault</span>
              <span className="dev-connected-sub">
                Upload private documents, generate local vector embeddings, and query with Gemini.
              </span>
            </div>
          </div>
          <div className="dev-connected-actions">
            <button
              type="button"
              className="dev-btn-solid"
              onClick={() => onOpenAuth('login')}
            >
              <UserCheck size={14} style={{ marginRight: 6 }} />
              Sign in
            </button>
          </div>
        </div>
      )}

      {/* 4 Real Metric Cards */}
      <div className="dev-stats-grid">
        <div className="dev-stat-card">
          <div className="dev-stat-label font-mono">DOCUMENTS</div>
          <div className="dev-stat-value">{documents.length}</div>
          <div className="dev-stat-caption">
            {readyDocs.length} ready in vault
          </div>
        </div>

        <div className="dev-stat-card">
          <div className="dev-stat-label font-mono">CHUNKS INDEXED</div>
          <div className="dev-stat-value">{totalChunks}</div>
          <div className="dev-stat-caption">
            {totalChunks > 0 ? 'MiniLM 384-d vectors' : 'No vectors indexed yet'}
          </div>
        </div>

        <div className="dev-stat-card">
          <div className="dev-stat-label font-mono">QUERIES RUN</div>
          <div className="dev-stat-value">{userQueries}</div>
          <div className="dev-stat-caption">
            {userQueries > 0 ? 'Grounded exchanges' : 'No queries asked yet'}
          </div>
        </div>

        <div className="dev-stat-card">
          <div className="dev-stat-label font-mono">RAG ENGINE</div>
          <div className="dev-stat-value text-emerald">Active</div>
          <div className="dev-stat-caption">
            Local MiniLM + Gemini API
          </div>
        </div>
      </div>

      {/* Primary Action Callout */}
      <div className="dev-callout-card">
        <h3 className="dev-callout-title">
          {readyDocs.length > 0
            ? 'Document Intelligence & RAG Ready'
            : 'Get Started with Document Intelligence'}
        </h3>
        <p className="dev-callout-desc">
          Upload PDF or TXT documents to automatically split text into overlapping chunks, generate
          384-dimensional vector embeddings locally, and synthesize truthful answers with Google
          Gemini with full source traceability.
        </p>
        <div className="dev-callout-buttons">
          <button
            type="button"
            className="dev-btn-solid"
            onClick={() => onNavigate('codebases')}
          >
            <Code2 size={14} style={{ marginRight: 6 }} />
            Explore Codebases
          </button>
          <button
            type="button"
            className="dev-btn-outline"
            onClick={() => onNavigate('documents')}
          >
            <Upload size={14} style={{ marginRight: 6 }} />
            Upload documents
          </button>
          <button
            type="button"
            className="dev-btn-outline"
            onClick={() => onNavigate('chat')}
          >
            <Bot size={14} style={{ marginRight: 6 }} />
            Open AI chat
          </button>
        </div>
      </div>
    </div>
  );
}
