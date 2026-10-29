import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import TopHeader from './components/TopHeader.jsx';
import OverviewView from './components/OverviewView.jsx';
import DocumentsView from './components/DocumentsView.jsx';
import AnalysesChatView from './components/AnalysesChatView.jsx';
import CodebasesView from './components/CodebasesView.jsx';
import CodebaseDetailView from './components/CodebaseDetailView.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import './App.css';

export default function App() {
  // Navigation View: 'overview' | 'codebases' | 'documents' | 'chat' | 'auth'
  const [activeView, setActiveView] = useState('overview');
  const [selectedCodebaseId, setSelectedCodebaseId] = useState(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Authentication State (HTTP-Only Cookie Sessions)
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');

  // Documents State (User's Vault)
  const [documents, setDocuments] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState('all');
  const [uploading, setUploading] = useState(false);
  const [retryingId, setRetryingId] = useState(null);

  // Chat Conversation State (Session-Scoped)
  const [messages, setMessages] = useState([]);

  // Toast Feedback State
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  // Check Current Session on mount
  const checkCurrentUser = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.success && data.data?.user) {
        setCurrentUser(data.data.user);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    }
  };

  useEffect(() => {
    checkCurrentUser();
  }, []);

  // Fetch documents for active user
  const fetchDocuments = async () => {
    if (!currentUser) {
      setDocuments([]);
      return;
    }

    try {
      const res = await fetch('/api/documents?page=1&limit=50', {
        credentials: 'include',
      });
      if (res.status === 401) {
        setDocuments([]);
        return;
      }
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setDocuments(json.data);
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
      showToast('Failed to load documents');
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [currentUser]);

  // Document Processing Poller: Poll if any document is queued or processing
  useEffect(() => {
    const hasPendingDocs = documents.some(
      (d) => d.status === 'queued' || d.status === 'processing'
    );
    if (!hasPendingDocs || !currentUser) return;

    const pollInterval = setInterval(() => {
      fetchDocuments();
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [documents, currentUser]);

  // Handle Logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setCurrentUser(null);
      setDocuments([]);
      setMessages([]);
      setSelectedCodebaseId(null);
      showToast('Logged out of session');
      setActiveView('overview');
    }
  };

  // Direct 1-Click Upload (From paperclip, drag-drop, or button)
  const handleDirectUpload = async (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'pdf' && ext !== 'txt') {
      showToast('Only .pdf and .txt files are supported.');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      showToast('File exceeds 15MB size limit.');
      return;
    }

    if (!currentUser) {
      setAuthMode('login');
      setActiveView('auth');
      showToast('Please sign in to upload documents.');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to process document.');
      }

      showToast(`"${file.name}" uploaded and indexed!`);
      await fetchDocuments();

      if (data.data?._id) {
        setSelectedDocId(data.data._id);
      }
    } catch (err) {
      showToast(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Delete Document
  const handleDeleteDocument = async (id, name) => {
    if (!currentUser) {
      setActiveView('auth');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Deleted "${name}"`);
        if (selectedDocId === id) setSelectedDocId('all');
        await fetchDocuments();
      } else {
        alert(data.message || 'Failed to delete document.');
      }
    } catch (err) {
      alert(`Error deleting document: ${err.message}`);
    }
  };

  // Retry Failed Document Ingestion
  const handleRetryDocument = async (id, name) => {
    setRetryingId(id);
    try {
      const res = await fetch(`/api/documents/${id}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Retry initiated for "${name}"`);
        await fetchDocuments();
      } else {
        alert(data.message || 'Retry failed.');
      }
    } catch (err) {
      alert(`Error retrying document: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  // If Auth Screen is requested
  if (activeView === 'auth') {
    return (
      <div className="dev-app-root">
        <AuthScreen
          initialMode={authMode}
          onSuccess={(user) => {
            setCurrentUser(user);
            setActiveView('overview');
            fetchDocuments();
          }}
          onCancel={() => setActiveView('overview')}
          showToast={showToast}
        />
        {toast && (
          <div className="dev-toast-notification">
            <span>{toast}</span>
          </div>
        )}
      </div>
    );
  }

  const navigateTo = (view, codebaseId = null) => {
    setSelectedCodebaseId(codebaseId);
    setActiveView(view);
  };

  return (
    <div className="dev-app-root">
      <div className="dev-main-layout">
        {/* Left Sidebar */}
        <Sidebar
          activeView={activeView}
          setActiveView={(view) => navigateTo(view, null)}
          isOpenMobile={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        {/* Right Content Area */}
        <div className="dev-content-wrapper">
          {/* Top Header */}
          <TopHeader
            currentUser={currentUser}
            onOpenAuth={(mode = 'login') => {
              setAuthMode(mode);
              setActiveView('auth');
            }}
            onLogout={handleLogout}
            onToggleMobileSidebar={() => setIsMobileSidebarOpen(true)}
          />

          {/* Active View Content */}
          <main className="dev-view-container">
            <ErrorBoundary onReset={() => navigateTo('overview', null)}>
              {activeView === 'overview' && (
                <OverviewView
                  currentUser={currentUser}
                  documents={documents}
                  messages={messages}
                  onOpenAuth={(mode) => {
                    setAuthMode(mode);
                    setActiveView('auth');
                  }}
                  onLogout={handleLogout}
                  onNavigate={(view) => navigateTo(view, null)}
                />
              )}

              {activeView === 'codebases' && (
                selectedCodebaseId ? (
                  <CodebaseDetailView
                    codebaseId={selectedCodebaseId}
                    onBack={() => setSelectedCodebaseId(null)}
                    showToast={showToast}
                    currentUser={currentUser}
                  />
                ) : (
                  <CodebasesView
                    currentUser={currentUser}
                    onOpenAuth={(mode) => {
                      setAuthMode(mode);
                      setActiveView('auth');
                    }}
                    onSelectCodebase={(target) => {
                      const id = typeof target === 'object' && target?._id ? target._id : target;
                      setSelectedCodebaseId(id);
                    }}
                    showToast={showToast}
                  />
                )
              )}

              {activeView === 'documents' && (
                <DocumentsView
                  documents={documents}
                  uploading={uploading}
                  onDirectUpload={handleDirectUpload}
                  onDeleteDocument={handleDeleteDocument}
                  onRetryDocument={handleRetryDocument}
                  retryingId={retryingId}
                  onSelectDocumentScope={(id) => setSelectedDocId(id)}
                  onNavigate={(view) => navigateTo(view, null)}
                />
              )}

              {activeView === 'chat' && (
                <AnalysesChatView
                  showToast={showToast}
                  currentUser={currentUser}
                  onOpenAuth={(mode) => {
                    setAuthMode(mode);
                    setActiveView('auth');
                  }}
                  documents={documents}
                  uploading={uploading}
                  selectedDocId={selectedDocId}
                  onSelectDocumentScope={(id) => setSelectedDocId(id)}
                  messages={messages}
                  setMessages={setMessages}
                  onNewChat={() => {
                    setMessages([]);
                    showToast('Started new conversation');
                  }}
                  onDirectUpload={handleDirectUpload}
                />
              )}
            </ErrorBoundary>
          </main>
        </div>
      </div>

      {/* Floating Toast Pill */}
      {toast && (
        <div className="dev-toast-notification">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
