const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Binance interval string -> milliseconds. Monthly is not a fixed grid. */
export const intervalToMs = (interval) => {
  const match = /^(\d+)([smhdw])$/.exec(String(interval));
  if (!match) throw new TypeError(`Unsupported interval "${interval}"`);

  return Number(match[1]) * UNIT_MS[match[2]];
};

export const CANDLE_ORDER = {
  FIRST: 'first',
  NEXT: 'next',
  DUPLICATE: 'duplicate',
  GAP: 'gap',
  STALE: 'stale',
};

/**
 * Where an arriving candle sits relative to the last one we drew.
 *
 * Candles occupy a fixed time grid, so continuity is arithmetic — no network
 * call needed to notice that something is missing. Only an actual discontinuity
 * costs a request.
 *
 * Four outcomes, and each needs different handling:
 *
 *   FIRST     nothing drawn yet — draw it, nothing to compare against
 *   NEXT      exactly one interval on — the normal case, draw it
 *   DUPLICATE same open_time — a replay after reconnect. Safe to draw: the
 *             chart replaces a same-timestamp point rather than appending
 *   GAP       later than expected — draw it, then repair the hole from REST
 *   STALE     EARLIER than the last point. Must be dropped: the charting
 *             library throws "Cannot update oldest data" on an out-of-order
 *             timestamp, and that throw lands halfway through updating ten
 *             series, leaving the candle updated and some indicator lines not
 */
export const classifyCandle = (openTime, lastOpenTime, intervalMs) => {
  if (lastOpenTime === null || lastOpenTime === undefined) {
    return { order: CANDLE_ORDER.FIRST, missing: 0 };
  }

  if (openTime === lastOpenTime) return { order: CANDLE_ORDER.DUPLICATE, missing: 0 };
  if (openTime < lastOpenTime) return { order: CANDLE_ORDER.STALE, missing: 0 };

  const expected = lastOpenTime + intervalMs;
  if (openTime === expected) return { order: CANDLE_ORDER.NEXT, missing: 0 };

  return {
    order: CANDLE_ORDER.GAP,
    missing: Math.round((openTime - expected) / intervalMs),
  };
};

/** True when this candle is safe to hand to the chart. */
export const isDrawable = (order) => order !== CANDLE_ORDER.STALE;
