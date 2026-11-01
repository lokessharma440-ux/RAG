import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Paperclip,
  RotateCcw,
  Layers,
  X,
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Check,
  Copy,
  ArrowRight,
} from 'lucide-react';
import MarkdownContent from './MarkdownContent.jsx';
import './AnalysesChatView.css';

export default function AnalysesChatView({
  showToast,
  currentUser,
  onOpenAuth,
  documents = [],
  uploading = false,
  selectedDocId = 'all',
  onSelectDocumentScope,
  messages,
  setMessages,
  onNewChat,
  onDirectUpload,
}) {
  const [inputQuery, setInputQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedSources, setExpandedSources] = useState({});
  const [copiedMsgId, setCopiedMsgId] = useState(null);
  const chatBottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const readyDocuments = documents.filter((d) => d.status === 'ready');
  const selectedDocObj =
    selectedDocId !== 'all' ? documents.find((d) => d._id === selectedDocId) : null;

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Handle Input Auto-resize
  const handleInputChange = (e) => {
    setInputQuery(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  // Toggle Source Excerpts
  const toggleSource = (msgId, index) => {
    const key = `${msgId}-${index}`;
    setExpandedSources((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Copy Message Text
  const copyMessageText = (msgId, text) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(msgId);
    showToast('Copied to clipboard');
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  // Submit Query
  const handleSendMessage = async (customPrompt) => {
    const query = (customPrompt || inputQuery).trim();
    if (!query || isGenerating) return;

    if (!currentUser) {
      onOpenAuth('login');
      showToast('Please sign in to ask questions about your documents');
      return;
    }

    setInputQuery('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsGenerating(true);

    try {
      const payload = {
        question: query,
        message: query,
        documentIds: selectedDocId !== 'all' ? [selectedDocId] : [],
        documentId: selectedDocId !== 'all' ? selectedDocId : undefined,
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to generate answer.');
      }

      const botMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: data?.data?.answer || data?.data?.reply || data?.answer || data?.reply || '',
        sources: data?.data?.sources || data?.sources || [],
        confidence: data?.data?.confidence ?? data?.confidence,
        faithfulness: data?.data?.faithfulness ?? data?.faithfulness,
        provider: data?.data?.provider ?? data?.provider,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        text: `Unable to complete query: ${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="dev-analyses-chat-page">
      {/* Scope Subheader */}
      <div className="dev-chat-topbar">
        <div className="dev-chat-scope-box">
          <Layers size={14} className="text-cyan" />
          <span className="dev-chat-scope-text">
            {selectedDocId === 'all'
              ? `Scope: All Documents (${readyDocuments.length})`
              : `Scope: ${selectedDocObj?.originalName || 'Selected Document'}`}
          </span>
          {selectedDocId !== 'all' && (
            <button
              type="button"
              className="dev-scope-clear"
              onClick={() => onSelectDocumentScope('all')}
              title="Reset scope to all documents"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            className="dev-btn-outline dev-new-chat-btn"
            onClick={onNewChat}
          >
            <RotateCcw size={12} style={{ marginRight: 4 }} />
            New conversation
          </button>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="dev-chat-scrollarea">
        {messages.length === 0 ? (
          <div className="dev-chat-empty-state">
            <div className="dev-chat-empty-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2V8H20" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="11" cy="14" r="2.2" fill="#2563eb" stroke="#3b82f6" strokeWidth="1.2"/>
                <path d="M11 11.8V9.5" stroke="#3b82f6" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M11 16.2V18.5" stroke="#3b82f6" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M8.8 14H6.5" stroke="#3b82f6" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M13.2 14H15.5" stroke="#3b82f6" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="dev-chat-empty-title">DocuMind AI Document Intelligence</h2>
            <p className="dev-chat-empty-subtitle">
              Ask questions about your uploaded PDFs or text files. Answers are
              grounded in local 384-d MiniLM vector embeddings and synthesized with Google Gemini.
            </p>

            <div className="dev-chat-prompts-grid">
              {[
                'Summarize the core architecture of this document',
                'What are the key security and authentication requirements?',
                'List all API endpoints and data models specified',
                'Extract high-level technical decisions and constraints',
              ].map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="dev-suggested-prompt-card"
                  onClick={() => handleSendMessage(prompt)}
                >
                  <span>{prompt}</span>
                  <ArrowRight size={13} className="prompt-arrow" />
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
                        <span>AI Assistant</span>
                      </div>
                      <div className="dev-assistant-actions">
                        <button
                          type="button"
                          className="dev-msg-action-btn"
                          onClick={() => copyMessageText(msg.id, msg.text)}
                          title="Copy response"
                        >
                          {copiedMsgId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    </div>

                    <div className="dev-assistant-card-body">
                      <MarkdownContent content={msg.text} />
                    </div>

                    {/* Citations & Sources Accordion */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="dev-sources-section">
                        <div className="dev-sources-header font-mono">
                          <span>GROUNDED SOURCES ({msg.sources.length})</span>
                        </div>
                        <div className="dev-sources-list">
                          {msg.sources.map((src, i) => {
                            const isExpanded = expandedSources[`${msg.id}-${i}`];
                            return (
                              <div key={i} className="dev-source-item">
                                <div
                                  className="dev-source-item-header"
                                  onClick={() => toggleSource(msg.id, i)}
                                >
                                  <FileText size={12} className="source-file-icon" />
                                  <span className="source-doc-name">{src.documentName}</span>
                                  {src.pageNumber && (
                                    <span className="source-page-badge font-mono">
                                      p.{src.pageNumber}
                                    </span>
                                  )}
                                  <span className="source-score font-mono">
                                    {(src.score * 100).toFixed(0)}% match
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUp size={12} className="chevron" />
                                  ) : (
                                    <ChevronDown size={12} className="chevron" />
                                  )}
                                </div>
                                {isExpanded && (
                                  <div className="dev-source-content">
                                    <p>{src.text}</p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="dev-assistant-footer">
                      <span className="dev-message-time">{msg.timestamp}</span>
                      {msg.confidence && (
                        <span className="dev-meta-pill font-mono">
                          Confidence: {msg.confidence}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isGenerating && (
              <div className="dev-message-row assistant">
                <div className="dev-assistant-card generating">
                  <div className="dev-generating-pill font-mono">
                    <span className="generating-pulse" />
                    <span>Searching documents & generating grounded response...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>
        )}
      </div>

      {/* Floating Input Dock */}
      <div className="dev-chat-dock-wrap">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files?.[0]) onDirectUpload(e.target.files[0]);
            e.target.value = '';
          }}
          accept=".pdf,.txt"
          style={{ display: 'none' }}
        />

        <div className="dev-chat-dock">
          <button
            type="button"
            className="dev-dock-paperclip"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title={uploading ? 'Processing document...' : 'Upload PDF or TXT to vault'}
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={textareaRef}
            className="dev-dock-textarea"
            placeholder="Ask anything about your documents..."
            value={inputQuery}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isGenerating}
          />

          <button
            type="button"
            className="dev-dock-send-btn"
            onClick={() => handleSendMessage()}
            disabled={!inputQuery.trim() || isGenerating}
            aria-label="Send query"
          >
            <Send size={15} />
          </button>
        </div>

        <div className="dev-dock-hint font-mono">
          Enter to send • Shift + Enter for new line • Local MiniLM + Gemini AI
        </div>
      </div>
    </div>
  );
}
