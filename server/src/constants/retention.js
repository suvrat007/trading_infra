import './env.js';
import { COLD_START_CANDLES } from './backfill.js';
import { MAX_CANDLE_LIMIT } from './candles.js';
import { INDICATOR_LOOKBACK, INDICATOR_WARMUP } from './indicators.js';

/**
 * Rolling cap on stored candles, per (symbol, interval).
 *
 * 5,000 is what a chart can meaningfully render for one series, so storing more
 * serves no display purpose. At ~265 bytes/row that is ~1.3 MB, or ~3.5 days of
 * 1m bars.
 *
 * Note this IS effectively one-way: the backfill fills holes between the oldest
 * and newest rows held, it does not extend history backwards. Raise this via env
 * BEFORE you need deeper history (backtesting), not after.
 */
export const MAX_CANDLES_PER_SERIES = Number(process.env.MAX_CANDLES_PER_SERIES || 5_000);

export const RETENTION_ENABLED = process.env.RETENTION_ENABLED !== 'false';

/**
 * Below this the system breaks rather than merely losing history: indicators
 * need their lookback plus warmup, REST can be asked for MAX_CANDLE_LIMIT, and
 * a cold start seeds COLD_START_CANDLES.
 */
export const MIN_SAFE_RETENTION = Math.max(
  INDICATOR_LOOKBACK + INDICATOR_WARMUP,
  MAX_CANDLE_LIMIT,
  COLD_START_CANDLES
);

if (RETENTION_ENABLED && MAX_CANDLES_PER_SERIES < MIN_SAFE_RETENTION) {
  throw new RangeError(
    `MAX_CANDLES_PER_SERIES (${MAX_CANDLES_PER_SERIES}) is below the minimum the ` +
    `system needs to function (${MIN_SAFE_RETENTION}). Indicators, REST limits and ` +
    'cold-start backfill would all be starved.'
  );
}
