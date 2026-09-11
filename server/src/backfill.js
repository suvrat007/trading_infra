import { pool } from './db.js';
import { INTERVAL, SYMBOL } from './constants/binance.js';
import { ACTIVE_TIMEFRAMES } from './constants/timeframes.js';
import {
  COLD_START_CANDLES,
  GAP_SCAN_LIMIT,
  MAX_CANDLES_PER_RUN,
  MAX_REQUESTS_PER_RUN,
  REQUEST_SPACING_MS,
} from './constants/backfill.js';
import { LOG_BACKFILL } from './constants/logging.js';
import {
  SQL_CANDLE_BOUNDS,
  SQL_FIND_INTERIOR_GAPS,
  SQL_INSERT_CANDLE,
} from './constants/sql.js';
import { pruneSeries } from './retention.js';
import { fetchKlines, restKlineToRow } from './utils/backfill/klines.js';
import { planRequests } from './utils/backfill/ranges.js';
import {
  countCandlesBetween,
  intervalToMs,
  latestClosedOpenTime,
} from './utils/shared/interval.js';

/**
 * Recovers candles the live stream never delivered.
 *
 * The WebSocket has no replay buffer, so anything that closed while the server
 * was disconnected — or down, or starting for the first time — exists only in
 * Binance's REST history. This is the repair path for all of it.
 *
 * Runs on every successful connection of the ingest socket, which covers
 * startup and every reconnect with one code path. Inserts are idempotent
 * against the unique index, so a backfill overlapping live data is harmless and
 * needs no coordination with the ingester.
 */

// One run at a time. A reconnect storm would otherwise start several runs that
// fetch the same ranges and race each other into the same ON CONFLICT.
let running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every open_time that should exist but does not, oldest first.
 *
 * Two different kinds of hole, found two different ways:
 *
 *  - INTERIOR gaps sit between rows we already have. SQL finds them by laying
 *    down the expected grid and anti-joining.
 *  - The TRAILING gap runs from our newest row to the last closed candle. SQL
 *    cannot find it, because the expected grid stops at the newest row that
 *    exists — only application code knows what time it is now.
 *
 * An empty table is neither: there is no grid to compare against, so it seeds a
 * fixed window of recent history instead.
 */
const findMissing = async (symbol, interval, intervalMs, limit) => {
  const { rows: [bounds] } = await pool.query(SQL_CANDLE_BOUNDS, [symbol, interval]);
  const newestClosed = latestClosedOpenTime(intervalMs);

  if (!bounds || bounds.total === 0) {
    const start = newestClosed - (COLD_START_CANDLES - 1) * intervalMs;
    const missing = [];
    for (let t = start; t <= newestClosed && missing.length < limit; t += intervalMs) {
      missing.push(t);
    }

    return { missing, reason: 'cold start', bounds: null };
  }

  const { rows: interior } = await pool.query(SQL_FIND_INTERIOR_GAPS, [
    symbol,
    interval,
    intervalMs,
    limit,
  ]);

  const missing = interior.map((row) => Number(row.open_time));

  // The trailing gap is generated here, not in SQL: the expected grid stops at
  // the newest row that exists, so only this side knows what time it is now.
  // Bounded as well — a server down for a year would otherwise build a
  // half-million-element array to describe a hole one run cannot fill anyway.
  for (
    let t = bounds.newest + intervalMs;
    t <= newestClosed && missing.length < limit;
    t += intervalMs
  ) {
    missing.push(t);
  }

  return { missing, reason: 'gap scan', bounds };
};

/** Fetch one chunk and insert it; returns how many rows were genuinely new. */
const fillChunk = async (symbol, interval, chunk) => {
  const klines = await fetchKlines({
    symbol,
    interval,
    startTime: chunk.start,
    endTime: chunk.end,
  });

  let inserted = 0;

  for (const kline of klines) {
    const result = await pool.query(SQL_INSERT_CANDLE, restKlineToRow(kline, symbol, interval));
    if (result.rowCount > 0) inserted += 1;
  }

  return { fetched: klines.length, inserted };
};

/**
 * @returns {Promise<{skipped?: boolean, missing: number, inserted: number, deferred: number}>}
 */
