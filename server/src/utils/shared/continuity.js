export const CANDLE_ORDER = {
  FIRST: 'first',
  NEXT: 'next',
  DUPLICATE: 'duplicate',
  GAP: 'gap',
  STALE: 'stale',
};

/**
 * Where an arriving candle sits relative to the last one we saw.
 *
 * Candles occupy a fixed time grid, so continuity is arithmetic — noticing that
 * something is missing costs nothing and needs no query. Only an actual
 * discontinuity is worth spending a REST call on.
 *
 *   FIRST     nothing seen yet, nothing to compare against
 *   NEXT      exactly one interval on — the normal case
 *   DUPLICATE same open_time, e.g. an exchange replay after reconnect
 *   GAP       later than expected — candles were missed
 *   STALE     EARLIER than the last one — out of order or a late duplicate
 *
 * Mirrors the client-side check deliberately. The two run on opposite sides of
 * the socket and catch different things: this one sees candles the DATABASE
 * missed, the client's sees candles the BROWSER missed.
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
