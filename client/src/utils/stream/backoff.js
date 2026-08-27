import { WS_BACKOFF_BASE_MS, WS_MAX_BACKOFF_MS } from '../../constants/websocket.js';

/**
 * Same shape as the server's ingest backoff, and for the same reason: if the
 * backend restarts, every open tab reconnects at once. Jitter spreads them out
 * instead of stampeding the server the instant it comes back up.
 */
export function backoffDelay(attempt) {
  const capped = Math.min(WS_BACKOFF_BASE_MS * 2 ** attempt, WS_MAX_BACKOFF_MS);
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}
