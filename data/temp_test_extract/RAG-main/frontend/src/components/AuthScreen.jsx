import React, { useState } from 'react';
import DvLogo from './DvLogo.jsx';
import './AuthScreen.css';

export default function AuthScreen({
  initialMode = 'login',
  onSuccess,
  onCancel,
  showToast,
}) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }

    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    setError(null);

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Authentication request failed.');
      }

      showToast(mode === 'login' ? 'Signed in successfully' : 'Account registered & signed in');
      if (data.data?.user) {
        onSuccess(data.data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dev-auth-splitscreen">
      {/* Left Column: Auth Form */}
      <div className="dev-auth-left">
        <div className="dev-auth-form-wrap">
          <div className="dev-auth-brand-row">
            <DvLogo />
          </div>

          <h2 className="dev-auth-heading">
            {mode === 'login' ? 'Log in' : 'Create an account'}
          </h2>

          <div className="dev-auth-switch-row">
            {mode === 'login' ? (
              <>
                <span className="dev-auth-switch-text">New here?</span>{' '}
                <button
                  type="button"
                  className="dev-auth-switch-btn"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                <span className="dev-auth-switch-text">Already have an account?</span>{' '}
                <button
                  type="button"
                  className="dev-auth-switch-btn"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                >
                  Log in
                </button>
              </>
            )}
          </div>

          {error && <div className="dev-auth-error-box">{error}</div>}

          <form onSubmit={handleSubmit} className="dev-auth-form">
            <div className="dev-input-field">
              <label className="dev-input-label">Email</label>
              <input
                type="email"
                className="dev-form-input"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="dev-input-field">
              <label className="dev-input-label">Password</label>
              <input
                type="password"
                className="dev-form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="dev-btn-solid dev-auth-submit-btn"
              disabled={loading}
            >
              {loading
                ? 'Authenticating...'
                : mode === 'login'
                ? 'Log in'
                : 'Create account'}
            </button>
          </form>

          {onCancel && (
            <div className="dev-auth-guest-row">
              <button
                type="button"
                className="dev-auth-guest-btn"
                onClick={onCancel}
              >
                ← Back to dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Hero Grid Banner */}
      <div className="dev-auth-right">
        <div className="dev-auth-tag font-mono">STATUS: PRODUCTION</div>

        <div className="dev-auth-hero-copy">
          <h1 className="dev-auth-hero-title">
            Document intelligence, grounded in your private vector vault.
          </h1>
          <p className="dev-auth-hero-desc">
            Upload PDF and TXT documents, generate local 384-dimensional vector embeddings with
            Xenova MiniLM-L6-v2, and synthesize truthful, citation-backed answers with Google
            Gemini.
          </p>
        </div>

        <div className="dev-auth-specs-grid font-mono">
          <div className="dev-spec-col">
            <div className="dev-spec-item primary">JWT</div>
            <div className="dev-spec-item">stateless</div>
            <div className="dev-spec-item">sessions</div>
          </div>
          <div className="dev-spec-col">
            <div className="dev-spec-item primary">MiniLM</div>
            <div className="dev-spec-item">384-d</div>
            <div className="dev-spec-item">vectors</div>
          </div>
          <div className="dev-spec-col">
            <div className="dev-spec-item primary">MERN</div>
            <div className="dev-spec-item">Gemini</div>
            <div className="dev-spec-item">RAG engine</div>
          </div>
        </div>
      </div>
    </div>
  );
}
