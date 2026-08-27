import { BACKOFF_BASE_MS, MAX_BACKOFF_MS } from '../../constants/connection.js';

/**
 * Exponential backoff with jitter.
 * Jitter matters: when Binance cycles a gateway it drops every client at once,
 * and un-jittered clients all retry at the same instant — a thundering herd.
 */
export function backoffDelay(attempt) {
  const capped = Math.min(BACKOFF_BASE_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}
