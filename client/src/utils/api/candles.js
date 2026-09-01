import {
  API_BASE_URL,
  CANDLES_ENDPOINT,
  FETCH_TIMEOUT_MS,
} from '../../constants/api.js';

function buildCandlesUrl({ symbol, interval, limit, indicators }) {
  const url = new URL(CANDLES_ENDPOINT, API_BASE_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', String(limit));
  if (indicators) url.searchParams.set('indicators', 'true');
  return url.toString();
}

/**
 * Fetch the historical window, optionally with every indicator series.
 *
 * Indicators are computed on the SERVER, not here. The same code that feeds the
 * live WebSocket values produces these, so a line drawn from history and the
 * point appended to it a minute later cannot disagree — which they would if the
 * browser reimplemented the math.
 *
 * @param {AbortSignal} [signal] cancels on unmount, so a slow response cannot
 *   resolve into a dead component.
 * @returns {Promise<{candles: object[], indicators: object|null}>}
 */

export async function fetchCandles({ symbol, interval, limit, indicators = false, signal }) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(buildCandlesUrl({ symbol, interval, limit, indicators }), {
    signal: combined,
  });

  if (!response.ok) {
    // The API returns { error: { code, message } }; surface it if it is there.
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Request failed with ${response.status}`);
  }

  const body = await response.json();

  return {
    candles: body.candles ?? [],
    indicators: body.indicators ?? null,
  };
}
