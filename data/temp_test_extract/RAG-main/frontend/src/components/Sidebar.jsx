import React from 'react';
import { Columns, FileText, Bot, Code2, X } from 'lucide-react';
import DvLogo from './DvLogo.jsx';
import './Sidebar.css';

export default function Sidebar({
  activeView,
  setActiveView,
  isOpenMobile,
  onCloseMobile,
}) {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: Columns },
    { id: 'codebases', label: 'Codebases', icon: Code2 },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'chat', label: 'AI Chat', icon: Bot },
  ];

  return (
    <>
      {isOpenMobile && (
        <div className="dev-sidebar-backdrop" onClick={onCloseMobile} aria-hidden="true" />
      )}

      <aside className={`dev-sidebar ${isOpenMobile ? 'open-mobile' : ''}`}>
        <div className="dev-sidebar-header">
          <DvLogo
            onClick={() => {
              setActiveView('overview');
              if (isOpenMobile) onCloseMobile();
            }}
          />
          {isOpenMobile && (
            <button
              type="button"
              className="dev-sidebar-close"
              onClick={onCloseMobile}
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <nav className="dev-sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`dev-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveView(item.id);
                  if (isOpenMobile) onCloseMobile();
                }}
              >
                <Icon size={16} className="dev-nav-icon" />
                <span className="dev-nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="dev-sidebar-footer">
          <div className="dev-version-card">
            <div className="dev-version-title font-mono">DevMind AI v2.0.0</div>
            <p className="dev-version-desc">
              Codebase Intelligence &amp; 384-d Gemini RAG platform.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
