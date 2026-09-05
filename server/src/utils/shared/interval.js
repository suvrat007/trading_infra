const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Binance interval string -> milliseconds.
 *
 * Deliberately does NOT support '1M'. Months are not a fixed duration, so a
 * monthly series is not a uniform grid and none of the gap arithmetic below
 * holds for it. Throwing is honest; returning "about 30 days" would silently
 * produce wrong expected timestamps twelve times a year.
 */
export const intervalToMs = (interval) => {
  const match = /^(\d+)([smhdw])$/.exec(String(interval));

  if (!match) {
    throw new TypeError(
      `Unsupported interval "${interval}". Expected a number followed by s, m, h, d or w ` +
      '(monthly intervals are not a fixed-length grid and are not supported).'
    );
  }

  return Number(match[1]) * UNIT_MS[match[2]];
};

/**
 * The open_time of the most recent candle that has actually CLOSED.
 *
 * The bar covering "now" is still forming, so it is not missing — it has not
 * happened yet. Treating it as a gap would make every backfill run chase a
 * candle that does not exist and log a permanent phantom hole.
 */
export const latestClosedOpenTime = (intervalMs, now = Date.now()) =>
  Math.floor(now / intervalMs) * intervalMs - intervalMs;

/** How many candles sit on the grid from `from` to `to`, inclusive of both. */
export const countCandlesBetween = (from, to, intervalMs) =>
  from > to ? 0 : Math.floor((to - from) / intervalMs) + 1;
