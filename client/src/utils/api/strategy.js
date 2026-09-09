import { API_BASE_URL, FETCH_TIMEOUT_MS } from '../../constants/api.js';

const request = async (path, options = {}) => {
  const response = await fetch(new URL(path, API_BASE_URL), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ...options,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // The API's own message names what is wrong and lists what is valid —
    // far more useful than a generic status text.
    throw new Error(body?.error?.message || `Request failed with ${response.status}`);
  }

  return body;
};

const post = (path, payload) =>
  request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });

export const fetchStrategyStatus = () => request('/api/strategy/status');
export const startStrategyRequest = (name, params) => post('/api/strategy/start', { name, params });
export const stopStrategyRequest = () => post('/api/strategy/stop');

export const fetchBalance = () => request('/api/balance');
export const fetchPositions = () => request('/api/positions');
export const fetchTrades = (limit = 200) => request(`/api/trades?limit=${limit}`);
