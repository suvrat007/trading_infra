import { MAX_KLINES_PER_REQUEST } from '../../constants/backfill.js';
import { countCandlesBetween } from '../shared/interval.js';

/**
 * Collapse a list of missing open_times into contiguous ranges.
 *
 * A three-hour outage leaves 180 individual missing timestamps. Fetching each
 * one is 180 REST calls; fetching the range they form is one. Grouping first is
 * the difference between a backfill that finishes and a backfill that gets the
 * IP rate-limited.
 *
 * Input must be sorted ascending — the SQL that produces it orders explicitly.
 */
export const groupIntoRanges = (openTimes, intervalMs) => {
  if (openTimes.length === 0) return [];

  const ranges = [];
  let start = openTimes[0];
  let previous = openTimes[0];

  for (let i = 1; i < openTimes.length; i += 1) {
    const current = openTimes[i];

    // Still contiguous if this timestamp is exactly one interval on.
    if (current === previous + intervalMs) {
      previous = current;
      continue;
    }

    ranges.push({ start, end: previous });
    start = current;
    previous = current;
  }

  ranges.push({ start, end: previous });
  return ranges;
};

/**
 * Split any range longer than Binance will serve in one call.
 *
 * The API caps a response at 1000 candles regardless of the time span asked
 * for, so a wider range silently returns a truncated answer. Splitting up front
 * means every request maps to a complete, verifiable chunk.
 */
export const chunkRange = (range, intervalMs, limit = MAX_KLINES_PER_REQUEST) => {
  const chunks = [];
  const span = limit * intervalMs;

  for (let start = range.start; start <= range.end; start += span) {
    const end = Math.min(start + span - intervalMs, range.end);
    chunks.push({ start, end, count: countCandlesBetween(start, end, intervalMs) });
  }

  return chunks;
};

/**
 * Missing timestamps -> request-sized chunks, capped for one run.
 *
 * Oldest first, so repeated runs make forward progress through a large hole
 * rather than re-fetching the same recent slice each time.
 */
export const planRequests = (openTimes, intervalMs, { maxCandles, maxRequests }) => {
  const chunks = groupIntoRanges(openTimes, intervalMs)
    .flatMap((range) => chunkRange(range, intervalMs));

  const planned = [];
  let candles = 0;

  for (const chunk of chunks) {
    if (planned.length >= maxRequests) break;
    if (candles + chunk.count > maxCandles) break;

    planned.push(chunk);
    candles += chunk.count;
  }

  return { chunks: planned, candles, deferred: chunks.length - planned.length };
};
