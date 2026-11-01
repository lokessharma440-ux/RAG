import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { API_BASE_URL } from './config/api.js';

// Setup transparent fetch proxying and token management for production deployment
const originalFetch = window.fetch;
window.fetch = async function (input, init = {}) {
  let url = input;

  if (typeof input === 'string') {
    if (input.startsWith('/api') && API_BASE_URL) {
      url = `${API_BASE_URL}${input}`;
    } else if (input.startsWith('api/') && API_BASE_URL) {
      url = `${API_BASE_URL}/${input}`;
    }
  } else if (input instanceof URL) {
    if (input.pathname.startsWith('/api') && API_BASE_URL) {
      url = new URL(`${API_BASE_URL}${input.pathname}${input.search}`);
    }
  }

  // Clone headers and inject Authorization Bearer token if present in localStorage
  const headers = new Headers(init.headers || (typeof input === 'object' && input.headers ? input.headers : {}));
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const modifiedInit = {
    ...init,
    headers,
    credentials: init.credentials || 'include',
  };

  return originalFetch(url, modifiedInit);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
