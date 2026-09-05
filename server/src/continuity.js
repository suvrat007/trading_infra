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
let repairTimer = null;
let lastOpenTime = null;

const scheduleRepair = (symbol, interval) => {
  // Debounced: a flaky minute can produce several gaps, and one backfill after
  // things settle beats one per gap. runBackfill also guards against
  // overlapping runs, so a late trigger is harmless either way.
  clearTimeout(repairTimer);

  repairTimer = setTimeout(() => {
    repairTimer = null;
    runBackfill({ symbol, interval }).catch((err) =>
      console.error(`${LOG_CONTINUITY} repair failed:`, err.message)
    );
  }, GAP_BACKFILL_DEBOUNCE_MS);

  // Never hold the process open for a repair that can wait for the next boot.
  repairTimer.unref();
};

export const startContinuityWatch = (source) => {
  const onCandle = (candle) => {
    const intervalMs = intervalToMs(candle.interval);
    const { order, missing } = classifyCandle(candle.open_time, lastOpenTime, intervalMs);

    if (order === CANDLE_ORDER.STALE) {
      // Do not move the marker backwards, or the next candle would look like a
      // gap the size of however far back this one reached.
      console.warn(
        `${LOG_CONTINUITY} out-of-order candle ${candle.open_time} ` +
        `(newest is ${lastOpenTime}) — ignored`
      );
      return;
    }

    lastOpenTime = Math.max(candle.open_time, lastOpenTime ?? candle.open_time);

    if (order !== CANDLE_ORDER.GAP) return;

    console.warn(
      `${LOG_CONTINUITY} ${missing} candle(s) missing before ` +
      `${new Date(candle.open_time).toISOString()} — scheduling repair`
    );

    scheduleRepair(candle.symbol, candle.interval);
  };

  source.on('candle', onCandle);
  unsubscribe = () => source.off('candle', onCandle);

  console.log(`${LOG_CONTINUITY} watching candle stream for gaps`);
};

export const stopContinuityWatch = () => {
  unsubscribe?.();
  unsubscribe = null;

  clearTimeout(repairTimer);
  repairTimer = null;
  lastOpenTime = null;
};
