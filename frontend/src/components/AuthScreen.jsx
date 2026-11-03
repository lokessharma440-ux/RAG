import React, { useState, useEffect, useRef } from 'react';
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
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  // Pre-warm the backend container as soon as the auth screen loads
  useEffect(() => {
    fetch('/api/health').catch(() => {});
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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
    setLoadingSeconds(0);
    setError(null);

    // Track wait time to provide progressive UI feedback for Render cold starts
    timerRef.current = setInterval(() => {
      setLoadingSeconds((prev) => prev + 1);
    }, 1000);

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const controller = new AbortController();
    // 90-second timeout safely accommodates Render free-tier cold starts (which take 35-65s)
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: 'include',
        signal: controller.signal,
      });

      let data;
      try {
        data = await res.json();
      } catch {
        if (res.status === 503) {
          throw new Error('Backend service is suspended on Render (HTTP 503). Please log into Render dashboard and click "Resume Service" on devmind-ai-backend.');
        }
        if (res.status === 502 || res.status === 504) {
          throw new Error(`Server gateway error (HTTP ${res.status}). The cloud instance took too long to spin up. Please retry in a few seconds.`);
        }
        throw new Error(`Server returned unexpected response (status ${res.status}). Please try again.`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Authentication request failed.');
      }

      if (data.data?.token) {
        localStorage.setItem('auth_token', data.data.token);
      }
      if (data.data?.user) {
        localStorage.setItem('auth_user', JSON.stringify(data.data.user));
        onSuccess(data.data.user);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError(
          'Authentication request timed out after 90s. The free-tier server was cold and took longer than expected to spin up. Please try again now that the server is warm.'
        );
      } else if (err.message === 'Failed to fetch' || (err.message && err.message.includes('NetworkError'))) {
        setError(
          'Cannot reach the server. The free-tier backend may still be starting up, or your network is interrupted. Please retry in a moment.'
        );
      } else {
        setError(err.message || 'An unexpected error occurred.');
      }
    } finally {
      clearTimeout(timeoutId);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setLoading(false);
      setLoadingSeconds(0);
    }
  };

  const getSubmitButtonLabel = () => {
    if (!loading) {
      return mode === 'login' ? 'Log in' : 'Create account';
    }
    if (loadingSeconds < 4) {
      return mode === 'login' ? 'Authenticating...' : 'Creating account...';
    }
    if (loadingSeconds < 14) {
      return 'Connecting to server...';
    }
    return `Waking server (${loadingSeconds}s)...`;
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
              {getSubmitButtonLabel()}
            </button>

            {loading && loadingSeconds >= 5 && (
              <p className="dev-auth-wake-notice">
                Free-tier cloud servers sleep when idle. Spinning up container ({loadingSeconds}s)... please wait.
              </p>
            )}
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
