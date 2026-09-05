/**
 * Data-integrity auditing.
 *
 * Severity is the important distinction here:
 *
 *   ERROR    — violates something true of a candle BY DEFINITION. Always a bug,
 *              never a market condition. Most are now impossible thanks to the
 *              CHECK constraints, so a non-zero count means either the
 *              constraints are missing or something wrote around them.
 *   WARNING  — implausible but not impossible. Needs a human to judge. BTC
 *              genuinely can move 10% in a minute during a liquidation cascade,
 *              so this flags for attention rather than declaring corruption.
 */
export const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
};

export const AUDIT_STATUS = {
  OK: 'ok',
  WARNING: 'warning',
  ERROR: 'error',
};

/**
 * Close-to-close move that counts as implausible for one candle.
 *
 * Set from the instrument's behaviour, not from taste: 10% in a single minute
 * on BTC is rare but real. Too tight and every volatile hour cries wolf; too
 * loose and a decimal-point bug slips through.
 */
export const MAX_CLOSE_JUMP_RATIO = 0.10;

/** Ingestion is considered stalled once the newest candle is this far behind. */
export const STALE_AFTER_INTERVALS = 2;

/**
 * How many recent candles to re-fetch when verifying against Binance.
 *
 * One REST call's worth. The cross-check is the only test that can catch data
 * that is internally valid but simply wrong, and it is also the only one that
 * costs an API request — so it is opt-in per request, never automatic.
 */
export const CROSS_CHECK_SAMPLE = 500;

/** Fields compared byte-for-byte against the exchange's own record. */
export const CROSS_CHECK_FIELDS = ['open', 'high', 'low', 'close', 'volume'];

/**
 * How often the background audit runs.
 *
 * A safety net, not the primary defence — the CHECK constraints stop bad rows
 * at write time and the continuity watcher reacts to gaps within seconds. This
 * exists to catch what both of those miss: damage done outside the application
 * entirely, such as a manual psql session or a restore from a stale dump.
 */
export const AUDIT_INTERVAL_MS = 15 * 60 * 1_000;
