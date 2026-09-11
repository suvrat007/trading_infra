import { pool } from './db.js';
import { LOG_RETENTION } from './constants/logging.js';
import { MAX_CANDLES_PER_SERIES, RETENTION_ENABLED } from './constants/retention.js';
import { SQL_DISTINCT_SERIES, SQL_PRUNE_CANDLES } from './constants/sql.js';
import { retentionFor } from './constants/timeframes.js';

/**
 * Keeps the candles table bounded: newest N per (symbol, interval).
 *
 * Runs on the audit cycle rather than per insert — pruning after every candle
 * would issue 1,440 DELETEs a day to remove one row each.
 */

/**
 * Trim one series to the cap. Called after every live insert.
 *
 * Deliberately NOT in the same statement as the INSERT: a CTE shares one
 * snapshot, so the DELETE could not see the row just added and the table would
 * settle at cap + 1.
 */
export const pruneSeries = async (symbol, interval, limit = null) => {
  if (!RETENTION_ENABLED) return 0;

  // Per timeframe, not one flat number. 5,000 bars is 3.5 days of 1m data but
  // 13 years of 1d data — a single cap would starve one end and hoard the
  // other. An explicit `limit` still wins, for the audit sweep and for tests.
  const cap = limit ?? retentionFor(interval);

  const { rowCount } = await pool.query(SQL_PRUNE_CANDLES, [symbol, interval, cap]);

  if (rowCount > 0) {
    console.log(`${LOG_RETENTION} ${symbol} ${interval}: pruned ${rowCount} (cap ${cap})`);
  }

  return rowCount;
};

/** Sweeps every series present. With prune-on-insert this exists for series
 *  orphaned by a SYMBOL change, which receive no further inserts to trim them. */
export const pruneCandles = async ({ limit = MAX_CANDLES_PER_SERIES } = {}) => {
  if (!RETENTION_ENABLED) return { skipped: true, series: [], deleted: 0 };

  const { rows: series } = await pool.query(SQL_DISTINCT_SERIES);
  const results = [];
  let deleted = 0;

  for (const { symbol, interval, held } of series) {
    if (held <= limit) {
      results.push({ symbol, interval, held, deleted: 0 });
      continue;
    }

    const { rowCount } = await pool.query(SQL_PRUNE_CANDLES, [symbol, interval, limit]);
    deleted += rowCount;
    results.push({ symbol, interval, held: held - rowCount, deleted: rowCount });

    console.log(
      `${LOG_RETENTION} ${symbol} ${interval}: pruned ${rowCount} candle(s), ` +
      `${held - rowCount} retained (cap ${limit})`
    );
  }

  return { series: results, deleted, limit };
};

/** Read-only view of where each series sits against the cap. */
export const inspectRetention = async ({ limit = MAX_CANDLES_PER_SERIES } = {}) => {
  const { rows } = await pool.query(SQL_DISTINCT_SERIES);

  return {
    enabled: RETENTION_ENABLED,
    limit,
    series: rows.map(({ symbol, interval, held }) => ({
      symbol,
      interval,
      held,
      overCap: Math.max(held - limit, 0),
    })),
  };
};
