import React, { useState } from 'react';
import { Menu, LogIn, LogOut, ChevronDown } from 'lucide-react';
import './TopHeader.css';

export default function TopHeader({
  currentUser,
  onOpenAuth,
  onLogout,
  onToggleMobileSidebar,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const displayName = currentUser?.name || currentUser?.email?.split('@')[0] || '';

  const getInitials = () => {
    if (currentUser?.name) {
      const parts = currentUser.name.trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return currentUser.name.substring(0, 2).toUpperCase();
    }
    if (currentUser?.email) {
      return currentUser.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  return (
    <header className="dev-top-header">
      <div className="dev-header-left">
        <button
          type="button"
          className="dev-mobile-trigger"
          onClick={onToggleMobileSidebar}
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>
        <span className="dev-welcome-text">
          {currentUser ? (
            <>
              Welcome back, <strong className="dev-user-greeting">{displayName}</strong>
            </>
          ) : (
            <span className="dev-user-greeting">DevMind AI — Codebase &amp; Document Intelligence</span>
          )}
        </span>
      </div>

      <div className="dev-header-right">
        {currentUser ? (
          <div className="dev-user-profile-menu">
            <button
              type="button"
              className="dev-profile-chip"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="User account menu"
            >
              <div className="dev-avatar-circle font-mono">{getInitials()}</div>
              <span className="dev-profile-name">{currentUser.email}</span>
              <ChevronDown size={14} className="dev-chip-arrow" />
            </button>

            {menuOpen && (
              <div className="dev-profile-dropdown">
                <div className="dev-dropdown-header">
                  <span className="dev-dropdown-email">{currentUser.email}</span>
                  <span className="dev-dropdown-role font-mono">Authenticated Session</span>
                </div>
                <button
                  type="button"
                  className="dev-dropdown-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={14} />
                  <span>Log out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="dev-guest-actions">
            <button
              type="button"
              className="dev-login-pill-btn"
              onClick={() => onOpenAuth('login')}
            >
              <LogIn size={13} />
              <span>Sign in</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
