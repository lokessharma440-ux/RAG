/**
 * API configuration and utility helpers.
 *
 * In development:
 *   - VITE_API_URL is empty, so requests to '/api/...' route through Vite's proxy (localhost:5000).
 * In production:
 *   - If VITE_API_URL is configured (e.g. 'https://devmind-ai-backend.onrender.com'),
 *     requests to '/api/...' target Render directly.
 *   - If VITE_API_URL is left empty, requests remain relative and rely on Vercel rewrites proxying.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export function getApiUrl(endpoint) {
  if (!endpoint) return API_BASE_URL || '/';
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