export const runBackfill = async ({ symbol = SYMBOL, interval = INTERVAL } = {}) => {
  if (running) {
    console.log(`${LOG_BACKFILL} already running — skipping this trigger`);
    return { skipped: true, missing: 0, inserted: 0, deferred: 0 };
  }

  running = true;
  const startedAt = Date.now();

  try {
    const intervalMs = intervalToMs(interval);
    const { missing, reason, bounds } = await findMissing(
      symbol, interval, intervalMs, MAX_CANDLES_PER_RUN
    );

    if (missing.length === 0) {
      const held = bounds ? bounds.total : 0;
      console.log(`${LOG_BACKFILL} no gaps for ${symbol} ${interval} (${held} candles held)`);
      return { missing: 0, inserted: 0, deferred: 0 };
    }

    const { chunks, candles, deferred } = planRequests(missing, intervalMs, {
      maxCandles: MAX_CANDLES_PER_RUN,
      maxRequests: MAX_REQUESTS_PER_RUN,
    });

    console.log(
      `${LOG_BACKFILL} ${reason}: ${missing.length} candle(s) missing, ` +
      `fetching ${candles} in ${chunks.length} request(s)` +
      (deferred > 0 ? `, ${deferred} chunk(s) deferred to the next run` : '')
    );

    let inserted = 0;

    for (const [index, chunk] of chunks.entries()) {
      // Spacing between calls, not before the first — no reason to delay the
      // only request when there is just one gap to fill.
      if (index > 0) await sleep(REQUEST_SPACING_MS);

      const result = await fillChunk(symbol, interval, chunk);
      inserted += result.inserted;

      console.log(
        `${LOG_BACKFILL} ${new Date(chunk.start).toISOString()} -> ` +
        `${new Date(chunk.end).toISOString()} ` +
        `fetched ${result.fetched}, inserted ${result.inserted}`
      );
    }

    // Once per run, not per row — a 5,000-candle fill would otherwise issue
    // 5,000 DELETEs to remove the same handful of rows.
    if (inserted > 0) await pruneSeries(symbol, interval);

    console.log(
      `${LOG_BACKFILL} done: ${inserted} new candle(s) in ${Date.now() - startedAt}ms`
    );

    return { missing: missing.length, inserted, deferred };
  } catch (err) {
    // Backfill is a repair path, not the product. A Binance outage or a rate
    // limit must not take down a server that is happily ingesting live candles;
    // the next reconnect tries again.
    console.error(`${LOG_BACKFILL} failed:`, err.message);
    return { missing: 0, inserted: 0, deferred: 0, error: err.message };
  } finally {
    running = false;
  }
};

/** Exposed for the REST layer and for tests that want the numbers, not the work. */
export const inspectGaps = async ({ symbol = SYMBOL, interval = INTERVAL } = {}) => {
  const intervalMs = intervalToMs(interval);
  // Scanned with the diagnostic ceiling, not the per-run one, so the number
  // reported is the real backlog rather than what a single run would fetch.
  const { missing, bounds } = await findMissing(symbol, interval, intervalMs, GAP_SCAN_LIMIT);

  return {
    symbol,
    interval,
    held: bounds ? bounds.total : 0,
    oldest: bounds ? bounds.oldest : null,
    newest: bounds ? bounds.newest : null,
    missing: missing.length,
    expected: bounds
      ? countCandlesBetween(bounds.oldest, latestClosedOpenTime(intervalMs), intervalMs)
      : 0,
  };
};


/**
 * Repair every active timeframe, one after another.
 *
 * SEQUENTIAL, not parallel. Each run can fetch up to MAX_CANDLES_PER_RUN bars
 * from Binance's REST API, and firing five of those at once is the fastest way
 * to get rate-limited — which would fail the repair it was trying to perform.
 * Five sequential runs at startup cost a few seconds and nothing is waiting.
 *
 * One timeframe failing must not stop the others: a 1d backfill that errors
 * should not leave the 1m series unrepaired.
 */
export const runBackfillAll = async ({ symbol = SYMBOL, intervals = ACTIVE_TIMEFRAMES } = {}) => {
  const results = {};

  for (const interval of intervals) {
    try {
      results[interval] = await runBackfill({ symbol, interval });
    } catch (err) {
      console.error(`${LOG_BACKFILL} ${symbol} ${interval} failed:`, err.message);
      results[interval] = { failed: true, error: err.message, missing: 0, inserted: 0, deferred: 0 };
    }
  }

  const inserted = Object.values(results).reduce((sum, r) => sum + (r.inserted ?? 0), 0);
  console.log(`${LOG_BACKFILL} sweep complete — ${inserted} candle(s) inserted across ${intervals.length} timeframe(s)`);

  return results;
};
