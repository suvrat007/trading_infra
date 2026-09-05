import { CROSS_CHECK_FIELDS } from '../../constants/audit.js';
import { fetchKlines } from '../backfill/klines.js';

/**
 * Compare stored candles against the exchange's own record.
 *
 * This is the ONLY check that can catch data which is internally perfect and
 * simply wrong. Every other check verifies a candle against itself or against
 * the grid; nothing about `high >= low` would notice if ETH's prices had been
 * stored under BTCUSDT.
 *
 * Comparison is on the raw STRINGS, not parsed numbers. Both sides originate as
 * exchange strings and are stored exactly, so "78000.10000000" must come back
 * identical — parsing first would mask a precision bug by making 78000.1 and
 * 78000.10000000 compare equal, which is precisely what we want to detect.
 */
export const crossCheckAgainstSource = async ({ symbol, interval, rows }) => {
  if (rows.length === 0) {
    return { compared: 0, mismatched: 0, missingFromSource: 0, mismatches: [] };
  }

  const times = rows.map((row) => Number(row.open_time));
  const startTime = Math.min(...times);
  const endTime = Math.max(...times);

  const klines = await fetchKlines({ symbol, interval, startTime, endTime });
  const bySource = new Map(klines.map((kline) => [kline[0], kline]));

  const mismatches = [];
  let compared = 0;
  let missingFromSource = 0;

  for (const row of rows) {
    const kline = bySource.get(Number(row.open_time));

    // Not a mismatch: the response is capped at 1000 candles, so a wide sample
    // legitimately reaches past what one call returns.
    if (!kline) {
      missingFromSource += 1;
      continue;
    }

    compared += 1;

    // Binance REST klines are positional: [1] open [2] high [3] low [4] close [5] volume
    const theirs = [kline[1], kline[2], kline[3], kline[4], kline[5]];

    CROSS_CHECK_FIELDS.forEach((field, index) => {
      if (row[field] === theirs[index]) return;

      mismatches.push({
        open_time: Number(row.open_time),
        field,
        stored: row[field],
        source: theirs[index],
      });
    });
  }

  return {
    compared,
    missingFromSource,
    mismatched: new Set(mismatches.map((m) => m.open_time)).size,
    // Bounded: a systemic bug would otherwise return one entry per candle.
    mismatches: mismatches.slice(0, 20),
  };
};
