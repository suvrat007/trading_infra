import { API_BASE_URL, FETCH_TIMEOUT_MS } from '../../constants/api.js';

const request = async (path, { method = 'GET', body, signal } = {}) => {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(new URL(path, API_BASE_URL), {
    method,
    signal: combined,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed with ${response.status}`);
    error.code = payload?.error?.code;
    error.details = payload?.error?.details ?? [];
    throw error;
  }

  return payload;
};

export const listStrategies = (signal) => request('/api/strategies', { signal });
export const getStrategy = (id, signal) => request(`/api/strategies/${id}`, { signal });
export const createStrategy = (document) => request('/api/strategies', { method: 'POST', body: document });
export const updateStrategy = (id, document) => request(`/api/strategies/${id}`, { method: 'PUT', body: document });
export const deleteStrategy = (id) => request(`/api/strategies/${id}`, { method: 'DELETE' });
export const startStrategy = (id) => request(`/api/strategies/${id}/start`, { method: 'POST' });

/** Check a draft without saving. Returns { valid, errors }. */
export const validateStrategy = (document, signal) =>
  request('/api/strategies/validate', { method: 'POST', body: document, signal });
