import { EventEmitter } from 'node:events';
import { pool } from './db.js';
import { INDICATOR_LOOKBACK } from './constants/indicators.js';
import { LOG_INDICATORS } from './constants/logging.js';
import { SQL_SELECT_RECENT_CANDLES } from './constants/sql.js';
import { toNumericCandles } from './utils/indicators/convert.js';
import { computeIndicators } from './utils/indicators/registry.js';

/**
 * A TRANSFORM STAGE in the pipeline, not a new branch of it:
 *
 *   ingest.js --emit('candle')--> indicatorEngine --emit('candle')--> broadcast.js
 *
 * It consumes an EventEmitter and produces an EventEmitter with the same event
 * name and the same candle shape, plus an `indicators` field. That is the whole
 * design: the ingester still knows nothing downstream, and the broadcaster is
 * completely unchanged — it cannot tell whether its source is the raw ingester
 * or this. Dropping the engine out of the pipeline is a one-line edit in
 * index.js, and adding a second transform later needs no new plumbing.
 */

let unsubscribe = null;

/**
 * Recalculate from scratch over the last N candles, read back out of Postgres.
 *
 * This is deliberately STATELESS: no rolling buffer, no incremental update, no
 * accumulated state to drift or corrupt. Every calculation is a pure function
 * of what is in the database right now, so a restart, a backfill, or a late
 * duplicate all converge on the same answer with no repair step.
 *
 * The cost is real and worth naming: one query plus a full recompute per
 * candle, O(lookback) work to learn one new value. At one candle per minute
 * over 200 rows that is microseconds and completely irrelevant. On a tick
 * stream it would be the wrong choice, and you would keep a rolling window in
 * memory and update incrementally — trading simplicity for speed, and taking
 * on the state-management problem this design avoids.
 */
async function calculateFor(candle) {
  const { rows } = await pool.query(SQL_SELECT_RECENT_CANDLES, [
    candle.symbol,
    candle.interval,
    INDICATOR_LOOKBACK,
  ]);

  const numeric = toNumericCandles(rows);
  const { latest } = computeIndicators(numeric);

  return { latest, sampleSize: numeric.length };
}

export function startIndicatorEngine(source) {
  const output = new EventEmitter();

  const onCandle = async (candle) => {
    try {
      const { latest, sampleSize } = await calculateFor(candle);

      console.log(
        `${LOG_INDICATORS} computed over ${sampleSize} candles ` +
        `rsi14=${latest.rsi14 ?? 'n/a'} sma20=${latest.sma20 ?? 'n/a'}`
      );

      output.emit('candle', { ...candle, indicators: latest });
    } catch (err) {
      // Analytics must never break the price feed. If the query or the math
      // fails, forward the candle with indicators: null so the chart still
      // updates and the client can render a gap instead of freezing.
      console.error(`${LOG_INDICATORS} calculation failed:`, err.message);
      output.emit('candle', { ...candle, indicators: null });
    }
  };

  source.on('candle', onCandle);
  unsubscribe = () => source.off('candle', onCandle);

  console.log(`${LOG_INDICATORS} engine attached (lookback ${INDICATOR_LOOKBACK} candles)`);

  return output;
}

export function stopIndicatorEngine() {
  unsubscribe?.();
  unsubscribe = null;
}
