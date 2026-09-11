import { API_BASE_URL, FETCH_TIMEOUT_MS, TIMEFRAMES_ENDPOINT } from '../../constants/api.js';

/**
 * Which timeframes the server ingests, and how much data each holds.
 *
 * Fetched rather than hardcoded for the same reason the strategy form is
 * generated from the API: a list duplicated in the frontend drifts the day a
 * timeframe is added or removed server-side, and the failure is silent — the
 * picker simply stops offering something that exists.
 */
export async function fetchTimeframes({ symbol, signal } = {}) {
  const url = new URL(TIMEFRAMES_ENDPOINT, API_BASE_URL);
  if (symbol) url.searchParams.set('symbol', symbol);

  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(url, { signal: combined });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Request failed with ${response.status}`);
  }

  return response.json();
}
