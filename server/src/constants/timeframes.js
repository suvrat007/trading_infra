import './env.js';

/**
 * Every timeframe the system ingests and stores.
 *
 * All of these are NATIVE Binance kline intervals, so each bar is exactly what
 * the exchange published — not something this system computed. That rules out a
 * whole class of bug: there is no rollup step, so a gap in one timeframe cannot
 * quietly corrupt another, and every timeframe is repaired by the same backfill
 * that already works.
 *
 * Binance offers: 1s 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M.
 * Anything outside that list would have to be aggregated from 1m data, which is
 * a different design with its own completeness rules. Deliberately not done.
 *
 * Adding a timeframe means: an entry here, a partition in a migration, and
 * nothing else. Every consumer reads this file.
 */

/** Used wherever the system needs a definite default rather than "all". */
export const BASE_INTERVAL = '1m';

export const TIMEFRAMES = Object.freeze([
  { id: '1m',  ms: 60_000,     label: '1m', minutes: 1 },
  { id: '5m',  ms: 300_000,    label: '5m', minutes: 5 },
  { id: '15m', ms: 900_000,    label: '15m', minutes: 15 },
  { id: '1h',  ms: 3_600_000,  label: '1h', minutes: 60 },
  { id: '1d',  ms: 86_400_000, label: '1d', minutes: 1440 },
]);

export const TIMEFRAME_IDS = Object.freeze(TIMEFRAMES.map((t) => t.id));

const BY_ID = new Map(TIMEFRAMES.map((t) => [t.id, t]));

export const getTimeframe = (id) => BY_ID.get(String(id)) ?? null;

export const isKnownTimeframe = (id) => BY_ID.has(String(id));

/**
 * Which timeframes to subscribe to. Defaults to all of them.
 *
 * `INTERVALS=1m,1h` narrows it — useful when developing, since a 1d bar only
 * closes once a day and an unused subscription is still an open stream.
 */
const requested = (process.env.INTERVALS || TIMEFRAME_IDS.join(','))
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

export const ACTIVE_TIMEFRAMES = Object.freeze(
  requested.filter(isKnownTimeframe).length > 0
    ? requested.filter(isKnownTimeframe)
    : [...TIMEFRAME_IDS]
);

/** What the UI opens on, and what the strategy trades unless told otherwise. */
export const DEFAULT_TIMEFRAME = ACTIVE_TIMEFRAMES.includes(process.env.DEFAULT_TIMEFRAME)
  ? process.env.DEFAULT_TIMEFRAME
  : (ACTIVE_TIMEFRAMES.includes(BASE_INTERVAL) ? BASE_INTERVAL : ACTIVE_TIMEFRAMES[0]);

/**
 * Partition name for a timeframe: candles_1m, candles_15m, and so on.
 *
 * Built from the id and nothing else, because it goes into DDL where a value
 * cannot be parameterised. Every id comes from TIMEFRAME_IDS, so no
 * user-supplied string ever reaches a CREATE TABLE.
 */
export const partitionFor = (id) => {
  if (!isKnownTimeframe(id)) throw new TypeError(`Unknown timeframe "${id}"`);
  return `candles_${id}`;
};

/**
 * Retention, in bars, per timeframe.
 *
 * A flat cap would be wrong in both directions: 5,000 one-minute bars is 3.5
 * days, while 5,000 daily bars is 13 years of history that will never exist.
 * These give each timeframe a useful window, and the whole set is under 12,000
 * rows per symbol — a few megabytes.
 *
 *   1m    5,000 bars = 3.5 days       1h   2,000 bars = 83 days
 *   5m    3,000 bars = 10 days        1d   1,000 bars = 2.7 years
 *   15m   3,000 bars = 31 days
 */
export const RETENTION_BY_TIMEFRAME = Object.freeze({
  '1m': 5_000,
  '5m': 3_000,
  '15m': 3_000,
  '1h': 2_000,
  '1d': 1_000,
});

/**
 * Every timeframe must retain at least this many bars, or the parts of the
 * system that read history break: indicators need lookback + warmup, the REST
 * layer allows up to MAX_CANDLE_LIMIT, and a cold start backfills
 * COLD_START_CANDLES. Enforced at boot in constants/retention.js.
 */
export const retentionFor = (id) => RETENTION_BY_TIMEFRAME[id] ?? 5_000;
