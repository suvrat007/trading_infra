import { runBackfill } from './backfill.js';
import { GAP_BACKFILL_DEBOUNCE_MS } from './constants/backfill.js';
import { LOG_CONTINUITY } from './constants/logging.js';
import { CANDLE_ORDER, classifyCandle } from './utils/shared/continuity.js';
import { intervalToMs } from './utils/shared/interval.js';

/**
 * Turns gap repair from a CONNECTION-triggered job into a DATA-triggered one.
 *
 * Backfill already runs whenever the ingest socket connects, which covers
 * startup and outages. What it did not cover is a hole that opens while the
 * socket stays perfectly healthy — an insert that threw and was logged and
 * dropped, a Postgres blip, a constraint rejection. On a socket that stays up
 * for hours, such a hole would sit there until the next reconnect, with the
 * indicator engine quietly computing over a window that has a bar missing.
 *
 * This observes the candle stream and notices immediately. It is an OBSERVER,
 * not a transform: it subscribes and emits nothing, so it can be added to or
 * removed from the pipeline without changing what flows through it.
 */

let unsubscribe = null;

/**
 * State is PER SERIES, not global.
 *
 * With one timeframe a single `lastOpenTime` was correct. With five interleaved
 * on one socket it is actively wrong: a 1d candle followed by a 1m candle looks
 * like a jump 1,439 minutes backwards, so every candle would be reported
 * out-of-order and no real gap would ever be seen. Likewise one shared repair
 * timer meant a 1m gap cancelled a pending 1h repair.
 */
const lastOpenTimes = new Map();
const repairTimers = new Map();

const keyOf = (symbol, interval) => `${symbol}|${interval}`;

const scheduleRepair = (symbol, interval) => {
  // Debounced per series: a flaky minute can produce several gaps, and one
  // backfill after things settle beats one per gap. runBackfill also guards
  // against overlapping runs, so a late trigger is harmless either way.
  const key = keyOf(symbol, interval);
  clearTimeout(repairTimers.get(key));

  const timer = setTimeout(() => {
    repairTimers.delete(key);
    runBackfill({ symbol, interval }).catch((err) =>
      console.error(`${LOG_CONTINUITY} repair failed for ${key}:`, err.message)
    );
  }, GAP_BACKFILL_DEBOUNCE_MS);

  // Never hold the process open for a repair that can wait for the next boot.
  timer.unref();
  repairTimers.set(key, timer);
};

export const startContinuityWatch = (source) => {
  const onCandle = (candle) => {
    // emit() is synchronous, so a throw here escapes into the ingester and is
    // reported as an insert failure. Gap detection is a guard; it must never
    // interfere with the candle that triggered it.
    try {
      const key = keyOf(candle.symbol, candle.interval);
      const lastOpenTime = lastOpenTimes.get(key) ?? null;

      const intervalMs = intervalToMs(candle.interval);
      const { order, missing } = classifyCandle(candle.open_time, lastOpenTime, intervalMs);

      if (order === CANDLE_ORDER.STALE) {
        // Do not move the marker backwards, or the next candle would look like
        // a gap the size of however far back this one reached.
        console.warn(
          `${LOG_CONTINUITY} ${key}: out-of-order candle ${candle.open_time} ` +
          `(newest is ${lastOpenTime}) — ignored`
        );
        return;
      }

      lastOpenTimes.set(key, Math.max(candle.open_time, lastOpenTime ?? candle.open_time));

      if (order !== CANDLE_ORDER.GAP) return;

      console.warn(
        `${LOG_CONTINUITY} ${key}: ${missing} candle(s) missing before ` +
        `${new Date(candle.open_time).toISOString()} — scheduling repair`
      );

      scheduleRepair(candle.symbol, candle.interval);
    } catch (err) {
      console.error(`${LOG_CONTINUITY} check failed for ${candle?.open_time}:`, err.message);
    }
  };

  source.on('candle', onCandle);
  unsubscribe = () => source.off('candle', onCandle);

  console.log(`${LOG_CONTINUITY} watching candle stream for gaps (per symbol+interval)`);
};

export const stopContinuityWatch = () => {
  unsubscribe?.();
  unsubscribe = null;

  for (const timer of repairTimers.values()) clearTimeout(timer);
  repairTimers.clear();
  lastOpenTimes.clear();
};
