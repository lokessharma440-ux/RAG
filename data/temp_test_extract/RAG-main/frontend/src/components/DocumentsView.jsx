import React, { useState, useRef } from 'react';
import {
  Search,
  Upload,
  FileText,
  Trash2,
  RotateCcw,
  Bot,
  ArrowLeft,
} from 'lucide-react';
import './DocumentsView.css';

export default function DocumentsView({
  documents = [],
  uploading = false,
  onDirectUpload,
  onDeleteDocument,
  onRetryDocument,
  retryingId,
  onSelectDocumentScope,
  onNavigate,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Filter documents by search
  const filteredDocs = documents.filter((doc) => {
    const q = searchQuery.toLowerCase();
    const name = (doc.originalName || '').toLowerCase();
    return name.includes(q);
  });

  // Handle Drag & Drop
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files[0]) {
      onDirectUpload(files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
      onDirectUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  // Format file size
  const formatSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className={`dev-docs-page ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,.txt"
        style={{ display: 'none' }}
      />

      {/* Header */}
      <div className="dev-docs-header">
        <div className="dev-docs-header-left">
          <h1 className="dev-page-title">Documents</h1>
          <p className="dev-page-subtitle">
            Manage your uploaded documents. Each file is parsed, chunked, and vectorized locally
            with 384-dimensional MiniLM embeddings for Gemini RAG.
          </p>
        </div>
        <button
          type="button"
          className="dev-back-link"
          onClick={() => onNavigate('overview')}
        >
          <ArrowLeft size={14} />
          <span>Back to overview</span>
        </button>
      </div>

      {/* Search Bar Row */}
      <div className="dev-search-container">
        <div className="dev-search-bar">
          <Search size={16} className="dev-search-icon" />
          <input
            type="text"
            className="dev-search-input"
            placeholder="Search documents by name or file type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="dev-search-meta-row">
          <span className="dev-count-text">
            {filteredDocs.length} {filteredDocs.length === 1 ? 'document' : 'documents'} in vault
          </span>
          <button
            type="button"
            className="dev-btn-solid dev-upload-trigger-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={14} style={{ marginRight: 6 }} />
            {uploading ? 'Processing & Vectorizing...' : 'Upload document'}
          </button>
        </div>
      </div>

      {/* Document Grid (3 Columns) */}
      {filteredDocs.length === 0 ? (
        <div className="dev-empty-docs-card">
          <div className="dev-empty-icon-wrap">
            <FileText size={32} />
          </div>
          <h3 className="dev-empty-title">
            {searchQuery ? 'No matching documents found' : 'No documents in vault yet'}
          </h3>
          <p className="dev-empty-desc">
            {searchQuery
              ? 'Try searching with another keyword or file extension.'
              : 'Upload a PDF or TXT document. The backend will automatically parse text, generate local 384-d MiniLM vectors, and index them in MongoDB.'}
          </p>
          <button
            type="button"
            className="dev-btn-solid"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={14} style={{ marginRight: 6 }} />
            Upload PDF or TXT
          </button>
        </div>
      ) : (
        <div className="dev-docs-grid">
          {filteredDocs.map((doc) => {
            const ext = doc.originalName?.split('.').pop()?.toUpperCase() || 'DOC';
            const chunkCount = doc.chunkCount ?? doc.chunksCount ?? 0;
            const fileSize = doc.fileSize ?? doc.size ?? 0;
            const isReady = doc.status === 'ready';
            const isProcessing = doc.status === 'processing' || doc.status === 'queued';
            const isFailed = doc.status === 'failed';

            return (
              <div key={doc._id} className="dev-doc-card">
                <div className="dev-card-top-row">
                  <h3 className="dev-card-doc-title" title={doc.originalName}>
                    {doc.originalName}
                  </h3>
                  <div className="dev-badge-group">
                    <span className="dev-card-badge font-mono">{ext}</span>
                    <span className={`dev-status-pill font-mono ${doc.status}`}>
                      {doc.status}
                    </span>
                  </div>
                </div>

                <p className="dev-card-description">
                  {isReady
                    ? `Indexed with ${chunkCount} chunks (${formatSize(fileSize)}). 384-d local MiniLM vector embeddings ready for semantic retrieval.`
                    : isProcessing
                    ? 'Extracting text and computing 384-d vector embeddings...'
                    : (doc.errorMessage || 'Document processing failed. Click retry to re-index.')}
                </p>

                <div className="dev-card-meta-row">
                  <div className="dev-card-lang-indicator">
                    <span
                      className="dev-lang-dot"
                      style={{
                        backgroundColor: ext === 'PDF' ? '#ef4444' : '#3b82f6',
                      }}
                    />
                    <span className="dev-lang-name">{ext} Document</span>
                  </div>

                  {chunkCount > 0 && (
                    <span className="dev-meta-stat font-mono">
                      ★ {chunkCount} chunks
                    </span>
                  )}

                  <span className="dev-meta-date font-mono">
                    {doc.createdAt
                      ? new Date(doc.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Today'}
                  </span>
                </div>

                <div className="dev-card-actions-row">
                  {isFailed && (
                    <button
                      type="button"
                      className="dev-btn-outline"
                      onClick={() => onRetryDocument(doc._id, doc.originalName)}
                      disabled={retryingId === doc._id}
                    >
                      <RotateCcw
                        size={13}
                        className={retryingId === doc._id ? 'spin' : ''}
                        style={{ marginRight: 4 }}
                      />
                      Retry
                    </button>
                  )}

                  <button
                    type="button"
                    className="dev-btn-outline"
                    onClick={() => onDeleteDocument(doc._id, doc.originalName)}
                    title="Delete document and vector chunks"
                  >
                    <Trash2 size={13} style={{ marginRight: 4 }} />
                    Delete
                  </button>

                  <button
                    type="button"
                    className="dev-btn-solid"
                    disabled={!isReady}
                    onClick={() => {
                      onSelectDocumentScope(doc._id);
                      onNavigate('chat');
                    }}
                  >
                    <Bot size={14} style={{ marginRight: 6 }} />
                    Chat with doc
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drag overlay feedback */}
      {isDragging && (
        <div className="dev-drag-drop-overlay">
          <Upload size={36} className="text-cyan" />
          <p>Drop PDF or TXT to upload and vectorize</p>
        </div>
      )}
    </div>
  );
}
