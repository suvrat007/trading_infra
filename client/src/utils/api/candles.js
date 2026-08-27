import {
  API_BASE_URL,
  CANDLES_ENDPOINT,
  FETCH_TIMEOUT_MS,
} from '../../constants/api.js';

function buildCandlesUrl({ symbol, interval, limit }) {
  const url = new URL(CANDLES_ENDPOINT, API_BASE_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

/**
 * @param {AbortSignal} [signal] cancels the request when the component
 *   unmounts, so a slow response cannot resolve into a dead component.
 */
export async function fetchCandles({ symbol, interval, limit, signal }) {
  // Two independent reasons to abort — unmount and timeout — so combine them.
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(buildCandlesUrl({ symbol, interval, limit }), {
    signal: combined,
  });

  if (!response.ok) {
    // The API returns { error: { code, message } }; surface it if it is there.
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Request failed with ${response.status}`);
  }

  const body = await response.json();
  return body.candles ?? [];
}
